import fetch from "node-fetch";
import similarity from "similarity";
import config from "../../config.js";
import { findUser, updateUser } from "../../lib/users.js";

const Commands = ["merdeka", "mka"];
const Description = "Game kuis kemerdekaan berhadiah money.";
const OnlyGroup = false;
const OnlyOwner = false;
const limitDeduction = 0;

const API_KEY = config.APIBOTCAHX || "Varesa";
const timeout = 100000;
const rewardMoney = 100;
const threshold = 0.72;

function extractText(message) {
  if (!message) return "";
  const msg = message.message || message;
  if (typeof msg === "string") return msg;
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text)
    return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption)
    return msg.imageMessage.caption;
  if (msg.videoMessage && msg.videoMessage.caption)
    return msg.videoMessage.caption;
  return "";
}

function getQuotedId(message) {
  if (!message) return null;
  const msg = message.message || message;
  const ext = msg.extendedTextMessage;
  if (!ext || !ext.contextInfo) return null;
  return ext.contextInfo.stanzaId || ext.contextInfo.stanzaID || null;
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, prefix, command } = messageInfo;

  sock.merdeka = sock.merdeka || {};
  const id = remoteJid;

  const usedPrefix = prefix || ".";

  if (command === "mka") {
    if (!(id in sock.merdeka)) {
      await sock.sendMessage(
        remoteJid,
        { text: "Tidak ada soal kemerdekaan yang aktif di chat ini." },
        { quoted: message }
      );
      return;
    }
    const state = sock.merdeka[id];
    const json = state.data;
    const ans = String(json.jawaban || "");
    const clue = ans
      .toUpperCase()
      .replace(/[BCDFGHJKLMNPQRSTVWXYZ]/g, "_");
    await sock.sendMessage(
      remoteJid,
      { text: "```" + clue + "```" },
      { quoted: message }
    );
    return;
  }

  if (command === "merdeka") {
    if (id in sock.merdeka) {
      await sock.sendMessage(
        remoteJid,
        {
          text: "Masih ada soal belum terjawab di chat ini.",
        },
        { quoted: sock.merdeka[id].message }
      );
      return;
    }

    const url =
      "https://api.botcahx.eu.org/api/game/kuismerdeka?apikey=" +
      encodeURIComponent(API_KEY);

    const res = await fetch(url);
    const src = await res.json();

    let list = [];
    if (Array.isArray(src)) list = src;
    else if (Array.isArray(src.result)) list = src.result;
    else if (Array.isArray(src.data)) list = src.data;

    if (!list.length) {
      await sock.sendMessage(
        remoteJid,
        { text: "Gagal mengambil soal kemerdekaan dari API." },
        { quoted: message }
      );
      return;
    }

    const json = list[Math.floor(Math.random() * list.length)];

    const caption =
      String(json.soal || "") +
      "\n\n" +
      "┌─⊷ *SOAL*\n" +
      "▢ Timeout *" +
      (timeout / 1000).toFixed(2) +
      " detik*\n" +
      "▢ Ketik " +
      usedPrefix +
      "mka untuk bantuan\n" +
      "▢ Bonus: " +
      rewardMoney +
      " money\n" +
      "▢ *Balas/ REPLY soal ini untuk menjawab*\n" +
      "└──────────────";

    const sent = await sock.sendMessage(
      remoteJid,
      { text: caption },
      { quoted: message }
    );

    const timer = setTimeout(async () => {
      if (sock.merdeka && sock.merdeka[id]) {
        const st = sock.merdeka[id];
        await sock.sendMessage(
          remoteJid,
          {
            text:
              "Waktu habis!\nJawabannya adalah *" +
              String(st.data.jawaban || "-") +
              "*",
          },
          { quoted: st.message }
        );
        delete sock.merdeka[id];
      }
    }, timeout);

    sock.merdeka[id] = {
      message: sent,
      data: json,
      reward: rewardMoney,
      timer,
    };

    return;
  }
}

async function before(sock, messageInfo) {
  const { remoteJid, message, content } = messageInfo;

  sock.merdeka = sock.merdeka || {};
  const id = remoteJid;

  if (!(id in sock.merdeka)) return;

  const state = sock.merdeka[id];

  const quotedId = getQuotedId(message);
  if (!quotedId) return;
  if (
    !state.message ||
    !state.message.key ||
    quotedId !== state.message.key.id
  )
    return;

  const text = (content || extractText(message) || "").trim();
  if (!text) return;

  const userAnswer = text.toLowerCase();
  const correct = String(state.data.jawaban || "")
    .trim()
    .toLowerCase();

  if (!correct) return;

  if (userAnswer === correct) {
    const userEntry = findUser(remoteJid);
    if (userEntry) {
      const [, userData] = userEntry;
      const newMoney = (userData.money || 0) + state.reward;
      const newLevelCache =
        (userData.level_cache || 0) + state.reward;
      updateUser(remoteJid, {
        money: newMoney,
        level_cache: newLevelCache,
      });
    }

    await sock.sendMessage(
      remoteJid,
      {
        text: "*Benar!*\n+" + state.reward + " money",
      },
      { quoted: message }
    );

    clearTimeout(state.timer);
    delete sock.merdeka[id];
  } else if (
    similarity(userAnswer, correct) >= threshold
  ) {
    await sock.sendMessage(
      remoteJid,
      { text: "*Dikit Lagi!*" },
      { quoted: message }
    );
  } else {
    await sock.sendMessage(
      remoteJid,
      { text: "*Salah!*" },
      { quoted: message }
    );
  }
}

export default {
  handle,
  before,
  Commands,
  Description,
  OnlyGroup,
  OnlyOwner,
  limitDeduction,
};