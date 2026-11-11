import Link from "next/link";

type Props = {
  pathname: string;
  page: number;
  totalPages: number;
  totalCount: number;
  params?: Record<string, string | undefined>;
};

function hrefFor(
  pathname: string,
  page: number,
  params: Record<string, string | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

export function PaginationNav({
  pathname,
  page,
  totalPages,
  totalCount,
  params = {},
}: Props) {
  if (totalCount === 0) return null;

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600" aria-label="ページ送り">
      <p>{totalCount} 件中 {Math.min((page - 1) * 50 + 1, totalCount)}〜{Math.min(page * 50, totalCount)} 件を表示</p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefFor(pathname, page - 1, params)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-50">
              前へ
            </Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-zinc-400">前へ</span>
          )}
          <span>{page} / {totalPages} ページ</span>
          {page < totalPages ? (
            <Link href={hrefFor(pathname, page + 1, params)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-50">
              次へ
            </Link>
          ) : (
            <span className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-zinc-400">次へ</span>
          )}
        </div>
      )}
    </nav>
  );
}
