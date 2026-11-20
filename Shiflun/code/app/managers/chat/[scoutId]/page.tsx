import { AppHeader } from "@/components/layout/AppHeader";
import { ChatClient } from "@/components/chat/ChatClient";
export default async function StoreChatPage({ params }: { params: Promise<{ scoutId: string }> }) {
  const { scoutId } = await params;
  return <div className="app-page max-w-xl"><AppHeader title="ワーカーとチャット" description="集合場所や持ち物など、当日のご案内を。" backHref="/managers/chat" backLabel="チャット一覧へ" /><main><ChatClient role="store" scoutId={scoutId} /></main></div>;
}
