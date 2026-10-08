// lib/canvas/welcome.js
import { createCanvas, loadImage } from "canvas"; 
import { getBuffer } from "../utils.js";

// Background & default asset
const WELCOME_BG = "https://telegra.ph/file/666ccbfc3201704454ba5.jpg";
const DEFAULT_AVATAR = "https://i.ibb.co/Yj1kTdQ/default-avatar.png";

// Helper: load image via buffer → aman untuk URL luar
async function loadImageSafe(url, fallbackUrl) {
  const candidates = [url, fallbackUrl].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const buf = await getBuffer(candidate);
      if (!buf) continue;
      const img = await loadImage(buf);
      return img;
    } catch (e) {
      console.warn("Gagal load image welcome:", candidate, e.message);
    }
  }
  return null;
}

/**
 * Generate welcome image (Canvas) Rata Kiri di KIRI ATAS.
 */
export async function generateWelcomeCanvas({
  ppUser,
  pushName,
  memberCount, 
  groupName,
}) {
  const width = 1000;
  const height = 500;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Pengaturan Posisi Avatar
  const avatarSize = 160;
  const startX = 100; // Jarak dari Kiri
  const startY = 100; // Jarak dari Atas
  
  // 🚨 TITIK START TEKS RATA KIRI BARU (Di sebelah kanan Avatar) 🚨
  const textStartX = startX + avatarSize + 40; // 40px jarak dari Avatar
  // Kita akan menggunakan textStartX sebagai X untuk semua teks

  // 1. 🖼 Background utama (FULL)
  const bg = await loadImageSafe(WELCOME_BG);
  if (bg) {
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#000000"; 
    ctx.fillRect(0, 0, width, height);
  }
  
  // 2. 🧑 Avatar user (lingkaran di KIRI ATAS)
  const avatarY = startY; 

  const avatarImg = await loadImageSafe(ppUser, DEFAULT_AVATAR);
  
  if (avatarImg) {
    ctx.save();
    ctx.beginPath();
    // Pusat lingkaran: (startX + radius, avatarY + radius)
    ctx.arc(startX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2); 
    ctx.clip();
    ctx.drawImage(avatarImg, startX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  }

  // --- POSISI TEKS RATA KIRI (Di sebelah kanan Avatar) ---

  // 🚨 PENTING: Mengatur alignment menjadi RATA KIRI 🚨
  ctx.textAlign = "left"; 

  // Tentukan Posisi Y Awal (Agar vertikalnya di tengah Avatar)
  // Tinggi total teks yang akan kita gambar (kurang lebih): 40+45+35 = 120px
  // Pusat vertikal Avatar: startY + avatarSize / 2 = 100 + 80 = 180
  // Pusat vertikal Teks: startY + (avatarSize / 2) - (TinggiTeks / 2)
  const totalTextHeight = 40 + 45 + 35; // Perkiraan total tinggi teks dan spasi
  let currentY = startY + (avatarSize / 2) - (totalTextHeight / 2) + 15; // +15 untuk penyesuaian font base

  
  // 3. 📝 Teks "WELCOME, [Username]"
  const displayName = pushName || "New Member";
  const welcomeText = `WELCOME, ${displayName}`;
  
  ctx.font = "bold 40px Sans-serif";
  ctx.save();
  ctx.fillStyle = "#FFFFFF"; 
  ctx.fillText(welcomeText, textStartX, currentY);
  ctx.restore();
  
  currentY += 45; // Turun 45px untuk baris berikutnya

  // 4. 👥 Nama Grup
  const groupNameText = groupName || 'Nama Grup';
  
  ctx.font = "28px Sans-serif";
  ctx.save();
  ctx.fillStyle = "#FFFFFF"; 
  ctx.fillText(`Di Grup: ${groupNameText}`, textStartX, currentY); 
  ctx.restore();

  currentY += 35; // Turun 35px untuk baris berikutnya

  // 5. 🌟 Member Count (Member Ke-X)
  const count = memberCount !== undefined ? memberCount : 'XX'; 
  const memberCountText = `Member Ke-${count}`;
  
  ctx.font = "20px Sans-serif";
  ctx.save();
  ctx.fillStyle = "#FFFFFF"; 
  ctx.fillText(memberCountText, textStartX, currentY); 
  ctx.restore();


  return canvas.toBuffer("image/png");
}