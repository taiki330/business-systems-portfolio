import { StoreJoinRequest } from "@/lib/types/database";

/**
 * 店舗所属は自己申告制（Phase 8-B）。承認操作は無く、店長への情報共有のみ。
 * 見覚えのない人物がいる場合は、スタッフ一覧側の「通報」ボタンから対応する。
 */
export function SelfReportFeedItem({ req }: { req: StoreJoinRequest }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">{req.worker_name}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{req.skill_tags.join("・")}</p>
          {req.message && (
            <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft italic">
              「{req.message}」
            </p>
          )}
          <p className="mt-2 text-[10px] text-ink-soft">
            {new Date(req.created_at).toLocaleDateString("ja-JP")} 自己申告
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
          {req.store_name}
        </span>
      </div>
    </div>
  );
}
