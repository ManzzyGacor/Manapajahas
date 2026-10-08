import { checkMessage } from "./participants.js";
import config from "../config.js";
import {
  logWithTime,
  getCurrentDate,
  sendMessageWithMentionNotQuoted,
  sendImagesWithMentionNotQuoted,
  getCurrentTime,
  getGreeting,
  getHari,
  logTracking,
  getSenderType,
} from "./utils.js";
import { getGroupMetadata, getProfilePictureUrl } from "./cache.js";
import { findGroup } from "./group.js";
import { updateUser, findUser } from "./users.js";
import { generateWelcomeCanvas } from "./canvas/welcome.js";

const WELCOME_GIF_URL =
  "https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1765371621945_777.mp4";

async function handleDetectBlackList(sock, remoteJid, sender) {
  try {
    const statusJid = getSenderType(sender);
    const dataGroupSettings = await findGroup(remoteJid);
    if (!dataGroupSettings) return true;

    const { fitur } = dataGroupSettings;
    if (!fitur.detectblacklist && !fitur.detectblacklist2) return true;

    const user = await findUser(sender);
    if (!user) return true;

    const [docId, userData] = user;

    if (userData.status === "blacklist") {
      if (fitur.detectblacklist) {
        const warningMessage = `⚠️ _Peringatan Blacklist_\n\n@${
          sender.split("@")[0]
        } telah di blacklist.`;
        logTracking(`Participant Update - Peringatan Blacklist (${sender})`);
        await sendMessageWithMentionNotQuoted(
          sock,
          remoteJid,
          warningMessage,
          statusJid
        );
      }

      if (fitur.detectblacklist2) {
        logTracking(
          `Participant Update - Peringatan Blacklist2 di kick (${sender})`
        );
        await sock.groupParticipantsUpdate(remoteJid, [sender], "remove");
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("Error handling blacklist detection:", error);
    return true;
  }
}

async function handleActiveFeatures(sock, messageInfo, settingGroups) {
  const { id, action, participants, store } = messageInfo;

  if (!id || !action || !participants || participants.length === 0) {
    console.error("Invalid message information provided");
    return;
  }

  const {
    promote = false,
    demote = false,
    welcome = false,
    left = false,
  } = settingGroups;

  const participant = participants[0];
  const targetNumber =
    participant?.phoneNumber || participant?.id || participant;
  const cleanNumber =
    typeof targetNumber === "string" ? targetNumber.split("@")[0] : "unknown";
  const targetMention = `@${cleanNumber}`;

  const statusJid = getSenderType(targetNumber);

  const isBlacklist = await handleDetectBlackList(sock, id, targetNumber);
  if (!isBlacklist) return false;

  const actions = {
    promote: promote,
    demote: demote,
    remove: left,
    add: welcome,
  };

  if (!actions[action]) {
    logWithTime("SYSTEM", `Fitur ${action} tidak aktif`);
    return;
  }

  const result = await checkMessage(id, action);
  if (!result) return;

  const templatewelcome = await checkMessage(id, "templatewelcome");
  let typeWelcome = (templatewelcome || config.typewelcome || "image")
    .toString()
    .toLowerCase();

  const groupMetadata = await getGroupMetadata(sock, id);
  if (!groupMetadata) {
    console.error("Failed to fetch group metadata");
    return;
  }

  const ppUser = await getProfilePictureUrl(sock, targetNumber);
  const ppGroup = await getProfilePictureUrl(sock, id);
  const contact = store.contacts[targetNumber];

  const pushName =
    contact?.verifiedName ||
    contact?.notify ||
    (typeof targetNumber === "string" ? cleanNumber : "Unknown");

  const { subject, desc, size } = groupMetadata;
  const date = getCurrentDate();
  const time = getCurrentTime();
  const greeting = getGreeting();
  const day = getHari();

  const replacements = {
    "@name": targetMention,
    "@date": date,
    "@day": day,
    "@desc": desc,
    "@group": subject,
    "@greeting": greeting,
    "@size": size,
    "@time": time,
  };

  let customizedMessage = result;
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(key.replace(/@/, "@"), "gi");
    customizedMessage = customizedMessage.replace(regex, value);
  }

  if (["promote", "demote", "remove"].includes(action)) {
    if (actions[action]) {
      logTracking(`Participant Update - Send text ke (${id})`);
      await sendMessageWithMentionNotQuoted(
        sock,
        id,
        customizedMessage,
        statusJid
      );
    }
    return;
  }

  if (action === "add" && welcome) {
    if (typeWelcome === "random") {
      // Kita tambahkan custom ke dalam pilihan random jika ingin
      const randomTypes = ["image", "text", "gif", "custom"];
      typeWelcome =
        randomTypes[Math.floor(Math.random() * randomTypes.length)];
    }

    if (typeWelcome === "text") {
      logTracking(`Participant Update - Send text welcome ke (${id})`);
      await sendMessageWithMentionNotQuoted(
        sock,
        id,
        customizedMessage,
        statusJid
      );
      return;
    }

    // --- 🆕 MODE CUSTOM ---
    if (typeWelcome === "custom") {
      logTracking(`Participant Update - Send Custom Media Welcome ke (${id})`);
      const customMediaUrl = await checkMessage(id, "templatewelcomeMedia");

      if (customMediaUrl) {
        try {
          const isVideo = customMediaUrl.endsWith('.mp4');
          if (isVideo) {
            await sock.sendMessage(
              id,
              {
                video: { url: customMediaUrl },
                caption: customizedMessage,
                gifPlayback: true,
              },
              { quoted: null }
            );
          } else {
            await sock.sendMessage(
              id,
              {
                image: { url: customMediaUrl },
                caption: customizedMessage,
              },
              { quoted: null }
            );
          }
          return;
        } catch (err) {
          console.error("Error kirim welcome custom:", err);
          // Kalau gagal ngirim gambar/video, otomatis fallback kirim teks aja
          await sendMessageWithMentionNotQuoted(sock, id, customizedMessage, statusJid);
          return;
        }
      } else {
        // Kalau user set mode custom tapi belum ngirim gambarnya, fallback ke teks
        console.warn("Media custom tidak ditemukan, fallback ke text");
        await sendMessageWithMentionNotQuoted(sock, id, customizedMessage, statusJid);
        return;
      }
    }
    // --- AKHIR MODE CUSTOM ---

    if (typeWelcome === "gif") {
      try {
        logTracking(`Participant Update - Send GIF Welcome ke (${id})`);

        await sock.sendMessage(
          id,
          {
            video: { url: WELCOME_GIF_URL },
            caption: customizedMessage,
            gifPlayback: true,
          },
          { quoted: null }
        );
      } catch (err) {
        console.error("Error kirim welcome gif:", err);
        await sendMessageWithMentionNotQuoted(
          sock,
          id,
          customizedMessage,
          statusJid
        );
      }
      return;
    }

    try {
      const buffer = await generateWelcomeCanvas({
        ppUser,
        pushName,
        memberCount: size,
        groupName: subject,
      });

      if (buffer) {
        logTracking(
          `Participant Update - Send Image Welcome (Canvas) ke (${id})`
        );
        await sendImagesWithMentionNotQuoted(
          sock,
          id,
          buffer,
          customizedMessage,
          statusJid
        );
      } else {
        console.warn("Gagal generate welcome canvas, fallback ke text");
        await sendMessageWithMentionNotQuoted(
          sock,
          id,
          customizedMessage,
          statusJid
        );
      }
    } catch (err) {
      console.error("Error generate welcome canvas:", err);
      await sendMessageWithMentionNotQuoted(
        sock,
        id,
        customizedMessage,
        statusJid
      );
    }
  }
}

export { handleActiveFeatures };