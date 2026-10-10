import {
  addUser,
  removeUser,
  isUserPlaying
} from "../../database/temporary_db/game_session.js";
import config from "../../config.js";
import { logCustom } from "../../lib/logger.js";
import fetch from 'node-fetch'; // Pastikan Anda mengimpor node-fetch

// --- Pengaturan API ---
const API_KEY = config.ANABOT_APIKEY || "freeApikey";
const BASE_URL = "https://anabot.my.id";
const ENDPOINT = "/api/games/fun/lengkapikalimat";

// --- Konfigurasi Game ---
const TIME_LIMIT = 60000; // 60 detik
const GAME_PRIZE = 20;
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 Menit

// --- Metadata Plugin ---
export const Name = "lengkapikata";
export const Commands = ["lengkapikata"];
export const Description = "Game melengkapi kalimat dari API Anabot.";
export const OnlyGroup = true;
export const limitDeduction = 1;

const cooldowns = {};

export async function handle(sock, messageInfo) {
    const { remoteJid, message } = messageInfo;

    // 1. Cek jika ada game yang sedang berlangsung
    if (isUserPlaying(remoteJid)) {
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Game sebelumnya belum selesai. Silakan jawab terlebih dahulu atau tunggu hingga waktu habis.` },
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
            { text: `⏳ *Jeda Bermain*\n\nHarap tunggu *${menit} menit ${detik} detik* lagi sebelum bermain Lengkapi Kata kembali.\n\n_🚫 Mohon untuk tidak melakukan spam command agar bot tetap stabil._` },
            { quoted: message }
        );
        return;
    }

    try {
        // 3. Ambil data soal dari API
        const url = `${BASE_URL}${ENDPOINT}?apikey=${API_KEY}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Gagal menghubungi API. Status: ${response.status}`);
        }

        const jsonResponse = await response.json();

        // 4. Validasi respons API
        if (!jsonResponse.success || !jsonResponse.data?.pertanyaan || !jsonResponse.data?.jawaban) {
            throw new Error("Format respons dari API tidak valid atau soal tidak tersedia.");
        }

        const soal = jsonResponse.data.pertanyaan;
        const jawaban = jsonResponse.data.jawaban;
        const correctAnswer = jawaban.toLowerCase().trim();

        // 5. Atur timer
        const timer = setTimeout(async () => {
            if (isUserPlaying(remoteJid)) {
                await sock.sendMessage(
                  remoteJid,
                  { text: `⌛ Waktu habis! Jawaban yang benar adalah: *${jawaban.toUpperCase()}*` }
                );
                removeUser(remoteJid);
                logCustom('info', `Game Lengkapi Kata habis waktu di ${remoteJid}`, `GAME-TIMEOUT.txt`);
            }
        }, TIME_LIMIT);

        // 6. Update Cooldown
        cooldowns[remoteJid] = now;

        // 7. Simpan sesi game
        const gameData = {
            game: 'lengkapikata',
            answer: correctAnswer,
            hadiah: GAME_PRIZE,
            timer: timer
        };
        addUser(remoteJid, gameData);

        // 8. Kirim pesan soal
        const textMessage = `
*--- 📝 GAME LENGKAPI KATA 📝 ---*

Lengkapi kalimat berikut:
Soal: *${soal}*

Hadiah: *Rp ${GAME_PRIZE.toLocaleString('id-ID')}*
Waktu: ${TIME_LIMIT / 1000} detik
-------------------------------------
Kirim jawaban Anda langsung di chat ini (tanpa prefix).
        `;

        await sock.sendMessage(
            remoteJid,
            { text: textMessage },
            { quoted: message }
        );

        logCustom('info', `Game Lengkapi Kata (Anabot) dimulai di ${remoteJid}. Kunci: ${correctAnswer}`, `GAME-START-ANABOT.txt`);

    } catch (error) {
        console.error(`Error pada game Lengkapi Kata: ${error.message}`);
        await sock.sendMessage(
            remoteJid,
            { text: `❌ Gagal memulai game. Terjadi kesalahan: ${error.message}` },
            { quoted: message }
        );
    }
}