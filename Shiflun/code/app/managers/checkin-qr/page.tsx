import { AppHeader } from "@/components/layout/AppHeader";
import { CheckinQrForm } from "@/components/managers/CheckinQrForm";
import { buildCheckinQrDataUrl, buildCheckinUrl } from "@/lib/utils/checkin-qr";
import { getSiteOrigin } from "@/lib/utils/site-url";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ store?: string }>;
};

export default async function CheckinQrPage({ searchParams }: PageProps) {
  const { store } = await searchParams;
  const storeName = store?.trim();

  let qrDataUrl: string | null = null;
  let checkinUrl: string | null = null;

  if (storeName) {
    const origin = await getSiteOrigin();
    checkinUrl = buildCheckinUrl(origin, storeName);
    qrDataUrl = await buildCheckinQrDataUrl(checkinUrl);
  }

  return (
    <div className="app-page">
      <AppHeader
        title="出勤QRコード"
        description="店舗に掲示するQRコードを発行します。ワーカーがスマホで読み取ると出退勤を打刻できます。"
        backHref="/managers/more" backLabel="その他"
      />
      <main className="flex flex-col gap-4">
        <CheckinQrForm defaultStoreName={storeName ?? ""} />

        {storeName && qrDataUrl && checkinUrl && (
          <section className="rounded-xl border border-line bg-white p-5 text-center">
            <p className="mb-3 text-sm font-bold text-ink">{storeName}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`${storeName} 出勤用QRコード`}
              className="mx-auto h-64 w-64"
            />
            <p className="mt-3 break-all font-mono text-xs text-ink-soft">{checkinUrl}</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              印刷してレジ横など見える場所に掲示してください。ワーカーは自分のスマホで読み取り、今日の勤務がある場合のみ出退勤を打刻できます。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
