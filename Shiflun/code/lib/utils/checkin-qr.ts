import { createHmac, timingSafeEqual } from "crypto";
import QRCode from "qrcode";

const FALLBACK_SECRET = "shiflun-demo-checkin-secret-not-for-production";

function getSecret(): string {
  const secret = process.env.CHECKIN_QR_SECRET;
  if (!secret) {
    // デモ用フォールバック。本番導入前に CHECKIN_QR_SECRET を必ず設定すること。
    return FALLBACK_SECRET;
  }
  return secret;
}

/** 店舗設置QR用の署名。店舗名の改ざん・推測を防ぐための簡易対策（本番では別途要検討）。 */
export function signStoreCheckin(storeName: string): string {
  return createHmac("sha256", getSecret())
    .update(storeName)
    .digest("hex")
    .slice(0, 16);
}

export function verifyStoreCheckin(storeName: string, signature: string): boolean {
  const expected = signStoreCheckin(storeName);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildCheckinUrl(origin: string, storeName: string): string {
  const params = new URLSearchParams({
    store: storeName,
    sig: signStoreCheckin(storeName),
  });
  return `${origin}/checkin?${params.toString()}`;
}

/** 店舗掲示用のQRコードをdata URL（PNG）として生成する。 */
export async function buildCheckinQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 320 });
}
