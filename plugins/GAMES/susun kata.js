import { 
  addUser, 
  removeUser, 
  isUserPlaying 
} from "../../database/temporary_db/game_session.js"; 

import config from "../../config.js"; 
import { logCustom } from "../../lib/logger.js"; 

// --- Pengaturan Dasar API ---
const API_KEY = config.APIBOTCAHX || "Varesa"; 
const BASE_URL = "https://api.botcahx.eu.org"; 
const ENDPOINT = `/api/game/susunkata`;
// ----------------------------

// Konfigurasi Game Lokal
const TIME_LIMIT = 60000; // 60 detik
const GAME_PRIZE = 100; // Hadiah default 
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit

// Metadata Plugin
export const Name = "susunkata";
export const Commands = ["susunkata", "sukata"]; 
export const Description = "Game menyusun kata dari API Botcahx (Soal acak).";
export const OnlyGroup = true;
export const limitDeduction = 1;

// Database cooldown sementara
const cooldowns = {};

export async function handle(sock, messageInfo) {
    const { remoteJid, message } = messageInfo;

    // 1. Cek jika ada game yang sedang berlangsung
    if (isUserPlaying(remoteJid)) {
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Game Susun Kata sedang berlangsung di chat ini. Silakan jawab terlebih dahulu atau tunggu hingga waktu habis.` },
            { quoted: message }
        );
        return;
    }

    // 2. Cek Cooldown
    const now = Date.now();
    if (cooldowns[remoteJid] && now - cooldowns[remoteJid] < COOLDOWN_TIME) {
        const sisaWaktu = cooldowns[remoteJid] + COOLDOWN_TIME - now;
        const menit = Math.floor(sisaWaktu / 60000);
        const detik = Math.floor((sisaWaktu % 60000) / 1000);

        await sock.sendMessage(
            remoteJid,
            { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Susun Kata kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
            { quoted: message }
        );
        return;
    }

    try {
        // 3. Ambil data dari API
        const url = `${BASE_URL}${ENDPOINT}?apikey=${API_KEY}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Gagal mengambil data dari API. Status: ${response.status}`);
        }
        
        const jsonResponse = await response.json();

        if (!Array.isArray(jsonResponse) || jsonResponse.length === 0 || !jsonResponse[0].jawaban) {
             throw new Error("Struktur respons API tidak valid atau kosong.");
        }

        const randomIndex = Math.floor(Math.random() * jsonResponse.length);
        const selectedWordData = jsonResponse[randomIndex];
        
        const correctAnswer = selectedWordData.jawaban.toLowerCase().trim();
        const scrambledWord = selectedWordData.soal; 
        const hint = selectedWordData.tipe;

        // 4. Set Timer
        const timer = setTimeout(async () => {
            if (isUserPlaying(remoteJid)) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `⌛ Waktu habis! Game Susun Kata dihentikan.\nJawaban yang benar adalah: *${correctAnswer.toUpperCase()}*` }
                );
                removeUser(remoteJid);
                logCustom('info', `Game Susun Kata habis waktu di ${remoteJid}`, `GAME-TIMEOUT.txt`);
            }
        }, TIME_LIMIT);

        // 5. Update Cooldown (Hanya jika sukses dapat soal)
        cooldowns[remoteJid] = now;

        // 6. Simpan sesi game
        const gameData = {
            game: 'susunkata',
            answer: correctAnswer, 
            hadiah: GAME_PRIZE,
            timer: timer 
        };

        addUser(remoteJid, gameData);

        // 7. Kirim pesan soal
        const textMessage = `
*--- 🧩 GAME SUSUN KATA 🧩 ---*

Susunlah huruf-huruf berikut menjadi sebuah kata yang benar!
Kata Acak: *${scrambledWord}*
Hint: ${hint}

Hadiah: *Rp ${GAME_PRIZE.toLocaleString('id-ID')}*
Waktu: ${TIME_LIMIT / 1000} detik
-------------------------------------
Kirim jawaban Anda langsung di chat ini (tanpa prefix)
        `;

        await sock.sendMessage(
            remoteJid,
            { text: textMessage },
            { quoted: message }
        );
        
        logCustom('info', `Game Susun Kata (Botcahx) dimulai di ${remoteJid}. Kunci: ${correctAnswer}`, `GAME-START-BC.txt`);

    } catch (error) {
        console.error(`Error saat mengambil data Susun Kata dari API: ${error.message}`);
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Gagal mengambil soal dari API. Pesan error: ${error.message}` },
            { quoted: message }
        );
    }
}