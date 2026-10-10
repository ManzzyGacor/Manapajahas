// File: database/temporary_db/game_session.js

// Objek untuk menyimpan sesi game
const gameSession = {};

/**
 * Menambahkan sesi game baru untuk JID tertentu.
 * @param {string} jid - JID (ID Chat) user/grup.
 * @param {object} data - Data sesi game (misalnya, { answer: 'dokter', hadiah: 1000, timer: ... }).
 */
export const addUser = (jid, data) => {
  gameSession[jid] = data;
};

/**
 * Menghapus sesi game user.
 * @param {string} jid - JID user/grup.
 */
export const removeUser = (jid) => {
  if (gameSession[jid]) {
    // Matikan timer untuk mencegah pesan 'Waktu Habis' setelah game selesai
    if (gameSession[jid].timer) {
      clearTimeout(gameSession[jid].timer);
    }
    delete gameSession[jid];
  }
};

/**
 * Memeriksa apakah user sedang bermain game.
 * @param {string} jid - JID user/grup.
 * @returns {boolean} - True jika sedang bermain.
 */
export const isUserPlaying = (jid) => {
  return !!gameSession[jid];
};

/**
 * Mengambil data sesi game aktif.
 * @param {string} jid - JID user/grup.
 * @returns {object | undefined} - Objek sesi game atau undefined.
 */
export const getGameSession = (jid) => {
  return gameSession[jid];
};

export default {
  addUser,
  removeUser,
  isUserPlaying,
  getGameSession,
};