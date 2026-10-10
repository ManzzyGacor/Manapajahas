import * as ch from "cheerio";
import { downloadContentFromMessage } from "baileys";

async function handle(sock, messageInfo) {
    const {
        remoteJid,
        message,
        content,
        prefix,
        command,
    } = messageInfo;

    const usedPrefix = prefix || ".";
    const cmdName = command || "imagetoasci";

    const msgContent = message.message || message;

    // Ambil pesan yang direply (kalau ada)
    const quotedMsg = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;

    // Cari image di pesan reply atau pesan utama (termasuk viewOnce)
    const quotedImage =
        quotedMsg?.imageMessage ||
        quotedMsg?.viewOnceMessage?.message?.imageMessage ||
        quotedMsg?.viewOnceMessageV2?.message?.imageMessage;

    const ownImage =
        msgContent?.imageMessage ||
        msgContent?.viewOnceMessage?.message?.imageMessage ||
        msgContent?.viewOnceMessageV2?.message?.imageMessage;

    const imageMessage = quotedImage || ownImage;

    // Anggap content adalah teks setelah command (argumen)
    let text = (content || "").trim();

    // Jika tidak ada image dan tidak ada URL
    if (!imageMessage && !(text && text.startsWith("http"))) {
        await sock.sendMessage(
            remoteJid,
            {
                text:
                    `*🍂 Butuh input gambar!*\n` +
                    `*Contoh: ${usedPrefix}${cmdName} (reply gambar atau kirim URL)*`,
            },
            { quoted: message }
        );
        return;
    }

    // React ⏳
    await sock.sendMessage(remoteJid, {
        react: { text: "⏳", key: message.key },
    });

    try {
        let buffer = null;
        let sourceUrl = null;

        // Jika ada image, download dari WhatsApp
        if (imageMessage) {
            try {
                const stream = await downloadContentFromMessage(imageMessage, "image");
                buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
            } catch {
                buffer = null;
            }
        }

        // Kalau tidak ada buffer tapi ada URL (mode URL)
        if (!buffer && text && text.startsWith("http")) {
            sourceUrl = text.trim();
            try {
                const r = await fetch(sourceUrl);
                if (!r.ok) {
                    await sock.sendMessage(
                        remoteJid,
                        {
                            text:
                                `*🍂 Gagal ambil gambar!*\n` +
                                `*Status:* ${r.status} ${r.statusText}`,
                        },
                        { quoted: message }
                    );
                    return;
                }
                buffer = Buffer.from(await r.arrayBuffer());
            } catch {
                buffer = null;
            }
        }

        // Validasi akhir
        if (!buffer && !sourceUrl) {
            await sock.sendMessage(
                remoteJid,
                {
                    text:
                        `*🍂 Format tidak valid!*\n` +
                        `*Gunakan: reply gambar atau URL gambar.*`,
                },
                { quoted: message }
            );
            return;
        }

        const size = buffer ? buffer.length : 0;
        let width = 60;
        if (size && size < 150_000) width = 50;
        else if (size && size < 350_000) width = 65;
        else if (size && size < 700_000) width = 80;
        else width = 100;

        const siteBase = "https://www.text-image.com";
        const asciiPage = "/convert/ascii.html";

        const getHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        };

        const getController = new AbortController();
        const getTimeout = setTimeout(() => getController.abort(), 10000);

        const getRes = await fetch(siteBase + asciiPage, {
            method: "GET",
            signal: getController.signal,
            headers: getHeaders,
        });
        clearTimeout(getTimeout);

        const setCookie = getRes.headers.get("set-cookie") ?? "";
        const initialHtml = await getRes.text(); // kalau mau dipakai debugging

        const buildForm = (w, useImageUrlOnly = false) => {
            const f = new FormData();
            f.append("format", "ascii");
            f.append("width", String(w));
            f.append("textcolor", "#000000");
            f.append("bgcolor", "#ffffff");
            f.append("invert", "0");
            f.append("contrast", "1");
            if (!useImageUrlOnly && buffer) {
                f.append(
                    "image",
                    new Blob([buffer], { type: "image/jpeg" }),
                    "image.jpg"
                );
            }
            if (sourceUrl) f.append("imageurl", sourceUrl);
            return f;
        };

        const postHeadersBase = {
            Origin: siteBase,
            Referer: siteBase + asciiPage,
            "User-Agent": getHeaders["User-Agent"],
            Accept: getHeaders["Accept"],
            "Accept-Language": getHeaders["Accept-Language"],
        };

        const tryConvert = async (form) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 25000);
            const headers = { ...postHeadersBase };
            if (setCookie) {
                headers.Cookie = setCookie
                    .split(",")
                    .map((s) => s.split(";")[0])
                    .join("; ");
            }

            const res = await fetch(siteBase + "/convert/result.cgi", {
                method: "POST",
                body: form,
                signal: controller.signal,
                headers,
            });
            clearTimeout(timeout);
            const text = await res.text();
            return { ok: res.ok, status: res.status, text };
        };

        let res = await tryConvert(buildForm(width, false));
        if ((!res.ok || !res.text.includes('id="tiresult"')) && width !== 65) {
            res = await tryConvert(buildForm(65, false));
        }
        if ((!res.ok || !res.text.includes('id="tiresult"')) && sourceUrl) {
            res = await tryConvert(buildForm(width, true));
        }

        if (!res.ok || !res.text.includes('id="tiresult"')) {
            const html = res.text || "";

            if (html.includes("Error:")) {
                const cleanErr = html
                    .split("Error:")[1]
                    .split("<")[0]
                    .trim();

                await sock.sendMessage(
                    remoteJid,
                    {
                        text:
                            `*🍂 Gagal convert — gambar tidak dapat diproses!*\n` +
                            `*Alasan:* ${cleanErr}`,
                    },
                    { quoted: message }
                );
                return;
            }

            await sock.sendMessage(
                remoteJid,
                {
                    text:
                        `*🍂 Gagal convert — hasil kosong!*\n` +
                        `*Width:* ${width}\n` +
                        `*Status:* ${res.status}`,
                },
                { quoted: message }
            );
            return;
        }

        const $ = ch.load(res.text);
        const ascii = $("#tiresult").text().trim();
        const share = $("#sharebutton").parent().find("a").attr("href") ?? null;

        if (!ascii) {
            const snippet = res.text.slice(0, 1200).replace(/\s+/g, " ");
            await sock.sendMessage(
                remoteJid,
                {
                    text:
                        `*🍂 Gagal convert — hasil kosong!*\n` +
                        `*Width:* ${width}\n` +
                        `*HTML:* ${snippet}`,
                },
                { quoted: message }
            );
            return;
        }

        let out = `*✨ Image To Ascii (Auto-Width) ✨*\n\n`;
        out += `*🖼️ Width otomatis:* *${width}*\n\n`;
        out += `*📄 Hasil ASCII:*\n\`\`\`\n${ascii}\n\`\`\``;
        if (share) out += `\n*🔗 Share Link:* ${share}`;

        await sock.sendMessage(
            remoteJid,
            { text: out },
            { quoted: message }
        );
    } catch (e) {
        const msg = e && e.message ? e.message : "unknown error";
        await sock.sendMessage(
            remoteJid,
            {
                text:
                    `*🍂 Terjadi kesalahan saat memproses gambar!*\n` +
                    `*Error:* ${msg}`,
            },
            { quoted: message }
        );
    } finally {
        // Clear reaction
        await sock.sendMessage(remoteJid, {
            react: { text: "", key: message.key },
        });
    }
}

// Metadata plugin, mengikuti pola baru
export default {
    handle,
    Commands: ["imagetoasci", "imgascii", "ascii"],
    OnlyPremium: false,
    OnlyOwner: false,
    // di versi lama: handler.limit = true → pakai 1 limit
    limitDeduction: 1,
};