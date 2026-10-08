
import moment from "moment-timezone";

const CONNECTION = "pairing"; // qr atau pairing
const OWNER_NAME = "Manzzy";
const NOMOR_BOT = process.env.BOT_NUMBER || ""; // 628xx nomor wa
const BOT_NAME = "Varesa MultiDevice"; 
const BOT_MEDIA = "https://raw.githubusercontent.com/ManzzyGacor/Urlmanzzy/main/file_1763982754350_735.mp4"; // Bisa diisi link image atau video buat menu
const DESTINATION = "group"; // group , private, both
const APIKEY = process.env.AUTORESBOT_APIKEY || ""; // apikey dari autoresbot.com 
const APIBOTCAHX = process.env.APIBOTCAHX || "Varesa"; 
const ANABOT_APIKEY = process.env.ANABOT_APIKEY || "";
// Kunci api.jerexd.my.id (brat, spotify, play, gpt, cekwa, autoreact).
// Dulu ditulis langsung di 6 plugin berbeda; sekarang satu tempat dan
// bisa diganti lewat .env tanpa menyentuh kode.
const JEREXD_APIKEY = process.env.JEREXD_APIKEY || "VaresaMD";
const RATE_LIMIT = 3000; // 3 detik/chat
const SIMILARITY = true; // Pencarian kemiripan command (true, false)
// [production, development] — bisa di-set lewat BOT_MODE di .env.
// development: hot reload plugin + log terminal lengkap + file log error.
const MODE = process.env.BOT_MODE === "production" ? "production" : "development";
const VERSION = global.version; // don't edit

const EMAIL = "varesabot@gmail.com";
const REGION = "Indonesia";
// Alamat web dashboard Varesa. Semua balasan bot yang menyuruh user
// daftar/upgrade/sewa/beli memakai ini, supaya bot & website nyambung.
// Garis miring di akhir dibuang agar `${web_url}/dashboard` tetap rapi.
const WEB_URL = (process.env.WEB_URL || "https://varesa.mom").replace(/\/+$/, "");
const WEBSITE = WEB_URL.replace(/^https?:\/\//, "");
const DATA_OWNER = (process.env.OWNER_NUMBERS || "").split(",").map((n) => n.trim()).filter(Boolean);

// Konfiqurasi Chat
const ANTI_CALL = false; // jika true (setiap yang nelpon pribadi akan di block)
const AUTO_READ = true; // jika true (setiap chat akan di baca/centang 2 biru)
const AUTO_BACKUP = false; // jika true (setiap restart server, data backup di kirimkan ke wa owner);
const MIDNIGHT_RESTART = false; // Restart setiap jam 12 malam
const PRESENCE_UPDATE = ""; // unavailable, available, composing, recording, paused
const TYPE_WELCOME = "image"; // image,teks,random
const BG_WELCOME2 = "https://telegra.ph/file/666ccbfc3201704454ba5.jpg";

// Konfiqurasi Panel
const PANEL_URL = "";
const PANEL_PLTA = "";
const PANEL_DESCRIPTION = "Butuh Bantuan Hubungi 628xxxxx";
const PANEL_ID_EGG = 15;
const PANEL_ID_LOCATION = 1;
const PANEL_DEFAULT_DISK = 5120; // 5GB atau 0 (unlimited)
const PANEL_DEFAULT_CPU = 90;

// antibadword di grub
const BADWORD_WARNING = 3; // Jumlah maksimum peringatan sebelum tindakan diambil
const BADWORD_ACTION = "block"; // tindakan setelah warning terpenuhi (kick, block, both)

// antispam di grub
const SPAM_LIMIT = 5; // Batas pesan dianggap spam
const SPAM_COULDOWN = 10; // Waktu cooldown dalam detik (10 detik)
const SPAM_WARNING = 3; // Jumlah maksimum peringatan sebelum tindakan diambil
const SPAM_ACTION = "block"; // tindakan setelah warning terpenuhi (kick, block, both)

// More
const STATUS_SCHEDULED = true;

const config = {
  APIKEY,
  ANABOT_APIKEY,
  APIBOTCAHX,
  JEREXD_APIKEY,
  phone_number_bot: NOMOR_BOT,
  type_connection: CONNECTION,
  bot_destination: DESTINATION,
  owner_name: OWNER_NAME,
  owner_number: DATA_OWNER,
  bot_name: BOT_NAME,
  bot_media: BOT_MEDIA,
  owner_website: WEBSITE,
  web_url: WEB_URL,
  product_name: "Varesa",
  owner_email: EMAIL,
  region: REGION,
  version: VERSION,
  rate_limit: RATE_LIMIT,
  status_prefix: true, // wajib prefix : atau false tanpa prefix
  prefix: ["."],
  sticker_packname: OWNER_NAME,
  sticker_author: `Date: ${moment
    .tz("Asia/Jakarta")
    .format("DD/MM/YY")}\nVaresa MultiDevice\nManzzy`,
  mode: MODE,
  commandSimilarity: SIMILARITY,
  anticall: ANTI_CALL,
  autoread: AUTO_READ,
  autobackup: AUTO_BACKUP,
  PresenceUpdate: PRESENCE_UPDATE,
  typewelcome: TYPE_WELCOME,
  bgwelcome2: BG_WELCOME2,
  midnight_restart: MIDNIGHT_RESTART,
  scheduled: STATUS_SCHEDULED,
  PANEL: {
    URL: PANEL_URL,
    KEY_APPLICATION: PANEL_PLTA,
    description: PANEL_DESCRIPTION,
    SERVER_EGG: PANEL_ID_EGG,
    id_location: PANEL_ID_LOCATION,
    default_disk: PANEL_DEFAULT_DISK,
    cpu_default: PANEL_DEFAULT_CPU,
  },
  SPAM: {
    limit: SPAM_LIMIT,
    couldown: SPAM_COULDOWN,
    warning: SPAM_WARNING,
    action: SPAM_ACTION,
  },
  BADWORD: {
    warning: BADWORD_WARNING,
    action: BADWORD_ACTION,
  },
};

export default config;
