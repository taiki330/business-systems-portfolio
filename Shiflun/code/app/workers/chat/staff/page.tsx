import { AppHeader } from "@/components/layout/AppHeader";
import { StaffChatClient } from "@/components/chat/StaffChatClient";
export default function WorkerStaffChatPage() {
  return <div className="app-page max-w-xl"><AppHeader title="店長とチャット" description="シフトの交代や、出られない日の相談に。" backHref="/workers/chat" backLabel="チャット一覧へ" /><main><StaffChatClient role="worker" /></main></div>;
}
