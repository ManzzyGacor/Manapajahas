import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pluginsPath = path.join(process.cwd(), "plugins");
let plugins = [];

// Kategori = nama folder langsung di bawah plugins/ (mis. "DOWNLOAD").
// Plugin yang berada langsung di plugins/ (menu.js, owner.js) masuk "main".
function categoryOf(fullPath) {
  const rel = path.relative(pluginsPath, fullPath);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0].toLowerCase() : "main";
}

async function loadPlugins(directory) {
  const loadedPlugins = [];

  try {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      const fullPath = path.join(directory, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        const subPlugins = await loadPlugins(fullPath);
        loadedPlugins.push(...subPlugins);
      } else if (file.endsWith(".js")) {
        try {
          // Dynamic import ESM untuk Windows & Linux
          const plugin = await import(
            pathToFileURL(fullPath).href + "?cacheBust=" + Date.now()
          );
          const mod = plugin.default || plugin;

          // Modul tanpa Commands/handle bukan plugin perintah: dilewati
          // supaya autoresbot.js tidak crash saat memanggil .includes().
          if (!Array.isArray(mod?.Commands) || typeof mod?.handle !== "function") {
            continue;
          }

          // Metadata ini dipakai menu (database/menu.js) untuk mengelompokkan
          // perintah per kategori TANPA meng-import ulang semua plugin.
          // Dulu menu meng-import ~330 file setiap 30 detik — modul ESM tidak
          // bisa dibuang dari memori, jadi itu kebocoran memori yang terus
          // bertambah selama bot hidup.
          // Modul namespace (export bernama) bersifat read-only, jadi
          // metadata hanya ditempel kalau objeknya bisa ditulisi.
          const meta = {
            __category: categoryOf(fullPath),
            __file: path.relative(process.cwd(), fullPath),
          };
          const target = Object.isExtensible(mod) ? mod : { ...mod };
          Object.assign(target, meta);
          loadedPlugins.push(target);
        } catch (error) {
          console.error(
            `❌ ERROR : Gagal memuat plugin: ${fullPath} : ${error}`
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `❌ ERROR: Gagal membaca direktori: ${directory} - ${error.message}`
    );
  }

  return loadedPlugins;
}

async function reloadPlugins() {
  plugins = await loadPlugins(pluginsPath);
  if (plugins.length === 0) {
    console.warn("⚠️ WARNING: Tidak ada plugin yang dimuat.");
  }
  return plugins;
}

// Daftar plugin yang sedang aktif (hasil reloadPlugins terakhir).
function getLoadedPlugins() {
  return plugins;
}

export { reloadPlugins, getLoadedPlugins };
