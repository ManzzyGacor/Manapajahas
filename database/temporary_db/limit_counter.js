// Struktur data untuk menyimpan hitungan penggunaan harian per JID dan per Command.

// Format: Map<jid, Map<command, { usage: number, timestamp: number }>>

const dailyUsage = new Map();

// Waktu reset harian (24 jam)

const DAILY_RESET_TIME = 24 * 60 * 60 * 1000; // 86400000 ms

/**

 * Memeriksa status limit penggunaan harian untuk pengguna dan perintah tertentu.

 * * @param {string} jid - ID pengguna/chat (remoteJid).

 * @param {string} command - Nama perintah (e.g., 'reactch').

 * @param {number} maxLimit - Batas maksimum penggunaan harian.

 * @returns {Promise<{isLimitReached: boolean, currentUsage: number}>} Status limit.

 */

async function checkLimit(jid, command, maxLimit) {

    const now = Date.now();

    let userCommands = dailyUsage.get(jid);

    if (!userCommands) {

        // Pengguna baru, inisialisasi Map

        userCommands = new Map();

        dailyUsage.set(jid, userCommands);

    }

    let commandData = userCommands.get(command);

    if (!commandData || (now - commandData.timestamp > DAILY_RESET_TIME)) {

        // Data belum ada atau sudah kedaluwarsa (lebih dari 24 jam)

        commandData = { usage: 0, timestamp: now };

        userCommands.set(command, commandData);

    }

    const isLimitReached = commandData.usage >= maxLimit;

    

    return {

        isLimitReached: isLimitReached,

        currentUsage: commandData.usage

    };

}

/**

 * Menambahkan 1 ke hitungan limit penggunaan harian.

 * Harus dipanggil hanya setelah checkLimit memastikan limit belum tercapai.

 * * @param {string} jid - ID pengguna/chat (remoteJid).

 * @param {string} command - Nama perintah (e.g., 'reactch').

 * @returns {Promise<void>}

 */

async function updateLimit(jid, command) {

    const now = Date.now();

    let userCommands = dailyUsage.get(jid);

    // Ini seharusnya selalu ada karena checkLimit dipanggil sebelumnya, 

    // tapi kita jaga-jaga untuk inisialisasi

    if (!userCommands) {

        userCommands = new Map();

        dailyUsage.set(jid, userCommands);

    }

    let commandData = userCommands.get(command);

    if (!commandData || (now - commandData.timestamp > DAILY_RESET_TIME)) {

        // Reset jika kedaluwarsa

        commandData = { usage: 1, timestamp: now };

    } else {

        // Tambahkan hitungan

        commandData.usage += 1;

        // Perbarui timestamp untuk mencerminkan penggunaan terakhir (tidak wajib, tapi lebih akurat)

        commandData.timestamp = now; 

    }

    userCommands.set(command, commandData);

}

// Tambahkan fungsi untuk mendapatkan sisa limit, berguna untuk pesan sukses.

/**

 * Mendapatkan sisa limit harian.

 * @param {string} jid - ID pengguna/chat (remoteJid).

 * @param {string} command - Nama perintah.

 * @param {number} maxLimit - Batas maksimum penggunaan harian.

 * @returns {Promise<number>} Sisa limit.

 */

async function getRemainingLimit(jid, command, maxLimit) {

    const status = await checkLimit(jid, command, maxLimit);

    return maxLimit - status.currentUsage;

}

export {

    checkLimit,

    updateLimit,

    getRemainingLimit

};