import config from "../config.js";
import {
  removeSpace,
  isQuotedMessage,
  getMessageType,
  getSenderType,
} from "./utils.js";
import { getContentType } from "baileys";

const debug = true;

// Inisialisasi Map
const messageMap = new Map();

function time() {
  const now = new Date();
  const jam = now.getHours().toString().padStart(2, "0");
  const menit = now.getMinutes().toString().padStart(2, "0");
  return `${jam}:${menit}`;
}

function insertMessage(id, participant, messageTimestamp, remoteId) {
  messageMap.set(id, {
    participant,
    messageTimestamp,
    remoteId,
  });
}

function updateMessagePartial(id, partialData = {}) {
  if (messageMap.has(id)) {
    const current = messageMap.get(id);
    messageMap.set(id, { ...current, ...partialData });
  } else {
    console.log(`Data dengan id ${id} tidak ditemukan.`);
  }
}

function logWithTimestamp(...messages) {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0];
  console.log(`[${time}]`, ...messages);
}

function serializeMessage(m, sock) {
  try {
    const timestamp = m.messages?.[0]?.messageTimestamp;
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > 30) return null;

    if (!m || !m.messages || !m.messages[0]) return null;
    if (m.type === "append") return null;

    const message = m.messages[0];
    const key = message.key || {};
    let remoteJid = key.remoteJid || key.remoteJidAlt || "";
    const fromMe = key.fromMe || false;
    const id = key.id || "";
    const participant =
      key.participantAlt || key.participant || message.participant || "";
    const pushName = message.pushName || "";
    const isGroup = remoteJid.endsWith("@g.us");
    const isBroadcast = remoteJid.endsWith("status@broadcast");

    if (!isGroup && !remoteJid.endsWith("@s.whatsapp.net")) {
      remoteJid = key.remoteJidAlt || key.remoteJid;
    }

    let sender = isGroup ? participant : remoteJid;

    // Pesan fromMe = diketik pemilik akun WhatsApp bot dari HP/perangkat
    // lain. Dulu di chat pribadi pengirimnya tercatat sebagai LAWAN BICARA
    // (remoteJid), jadi limit/owner/registrasi milik orang lain yang
    // dipakai. Pengirim yang benar adalah nomor bot itu sendiri.
    if (fromMe && sock?.user?.id) {
      const ownNumber = String(sock.user.id).split(":")[0].split("@")[0];
      if (ownNumber) sender = `${ownNumber}@s.whatsapp.net`;
    }
    let senderType = getSenderType(sender);

    const isQuoted = isQuotedMessage(message);
    const isEdited =
      message?.message?.protocolMessage?.editedMessage?.extendedTextMessage
        ?.text ||
      message?.message?.protocolMessage?.editedMessage?.conversation ||
      message?.message?.editedMessage ||
      null;

    const isDeleted = message?.message?.protocolMessage?.type === 0;
    const isForwarded =
      message.message?.[getContentType(message.message)]?.contextInfo
        ?.isForwarded === true;

    let antitagsw = false;
    let isTagMeta = false;

    let objisEdited = {};
    if (isEdited) {
      const messageId = m.messages[0]?.message?.protocolMessage?.key?.id;
      objisEdited = {
        status: true,
        id: messageId || null,
        text: isEdited,
      };
    }

    const isBot =
      (id?.startsWith("3EB0") && id.length === 22) ||
      (message?.message &&
        Object.keys(message.message).some((key) =>
          ["templateMessage", "interactiveMessage", "buttonsMessage"].includes(
            key
          )
        ));

    /* ============================================================
       SYSTEM BARU: SWITCH–CASE CONTENT & MESSAGETYPE
       ============================================================ */

    let content = "";
    let messageType = "";

    if (message.message) {
      const rawMessageType = getContentType(message.message);
      messageType = rawMessageType;

      switch (rawMessageType) {
        case "conversation":
          content = message.message.conversation;
          break;

        case "extendedTextMessage":
          content = message.message.extendedTextMessage.text;
          break;

        case "imageMessage":
          content = message.message.imageMessage.caption || "";
          break;

        case "videoMessage":
          content = message.message.videoMessage.caption || "";
          break;

        case "stickerMessage":
          content = "stickerMessage";
          break;

        case "audioMessage":
          content = "audioMessage";
          break;

        case "documentMessage":
          content = message.message.documentMessage.fileName || "";
          break;

        case "buttonsResponseMessage":
          content =
            message.message.buttonsResponseMessage.selectedButtonId || "";
          break;

        case "listResponseMessage":
          content =
            message.message.listResponseMessage.singleSelectReply
              ?.selectedRowId || "";
          break;

        case "templateButtonReplyMessage":
          content = message.message.templateButtonReplyMessage.selectedId || "";
          break;

        case "reactionMessage":
          content =
            message.reaction?.text ||
            message.message.reactionMessage?.text ||
            "[REACT DIHAPUS]";
          break;

        case "interactiveMessage":
          if (message.message.interactiveMessage?.type === "buttonReply") {
            content = message.message.interactiveMessage.buttonReply?.id || "";
          } else if (
            message.message.interactiveMessage?.type === "listReply"
          ) {
            content = message.message.interactiveMessage.listReply?.id || "";
          }
          break;

        case "interactiveResponseMessage":
          try {
            const native =
              message.message.interactiveResponseMessage
                .nativeFlowResponseMessage;

            if (native?.paramsJson) {
              const parsed = JSON.parse(native.paramsJson);
              content =
                parsed.id || parsed.selectedId || parsed.title || "";
            } else if (native?.body) {
              content = native.body || "";
            } else {
              content = "";
            }

            if (debug)
              logWithTimestamp("Button Selection Detected:", content);
          } catch (err) {
            console.error("❌ Gagal parse Button Selection:", err);
            content = "";
          }
          break;

        default:
          content = "";
      }
    }

    /* ============================================================
       NORMALISASI CONTENT
       ============================================================ */

    content = removeSpace(content) || "";

    let command = content?.trim()?.split(" ")[0]?.toLowerCase() || "";
    const usedPrefix = config.prefix.find((p) =>
      (command || "").startsWith(p)
    );

    command = usedPrefix
      ? (command || "").slice(usedPrefix.length).trim().split(/\s+/)[0] || ""
      : config.status_prefix
      ? false
      : (command || "").trim().split(/\s+/)[0] || "";

    const contentWithoutCommand = usedPrefix
      ? (content || "")
          .trim()
          .slice(usedPrefix.length + (command?.length || 0))
          .trim()
      : (content || "").trim().slice(command?.length || 0).trim();

    /* ============================================================
       QUOTED SYSTEM
       ============================================================ */

    const quotedMessage = isQuoted
      ? {
          text:
            message.message.extendedTextMessage.contextInfo.quotedMessage
              ?.conversation || "",
          sender:
            message.message.extendedTextMessage.contextInfo.participant || "",
          id: message.message.extendedTextMessage.contextInfo.stanzaId || "",
        }
      : null;

    const ArraymentionedJid =
      message?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
      false;

    const cleanContent = content.replace(/\s+/g, " ").trim();
    const preview =
      cleanContent.length > 20
        ? cleanContent.slice(0, 20) + "..."
        : cleanContent;

    const senderNumber = participant.replace(/@s\.whatsapp\.net$/, "");

    /* ============================================================
       FINAL RETURN
       ============================================================ */

    return {
      id,
      timestamp: message.messageTimestamp,
      sender,
      pushName,
      isGroup,
      fromMe,
      remoteJid,
      type: getMessageType(messageType),
      content: contentWithoutCommand,
      message,
      isTagSw: antitagsw,
      prefix: usedPrefix ? usedPrefix : "",
      command,
      fullText: content,
      isQuoted,
      quotedMessage,
      mentionedJid: ArraymentionedJid,
      isBot,
      isTagMeta,
      isForwarded,
      senderType,
      m: { remoteJid, key, message, sock, isDeleted, isEdited: objisEdited, m },
    };
  } catch (e) {
    return null;
  }
}

export default serializeMessage;