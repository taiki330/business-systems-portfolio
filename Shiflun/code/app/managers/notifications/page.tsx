import { AppHeader } from "@/components/layout/AppHeader";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
export default function StoreNotificationsPage() {
  return <div className="app-page"><AppHeader title="お知らせ" description="スカウトへの返信や、メッセージの新着を確認できます。" backHref="/managers/more" backLabel="その他" /><main><NotificationsClient role="store" /></main></div>;
}
