import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { getLoadedPlugins } from "../lib/plugins.js";

const pluginsDir = path.join(process.cwd(), "plugins");

let cachedMenu = {};
let cachedSource = null; // array plugin yang dipakai membangun cachedMenu
let fallbackLoaded = false;

// Susun menu dari daftar plugin yang SUDAH dimuat oleh lib/plugins.js.
// Setiap plugin membawa __category (nama folder). Hasilnya:
//   { download: ["tiktok", "ytmp3", ...], group: [...], ... }
// Dengan begitu menu selalu sama persis dengan perintah yang benar-benar
// bisa dijalankan bot — plugin yang gagal dimuat tidak ikut tampil.
function buildFromLoaded(list) {
  const menu = {};
  for (const plugin of list) {
    if (!plugin || !Array.isArray(plugin.Commands)) continue;
    // Plugin boleh menyembunyikan diri dari menu (mis. perintah internal).
    if (plugin.HideFromMenu) continue;
    const category = plugin.__category || "lainnya";
    if (!menu[category]) menu[category] = [];
    menu[category].push(...plugin.Commands.filter((c) => typeof c === "string" && c));
  }
  for (const key of Object.keys(menu)) {
    menu[key] = [...new Set(menu[key])];
    if (!menu[key].length) delete menu[key];
  }
  // Urutkan kategori secara alfabet supaya tampilan menu konsisten.
  return Object.fromEntries(
    Object.keys(menu)
      .sort()
      .map((k) => [k, menu[k]])
  );
}

// Cadangan: kalau lib/plugins.js belum selesai memuat (mis. menu dipanggil
// di detik-detik pertama), baca folder sekali saja. TIDAK diulang tiap 30
// detik seperti dulu, karena import ulang = kebocoran memori.
async function loadMenuFromDisk() {
  const menu = {};
  const dirents = await fs.readdir(pluginsDir, { withFileTypes: true });

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;

    const category = dirent.name.toLowerCase();
    const categoryPath = path.join(pluginsDir, dirent.name);
    const commands = [];

    const files = await fs.readdir(categoryPath);
    for (const file of files) {
      if (!file.endsWith(".js")) continue;

      const filePath = path.join(categoryPath, file);

      try {
        const plugin = await import(pathToFileURL(filePath).href);
        const pluginDefault = plugin.default || plugin;

        if (pluginDefault.Commands && Array.isArray(pluginDefault.Commands)) {
          commands.push(...pluginDefault.Commands);
        }
      } catch (err) {
        console.error(`❌ Gagal load file ${filePath}:`, err.message);
      }
    }

    if (commands.length > 0) {
      menu[category] = [...new Set(commands)];
    }
  }

  return menu;
}

// Pastikan menu sudah di-load, dipanggil sebelum akses.
// Dibangun ulang hanya kalau daftar plugin berubah (hot reload).
export async function loadMenuOnce() {
  const loaded = getLoadedPlugins();
  if (Array.isArray(loaded) && loaded.length) {
    if (loaded !== cachedSource) {
      cachedMenu = buildFromLoaded(loaded);
      cachedSource = loaded;
    }
    return cachedMenu;
  }

  if (!fallbackLoaded) {
    fallbackLoaded = true;
    cachedMenu = await loadMenuFromDisk();
  }
  return cachedMenu;
}

// Proxy tetap bisa dipakai untuk akses langsung (non-await)
const menuProxy = new Proxy(
  {},
  {
    get(target, prop) {
      // Cek cache tapi tidak await
      loadMenuOnce().catch(console.error);
      return cachedMenu[prop];
    },
    ownKeys() {
      loadMenuOnce().catch(console.error);
      return Reflect.ownKeys(cachedMenu);
    },
    getOwnPropertyDescriptor() {
      loadMenuOnce().catch(console.error);
      return { enumerable: true, configurable: true };
    },
  }
);

export default menuProxy;
