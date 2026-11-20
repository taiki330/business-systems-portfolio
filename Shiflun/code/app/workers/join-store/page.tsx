import { AppHeader } from "@/components/layout/AppHeader";
import { JoinStoreForm } from "@/components/workers/JoinStoreForm";
import { redirect } from "next/navigation";
import { getStores } from "@/lib/actions/stores";
import { getCurrentWorker } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function JoinStorePage() {
  // 1つのログインで登録できるワーカーは1人。登録済みならマイページへ。
  if (await getCurrentWorker()) redirect("/workers/mypage");
  const { stores, error } = await getStores();

  return (
    <div className="app-page">
      <AppHeader
        title="働いている店舗を登録"
        description="Shiflunに登録済みの店舗の中から選んで、本人の自己申告で登録します。店長の承認は不要です。所属登録と経験認証は別のものです。"
        backHref="/" backLabel="トップ"
      />
      <main>
        {error && <p role="alert" className="app-error mb-4">{error}</p>}
        <JoinStoreForm stores={stores} />
      </main>
    </div>
  );
}
