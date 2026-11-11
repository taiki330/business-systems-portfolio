import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { SiteOption } from "@/lib/sites/fetch-options";

type Props = {
  /** 送信先パス（例: "/stock/returns"） */
  action: string;
  sites: SiteOption[];
  /** 現在選択中の現場 ID。未選択は "" */
  value: string;
  /**
   * 現場以外に維持したいクエリパラメータ。
   * 現場を切り替えても既存の絞り込み（ステータス等）が消えないように hidden で持ち回る。
   */
  hiddenParams?: Record<string, string | undefined>;
  /** 絞り込み後の件数。渡すと右側に表示する */
  count?: number;
};

/**
 * 一覧画面で現場を絞り込むための GET フォーム。
 * 現場在庫・返却履歴・過入庫・現場進捗で共通利用する。
 */
export function SiteFilterForm({
  action,
  sites,
  value,
  hiddenParams,
  count,
}: Props) {
  return (
    <form
      method="get"
      action={action}
      className="mb-4 flex flex-wrap items-center gap-3"
    >
      {Object.entries(hiddenParams ?? {}).map(([name, v]) =>
        v ? <input key={name} type="hidden" name={name} value={v} /> : null,
      )}

      <div className="min-w-[16rem] flex-1">
        <SearchableSelect
          id="site_id"
          name="site_id"
          ariaLabel="現場で絞り込み"
          submitOnChange
          allowEmpty
          emptyLabel="すべての現場"
          defaultValue={value}
          placeholder="現場名・コードの一部を入力"
          options={sites.map((s) => ({
            value: s.id,
            label: s.code ? `${s.code} — ${s.name}` : s.name,
            keywords: s.code ?? undefined,
          }))}
        />
      </div>

      {count !== undefined && (
        <p className="text-sm text-zinc-500">{count} 件</p>
      )}
    </form>
  );
}
