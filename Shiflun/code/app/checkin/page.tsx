import { AppHeader } from "@/components/layout/AppHeader";
import { CheckinScanClient } from "@/components/workers/CheckinScanClient";
import { verifyStoreCheckin } from "@/lib/utils/checkin-qr";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ store?: string; sig?: string }>;
};

export default async function CheckinScanPage({ searchParams }: PageProps) {
  const { store, sig } = await searchParams;
  const storeName = store?.trim() ?? "";
  const valid = Boolean(storeName) && verifyStoreCheckin(storeName, sig ?? "");

  return (
    <div className="app-page">
      <AppHeader title="出退勤打刻" description={storeName} backHref="/workers/shifts" backLabel="シフトへ" />
      <main>
        {!valid ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
            <p className="text-sm font-semibold text-rose-800">
              QRコードが正しくありません。店舗のQRコードを読み取り直してください。
            </p>
          </div>
        ) : (
          <CheckinScanClient storeName={storeName} />
        )}
      </main>
    </div>
  );
}
