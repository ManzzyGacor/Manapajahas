import fs from "fs";
import path from "path";
import config from "../config.js";
import { logWithTime } from "./utils.js";
import { pathToFileURL } from "url";

const mode = config.mode; 

const handlers = []; // Array lokal untuk Pre-processors/Handlers

// Inisialisasi global.plugins agar tidak undefined
global.plugins = []; 

// Kategori tiap plugin = nama folder pertama di bawah plugins/ (mis.
// plugins/DOWNLOAD/tiktok.js -> "DOWNLOAD"). Dipakai /api/public/features
// untuk mengelompokkan fitur di halaman depan.
//
// Disimpan di WeakMap, bukan hanya sebagai properti: plugin yang memakai
// named export (mis. plugins/owner.js) berupa objek namespace modul yang
// tidak bisa ditambahi properti — menulis ke sana akan melempar TypeError
// dan membuat plugin itu gagal dimuat.
const pluginCategories = new WeakMap();
const PLUGINS_ROOT = path.join(process.cwd(), "plugins");
const DEFAULT_CATEGORY = "LAINNYA";

function categoryOf(fullPath) {
  const rel = path.relative(PLUGINS_ROOT, fullPath);
  // File di luar plugins/ (folder handle/) atau langsung di root plugins/.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return DEFAULT_CATEGORY;
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0] : DEFAULT_CATEGORY;
}

/** Kategori plugin ("DOWNLOAD", "GAMES", ..., atau "LAINNYA"). */
export function getPluginCategory(plugin) {
  if (!plugin || typeof plugin !== "object") return DEFAULT_CATEGORY;
  return pluginCategories.get(plugin) || plugin.__category || DEFAULT_CATEGORY;
}

// Fungsi rekursif untuk membaca semua file .js
async function loadHandlers(dir) {
  // Cek apakah folder ada sebelum mencoba membaca
  if (!fs.existsSync(dir)) return;

  const files = await fs.promises.readdir(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stats = await fs.promises.stat(fullPath);

    if (stats.isDirectory()) {
      await loadHandlers(fullPath); // Rekursi ke sub-folder
    } else if (file.endsWith(".js")) {
      try {
        // Import module secara dinamis
        const module = await import(
          pathToFileURL(fullPath).href + `?update=${Date.now()}`
        );
        const handler = module.default || module;

        // 1. Cek apakah ini SYSTEM HANDLER (punya process function)
        // Biasanya ada di folder 'handle' (seperti menu.js)
        if (typeof handler.process === "function") {
          if (typeof handler.priority === "undefined") {
            handler.priority = 100; 
          }
          handlers.push(handler);
        }
        
        // 2. Cek apakah ini COMMAND PLUGIN (punya Commands array & handle function)
        // Biasanya ada di folder 'plugins' (seperti sewa.js, totalfitur.js)
        if (Array.isArray(handler.Commands) && typeof handler.handle === 'function') {
            const category = categoryOf(fullPath);
            pluginCategories.set(handler, category);
            if (Object.isExtensible(handler)) {
              try {
                Object.defineProperty(handler, "__category", { value: category, configurable: true, writable: true, enumerable: false });
              } catch { /* cukup dari WeakMap */ }
            }
            global.plugins.push(handler);
        }

      } catch (err) {
        console.error(`❌ Gagal load plugin di ${fullPath}:`, err.message);
      }
    }
  }
}

// Fungsi utama untuk memulai loading
export async function initHandlers() {
  console.log("[⏳] Sedang memuat plugin...");

  // 1. Load folder 'handle' (System Handlers: menu.js, dll)
  await loadHandlers(path.join(process.cwd(), "handle")); 
  
  // 2. Load folder 'plugins' (Feature Plugins: sewa.js, totalfitur.js, dll)
  // >>> INI YANG SEBELUMNYA KURANG <<<
  await loadHandlers(path.join(process.cwd(), "plugins")); 

  // Sort system handlers berdasarkan prioritas
  handlers.sort((a, b) => a.priority - b.priority);
  
  // Log hasil loading
  console.log(`[✔] Selesai memuat.`);
  logWithTime("System", `Handlers Loaded: ${handlers.length} | Command Plugins Loaded: ${global.plugins.length}`);
}

// ... Bagian bawah (export preProcess) tetap sama, tidak perlu diubah ...
// ... Sisa kode export preProcess, dll. (Tidak perlu diubah) ...

// Fungsi preProcess yang diekspor
export async function preProcess(sock, messageInfo) {
  let stopProcessing = false;

  for (const handler of handlers) {
    if (stopProcessing) break;

    try {
      const result = await handler.process(sock, messageInfo);

      if (result === false) {
        logWithTime(
          "System",
          `Handler ${handler.name || "anonymous"} menghentikan pemrosesan.`
        );
        stopProcessing = true;
        return false;
      }
    } catch (error) {
      console.error(
        `Error pada handler ${handler.name || "anonymous"}:`,
        error.message
      );
    }
  }

  return true;
}

export default {
  initHandlers,
  preProcess,
  handlers,
  getPluginCategory,
};
