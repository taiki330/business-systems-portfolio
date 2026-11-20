import Link from "next/link";

/** ワーカー詳細の下に置く、スカウト送信への入口。 */
export function ScoutLinkButton({ workerId }: { workerId: string }) {
  return <Link href={`/companies/workers/${workerId}/scout`} className="app-primary w-full">スカウトを送る</Link>;
}
