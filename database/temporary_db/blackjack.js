/**
 * Database sementara (in-memory) untuk permainan Blackjack PvP.
 * Menyimpan status permainan berdasarkan remoteJid (biasanya ID grup/room).
 *
 * Catatan: Semua fungsi 'User' diganti menjadi 'Game'/'Group'/'Player'
 * untuk mendukung logika PvP (per game per room).
 */
const blackjackGames = {};

/**
 * Menambah/membuat data game baru.
 * Fungsi ini yang dibutuhkan oleh plugin.
 * @param {string} remoteJid - ID ruangan.
 * @param {object} gameData - Data game.
 */
function addGame(remoteJid, gameData) {
  blackjackGames[remoteJid] = gameData;
}

/**
 * Menghapus data game.
 * @param {string} remoteJid - ID ruangan.
 */
function removeGame(remoteJid) {
  delete blackjackGames[remoteJid];
}

/**
 * Mengambil data game.
 * @param {string} remoteJid - ID ruangan.
 * @returns {object | undefined} Data game atau undefined.
 */
function getGame(remoteJid) {
  return blackjackGames[remoteJid];
}

/**
 * Memperbarui data game.
 * @param {string} remoteJid - ID ruangan.
 * @param {object} updates - Objek berisi properti yang akan diupdate.
 */
function updateGame(remoteJid, updates) {
  if (blackjackGames[remoteJid]) {
    blackjackGames[remoteJid] = { ...blackjackGames[remoteJid], ...updates };
    return true;
  }
  return false;
}

/**
 * Cek apakah grup/room sedang bermain.
 * @param {string} remoteJid - ID ruangan.
 */
function isGroupPlaying(remoteJid) {
  return !!blackjackGames[remoteJid];
}

/**
 * Cek apakah user sedang bermain di room manapun (melalui player1 atau player2).
 * @param {string} userId - ID pengguna.
 */
function isUserPlaying(userId) {
  return Object.values(blackjackGames).some(
    (game) => game.player1 === userId || game.player2 === userId
  );
}

// PASTIKAN SEMUA FUNGSI BERIKUT DIEKSPOR:
export {
  addGame, // <--- FUNGSI INI HARUS ADA DAN DIEKSPOR
  removeGame,
  getGame,
  updateGame,
  isGroupPlaying,
  isUserPlaying,
};