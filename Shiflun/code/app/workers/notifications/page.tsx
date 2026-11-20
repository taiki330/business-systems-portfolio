import { AppHeader } from "@/components/layout/AppHeader";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
export default function WorkerNotificationsPage() {
  return <div className="app-page"><AppHeader title="お知らせ" description="お店からのスカウトや、メッセージの新着をまとめて。" backHref="/workers/mypage" backLabel="プロフィール" /><main><NotificationsClient role="worker" /></main></div>;
}
