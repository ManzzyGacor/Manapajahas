// Pintasan untuk Blackjack PvP (plugins/GAMES/blackjack.js).
//
// File ini dulu berisi handler Blackjack versi LAMA (lawan komputer) yang
// meng-import fungsi getUser/removeUser dari database/temporary_db/
// blackjack.js — fungsi yang sudah tidak ada sejak game diganti versi PvP.
// Akibatnya modul ini gagal dimuat di setiap start (error di log).
//
// Sekarang tugasnya cuma satu: saat giliran pemain di grup, ketikan "hit" /
// "stand" tanpa titik ikut diteruskan ke plugin PvP, sesuai petunjuk yang
// ditampilkan plugin itu sendiri ("Ketik hit atau stand").
import { getGame } from "../../database/temporary_db/blackjack.js";
import blackjackPlugin from "../../plugins/GAMES/blackjack.js";

const AKSI = ["hit", "stand"];

async function process(sock, messageInfo) {
  const { remoteJid, sender, fullText, command, isGroup } = messageInfo;

  // Pesan berprefix (mis. ".bj hit") sudah ditangani plugin langsung.
  if (!isGroup || command) return true;

  const teks = String(fullText || "").trim().toLowerCase();
  if (!AKSI.includes(teks)) return true;

  const game = getGame(remoteJid);
  if (!game || !["P1_TURN", "P2_TURN"].includes(game.state)) return true;
  if (game.currentPlayer !== sender) return true;

  try {
    await blackjackPlugin.handle(sock, {
      ...messageInfo,
      command: "bj",
      content: teks,
      prefix: messageInfo.prefix || ".",
    });
  } catch (error) {
    console.error("[blackjack] gagal memproses aksi:", error.message);
  }
  return false; // pesan sudah ditangani, jangan diteruskan ke plugin lain
}

export const name = "Blackjack";
export const priority = 10;
export { process };
