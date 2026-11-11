import Link from "next/link";

type Props = {
  /** 検索フォームの送信先（現在の一覧パス） */
  action: string;
  /** 現在の検索語 */
  value: string;
  placeholder?: string;
  /** 件数表示（絞り込み後の件数） */
  count?: number;
  /** 検索語以外に保持したいクエリ（種別の絞り込みなど） */
  children?: React.ReactNode;
  /** 検索解除時にも残したい絞り込みがある場合の遷移先 */
  clearHref?: string;
};

/**
 * 一覧画面の検索欄（サーバー側で部分一致）。
 * 名前が長く全文を打たない運用のため、一部だけ入力すれば絞り込める。
 */
export function ListSearchForm({
  action,
  value,
  placeholder = "名前の一部で検索",
  count,
  children,
  clearHref,
}: Props) {
  return (
    <div className="mb-4">
      <form
        method="GET"
        action={action}
        className="flex flex-wrap items-center gap-2"
      >
        {children}
        <input
          type="text"
          name="q"
          defaultValue={value}
          placeholder={placeholder}
          aria-label="検索"
          className="w-64 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          検索
        </button>
        {value && (
          <Link
            href={clearHref ?? action}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            クリア
          </Link>
        )}
      </form>
      {value && (
        <p className="mt-2 text-sm text-zinc-500">
          「{value}」で絞り込み中
          {count !== undefined ? `（${count} 件）` : ""}
        </p>
      )}
    </div>
  );
}
