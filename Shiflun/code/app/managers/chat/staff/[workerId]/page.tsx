import { AppHeader } from "@/components/layout/AppHeader";
import { StaffChatClient } from "@/components/chat/StaffChatClient";
export default async function StoreStaffChatPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = await params;
  return <div className="app-page max-w-xl"><AppHeader title="スタッフとチャット" description="シフトのお願いや連絡事項を直接。" backHref="/managers/chat" backLabel="チャット一覧へ" /><main><StaffChatClient role="store" workerId={workerId} /></main></div>;
}
