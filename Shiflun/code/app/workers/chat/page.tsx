import { AppHeader } from "@/components/layout/AppHeader";
import { ChatInboxClient } from "@/components/chat/ChatInboxClient";
export default function WorkerChatInboxPage() {
  return <div className="app-page"><AppHeader title="チャット" description="所属先の店長や、スカウト先のお店とのやり取り。" /><main><ChatInboxClient role="worker" /></main></div>;
}
