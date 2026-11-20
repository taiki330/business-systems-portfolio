import { AppHeader } from "@/components/layout/AppHeader";
import { ChatInboxClient } from "@/components/chat/ChatInboxClient";
export const dynamic = "force-dynamic";
export default function StoreChatInboxPage() {
  return <div className="app-page"><AppHeader title="チャット" description="所属スタッフとのシフト相談や、スカウトしたワーカーとのやり取り。" /><main><ChatInboxClient role="store" /></main></div>;
}
