import { AppHeader } from "@/components/layout/AppHeader";
import { StoreScoutsClient } from "@/components/companies/StoreScoutsClient";
export const dynamic = "force-dynamic";
export default function StoreScoutsPage() {
  return <div className="app-page"><AppHeader title="送信済みスカウト" description="返信状況を確認できます。承諾されたらチャットで連絡できます。" /><main><StoreScoutsClient /></main></div>;
}
