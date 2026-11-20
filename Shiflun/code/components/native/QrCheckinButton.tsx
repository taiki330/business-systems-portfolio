"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useNativeApp } from "@/lib/hooks/use-native-app";

/**
 * 店舗に掲示された出勤用QRコードの中身から、アプリ内で開く打刻ページのパスを取り出す。
 * QRコードには「https://<サイト>/checkin?store=…&sig=…」が入っている（lib/utils/checkin-qr.ts）。
 * 署名（sig）の確認は打刻ページのサーバー側で行うので、ここでは /checkin のパスとクエリだけを使う。
 */
export function checkinPathFromQr(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname !== "/checkin" || !url.searchParams.get("store") || !url.searchParams.get("sig")) return null;
    const query = new URLSearchParams({ store: url.searchParams.get("store")!, sig: url.searchParams.get("sig")! });
    return `/checkin?${query.toString()}`;
  } catch {
    return null;
  }
}

/** アプリの中で、店舗の出勤用QRコードを読み取って打刻ページを開く。ブラウザでは出さない。 */
export function QrCheckinButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const native = useNativeApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!native) return null;

  async function scan() {
    setBusy(true); setError(null);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import("@capacitor/barcode-scanner");
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "店舗の出勤用QRコードを枠の中に写してください",
        cancelButtonAccessibilityLabel: "読み取りをやめる",
      });
      const path = checkinPathFromQr(result.ScanResult ?? "");
      if (!path) { setError("シフルンの出勤用QRコードではないようです。店舗に掲示されているコードを読み取ってください。"); return; }
      router.push(path);
    } catch (e) {
      // 読み取り画面を閉じたときもここに来る。カメラが使えないときだけ案内を出す。
      const message = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(message)) return;
      setError(/permission|denied|not authorized/i.test(message)
        ? "カメラの使用が許可されていません。端末の設定で、シフルンのカメラを許可してください。"
        : "QRコードを読み取れませんでした。もう一度お試しください。");
    } finally { setBusy(false); }
  }

  return <div className={className}>
    <button type="button" disabled={busy} onClick={() => void scan()} className="app-secondary w-full">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></svg>
      {busy ? "カメラを起動中…" : "店舗のQRコードで打刻する"}
    </button>
    {error && <p role="alert" className="app-error mt-2">{error}</p>}
  </div>;
}
