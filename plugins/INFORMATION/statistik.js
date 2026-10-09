// plugins/INFORMATION/statistik.js
import config from "../../config.js";
import { getStats, getGroupsCached } from "../../lib/bot-stats.js";
import { TIER_LABEL } from "../../lib/tier-guard.js";

// Statistik bot SESI INI — angka yang sama dengan kartu "Statistik Bot" di
// dashboard (lib/bot-stats.js), jadi pemilik bisa mengecek dari WhatsApp
// tanpa membuka website. Perintah .statistik dicontohkan di menu kustom
// bawaan dashboard tapi dulu tidak ada plugin-nya.
// Hanya angka ringkasan: isi pesan & nama pengirim (stats.recent) sengaja
// tidak ditampilkan karena perintah ini bisa dipakai siapa saja.

function formatDurasi(ms) {
  let detik = Math.max(0, Math.floor(ms / 1000));
  const hari = Math.floor(detik / 86400);
  detik %= 86400;
  const jam = Math.floor(detik / 3600);
  detik %= 3600;
  const menit = Math.floor(detik / 60);
  const bagian = [];
  if (hari) bagian.push(`${hari} hari`);
  if (jam) bagian.push(`${jam} jam`);
  bagian.push(`${menit} menit`);
  return bagian.join(" ");
}

function formatAngka(n) {
  return Number(n || 0).toLocaleString("id-ID");
}

function waktuLalu(ts) {
  if (!ts) return "-";
  const selisih = Date.now() - ts;
  if (selisih < 60 * 1000) return "barusan";
  return `${formatDurasi(selisih)} lalu`;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, sessionConfig = {}, isJadibot, botNumber } = messageInfo;

  const nomor = botNumber || String(sock.user?.id || "").split(":")[0].split("@")[0];
  const botName = (sessionConfig.botName || "").trim() || config.bot_name;

  // Jumlah grup lewat cache bersama (TTL 60 detik), bukan request baru ke
  // WhatsApp setiap kali perintah ini dipanggil.
  let jumlahGrup = null;
  try {
    const groups = await getGroupsCached(nomor, sock);
    jumlahGrup = groups.length;
  } catch {
    /* pakai angka terakhir dari statistik */
  }

  const s = getStats(nomor);
  const paket = isJadibot
    ? TIER_LABEL[sessionConfig.tier] || "Free"
    : "Bot utama";

  const baris = [
    `📊 *STATISTIK BOT*`,
    ``,
    `🤖 Nama   : *${botName}*`,
    `💎 Paket  : *${paket}*`,
    `👥 Grup   : ${formatAngka(jumlahGrup ?? s?.groups ?? 0)}`,
  ];

  if (s) {
    baris.push(
      `⏱️ Aktif  : ${formatDurasi(s.uptimeMs)}`,
      `💬 Pesan  : ${formatAngka(s.messages)} (grup ${formatAngka(s.groupMessages)} • pribadi ${formatAngka(s.privateMessages)})`,
      `⚡ Perintah: ${formatAngka(s.commands)}`,
      `🕒 Terakhir aktif: ${waktuLalu(s.lastActivity)}`
    );
  } else {
    baris.push(`⏱️ Statistik mulai dihitung sejak pesan pertama setelah bot menyala.`);
  }

  baris.push(
    ``,
    `_Hitungan dimulai ulang setiap server restart._`,
    `🌐 Detail lengkap: ${config.web_url}/dashboard`
  );

  await sock.sendMessage(remoteJid, { text: baris.join("\n") }, { quoted: message });
}

export default {
  handle,
  Commands: ["statistik", "stats", "botstat"],
  OnlyPremium: false,
  OnlyOwner: false,
};
