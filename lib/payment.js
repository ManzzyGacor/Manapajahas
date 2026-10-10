/**
 * lib/payment.js
 *
 * Integrasi payment gateway AutoGopay (QRIS).
 *
 * Aturan yang ditegakkan di sini:
 *  - Satu user hanya boleh punya SATU invoice pending. Harus dibatalkan
 *    dulu sebelum bisa membuat QRIS baru.
 *  - Invoice otomatis dibatalkan setelah 5 menit.
 *  - Webhook wajib lolos verifikasi signature HMAC-SHA256.
 */

import crypto from "crypto";

const BASE_URL = "https://v1-gateway.autogopay.site";

// JANGAN hardcode di sini. Isi lewat environment variable:
//   AUTOGOPAY_API_KEY=agp_xxx
export const API_KEY = process.env.AUTOGOPAY_API_KEY || "";

if (!API_KEY) {
  console.warn(
    "[payment] AUTOGOPAY_API_KEY belum diisi. " +
    "Pembuatan QRIS akan gagal sampai variabel ini diset."
  );
}

// Invoice hangus setelah 5 menit, meski gateway memberi 15 menit.
export const INVOICE_TTL_MS = 5 * 60 * 1000;

function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function callGateway(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // Respons bukan JSON — biasanya halaman error dari proxy.
    throw new Error(`Respons gateway tidak valid (${res.status}): ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data?.message || `Gateway menolak permintaan (${res.status}).`);
  }
  return data;
}

/**
 * Buat QRIS baru.
 * @returns {{transactionId, orderId, amount, qrString, qrUrl, checkoutUrl, expiryTime}}
 */
export async function createQris(amount) {
  const data = await callGateway("/qris/generate", { amount });

  const d = data?.data;
  if (!data.success || !d?.qr_string) {
    throw new Error(data?.message || "Gateway tidak mengembalikan QR.");
  }

  return {
    transactionId: d.transaction_id,
    orderId: d.order_id,
    amount: d.amount,
    qrString: d.qr_string,
    // qr_url dipakai langsung sebagai <img src>, jadi gambar QRIS pasti
    // tampil walau library QR di browser gagal dimuat.
    qrUrl: d.qr_url || "",
    checkoutUrl: d.checkout_url || "",
    expiryTime: d.expiry_time || "",
  };
}

/** Cek status transaksi. Nilai: pending | settlement | expire | cancel */
export async function checkQrisStatus(transactionId) {
  try {
    const data = await callGateway("/qris/status", { transaction_id: transactionId });
    return data?.data?.transaction_status || "";
  } catch (err) {
    console.error("[payment] gagal cek status:", err.message);
    return "";
  }
}

/** Batalkan transaksi di sisi gateway. */
export async function cancelQris(transactionId) {
  try {
    const data = await callGateway("/qris/cancel", { transaction_id: transactionId });
    return !!data?.success;
  } catch (err) {
    console.error("[payment] gagal batalkan:", err.message);
    return false;
  }
}

/**
 * Verifikasi signature webhook (HMAC-SHA256, API Key sebagai secret).
 *
 * rawBody HARUS berupa body mentah, bukan hasil JSON.stringify ulang dari
 * objek yang sudah di-parse — urutan kunci bisa berubah dan signature
 * jadi tidak cocok.
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !API_KEY) return false;

  const expected = crypto
    .createHmac("sha256", API_KEY)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual mencegah kebocoran informasi lewat lama pembandingan.
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Status dari gateway -> status internal kita. */
export function mapStatus(gatewayStatus) {
  switch (String(gatewayStatus).toLowerCase()) {
    case "settlement":
    case "paid":
      return "completed";
    case "expire":
    case "expired":
      return "expired";
    case "cancel":
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

export default {
  API_KEY,
  INVOICE_TTL_MS,
  createQris,
  checkQrisStatus,
  cancelQris,
  verifyWebhookSignature,
  mapStatus,
};
