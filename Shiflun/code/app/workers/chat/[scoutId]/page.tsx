import { AppHeader } from "@/components/layout/AppHeader";
import { ChatClient } from "@/components/chat/ChatClient";
export default async function WorkerChatPage({ params }: { params: Promise<{ scoutId: string }> }) {
  const { scoutId } = await params;
  return <div className="app-page max-w-xl"><AppHeader title="お店とチャット" description="当日のことを、ここで相談しましょう。" backHref="/workers/chat" backLabel="チャット一覧へ" /><main><ChatClient role="worker" scoutId={scoutId} /></main></div>;
}
