import { getCurrentUser } from "@/lib/auth/get-current-user";
import { CenterSectionNav } from "@/components/center/CenterSectionNav";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import { CENTER_LOCATION } from "@/lib/stock/constants";
import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import type { CenterStockRow, StockProductRef } from "@/types/stock";
import Link from "next/link";

type StockView = "center" | "combined";

type PageProps = {
  searchParams: Promise<{ q?: string; error?: string; center_id?: string; view?: string }>;
};

type RawStockRow = {
  id: string;
  location: string;
  quantity: number;
  site_id?: string | null;
  products: StockProductRef | StockProductRef[] | null;
};

type RawSiteRow = RawStockRow & {
  sites: { name: string } | { name: string }[] | null;
};

export default async function StockPage({ searchParams }: PageProps) {
  const { q: queryRaw, error: queryError, center_id: requestedCenterId, view: requestedView } = await searchParams;
  const q = (queryRaw ?? "").trim();
  const qLower = q.toLowerCase();
  const selectedView: StockView = requestedView === "combined" ? "combined" : "center";

  const user = await getCurrentUser();
  const uiRole = resolveUiRole(user);
  const isCenter = uiRole === "center";

  const supabase = await createClient();

  // center ロールは自分の地域センターの在庫を見る（RLS で自地域以外は返らない）。
  // admin は「センターのみ」「センター＋紐づく現場」をタブで切り替えて見る。
  let centerLocation: string = CENTER_LOCATION;
  let centerName = "サンプル市Aセンター";
  let siteStockTotal: number | null = null;
  let siteRows: CenterStockRow[] = [];

  const { data: centers } = await supabase
    .from("centers")
    .select("id, code, name, stock_location")
    .order("code");
  // 既存運用の基本地域である関西（サンプル市A）を、事務画面の初期表示にする。
  const selectedCenterId =
    isCenter
      ? user?.center_id
      : requestedCenterId || centers?.find((center) => center.code === "kansai")?.id || centers?.[0]?.id;
  if (selectedCenterId) {
    const centerRow = (centers ?? []).find((center) => center.id === selectedCenterId);
    if (centerRow) {
      centerLocation = centerRow.stock_location;
      centerName = centerRow.name;
    }
    const { data: regionSites } = await supabase.from("sites").select("id").eq("center_id", selectedCenterId);
    const siteIds = (regionSites ?? []).map((site) => (site as { id: string }).id);

    if (siteIds.length) {
      const { data: siteStockData } = await supabase
        .from("stock_items")
        .select("id, location, quantity, site_id, products(code, name, unit), sites(name)")
        .eq("storage_kind", "site")
        .in("site_id", siteIds);

      siteRows = (siteStockData ?? []).map((row) => {
        const raw = row as RawSiteRow;
        const siteRef = Array.isArray(raw.sites) ? raw.sites[0] : raw.sites;
        return {
          id: raw.id,
          location: siteRef?.name ?? raw.location,
          quantity: Number(raw.quantity),
          storage_kind: "site",
          site_id: raw.site_id ?? null,
          products: normalizeProductRef(raw.products),
        };
      });
    }
    siteStockTotal = siteRows.reduce((sum, row) => sum + row.quantity, 0);
  }

  const { data, error } = await supabase
    .from("stock_items")
    .select("id, location, quantity, products(code, name, unit)")
    .eq("location", centerLocation)
    .order("quantity", { ascending: false });

  let rows: CenterStockRow[] = [];
  let centerOnlyTotal = 0;

  if (!error) {
    const centerRows: CenterStockRow[] = (data ?? []).map((row) => {
      const raw = row as RawStockRow;
      return {
        id: raw.id,
        location: centerName,
        quantity: Number(raw.quantity),
        storage_kind: "center",
        products: normalizeProductRef(raw.products),
      };
    });
    centerOnlyTotal = centerRows.reduce((sum, row) => sum + row.quantity, 0);

    rows = selectedView === "combined" ? [...centerRows, ...siteRows] : centerRows;

    if (qLower) {
      rows = rows.filter((row) => {
        const p = row.products;
        if (!p) return false;
        const code = (p.code ?? "").toLowerCase();
        const name = p.name.toLowerCase();
        return code.includes(qLower) || name.includes(qLower);
      });
    }

    rows.sort((a, b) => {
      const codeA = a.products?.code ?? "";
      const codeB = b.products?.code ?? "";
      if (codeA !== codeB) return codeA.localeCompare(codeB, "ja");
      return (a.products?.name ?? "").localeCompare(b.products?.name ?? "", "ja");
    });
  }

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              センター在庫
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {centerName}に現在ある商品の数量を確認できます。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/stock/inventory"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              棚卸
            </Link>
            {false && (
              <Link
                href="/stock/move"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                入出庫登録
              </Link>
            )}
            {uiRole === "admin" && (
              <Link
                href="/stock/summary"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                総在庫サマリー
              </Link>
            )}
            {uiRole === "admin" && (
              <Link
                href="/stock/ledger"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                履歴
              </Link>
            )}
            {uiRole === "admin" && (
              <Link
                href="/stock/transfers"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                センター間移動
              </Link>
            )}
            {false && (
              <Link
                href="/stock/new"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                暫定メンテ
              </Link>
            )}
            <Link
              href="/stock/sites"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              現場在庫
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {isCenter && <CenterSectionNav active="center-stock" />}

        {uiRole === "admin" && (centers ?? []).length > 0 && (
          <nav className="mb-3 flex flex-wrap gap-2" aria-label="センター選択">
            {(centers ?? []).map((center) => (
              <Link
                key={center.id}
                href={`/stock?center_id=${encodeURIComponent(center.id)}${selectedView === "combined" ? "&view=combined" : ""}`}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${center.id === selectedCenterId ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}
              >
                {center.name}
              </Link>
            ))}
          </nav>
        )}

        {uiRole === "admin" && (
          <nav className="mb-6 flex flex-wrap gap-2" aria-label="表示範囲切り替え">
            {(
              [
                { key: "center", label: "センターのみの在庫" },
                { key: "combined", label: "センター＋紐づく現場の在庫" },
              ] as const
            ).map((tab) => (
              <Link
                key={tab.key}
                href={`/stock?view=${tab.key}${selectedCenterId ? `&center_id=${encodeURIComponent(selectedCenterId)}` : ""}`}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  selectedView === tab.key
                    ? "bg-zinc-700 text-white"
                    : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        )}

        {false && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            数量の増減は原則、{centerName}の{" "}
            <span className="font-medium">入出庫登録</span>
            で行います。「暫定メンテ」は ledger を経由しない初期登録・緊急補正用です。
          </p>
        )}
        {queryError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-medium">在庫データの読み込みに失敗しました</p>
            <p className="mt-1">{error.message}</p>
            {uiRole === "admin" && (
              <p className="mt-2 text-xs text-red-600">
                permission denied の場合はSupabaseの適用状況を確認してください。
              </p>
            )}
          </div>
        )}

        {!error && (() => {
          const showCombinedStats = isCenter || (uiRole === "admin" && selectedView === "combined");
          return (
            <dl className={`mb-6 grid gap-3 ${showCombinedStats ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
              <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
                <dt className="text-sm text-zinc-500">商品数</dt>
                <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                  {rows.length}
                  <span className="ml-1 text-sm font-normal">種類</span>
                </dd>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
                <dt className="text-sm text-blue-700">センターのみ</dt>
                <dd className="mt-1 text-2xl font-semibold text-blue-950">
                  {centerOnlyTotal}
                </dd>
              </div>
              {showCombinedStats && siteStockTotal !== null && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                    <dt className="text-sm text-emerald-700">現場在庫</dt>
                    <dd className="mt-1 text-2xl font-semibold text-emerald-950">
                      {siteStockTotal}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-zinc-300 bg-zinc-100 px-5 py-4">
                    <dt className="text-sm text-zinc-600">合計</dt>
                    <dd className="mt-1 text-2xl font-semibold text-zinc-900">
                      {centerOnlyTotal + siteStockTotal}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          );
        })()}

        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          {selectedCenterId && <input type="hidden" name="center_id" value={selectedCenterId} />}
          {selectedView === "combined" && <input type="hidden" name="view" value="combined" />}
          <div className="min-w-[240px] flex-1">
            <label htmlFor="q" className="block text-sm font-medium text-zinc-700">
              検索（商品コード・商品名）
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="例: P001"
              className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            検索
          </button>
          {q && (
            <Link
              href="/stock"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              クリア
            </Link>
          )}
        </form>

        {!error && rows.length === 0 && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            {q
              ? `「${q}」に一致する在庫はありません。`
              : `${centerName}の在庫データがありません。`}
          </p>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-3 font-medium">商品コード</th>
                  <th className="px-4 py-3 font-medium">商品名</th>
                  <th className="px-4 py-3 font-medium">単位</th>
                  <th className="px-4 py-3 font-medium">保管場所</th>
                  <th className="px-4 py-3 font-medium text-right">数量</th>
                  {false && (
                    <th className="px-4 py-3 font-medium">操作</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 font-mono text-zinc-700">
                      {row.products?.code ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      {row.products?.name ?? (
                        <span className="text-amber-700">（商品未紐づけ）</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {row.products?.unit ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-600">
                      {row.location}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
                      {row.quantity}
                    </td>
                    {false && (
                      <td className="px-4 py-3">
                        <Link
                          href={`/stock/${row.id}/edit`}
                          className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          編集
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && (
          <p className="mt-4 text-sm text-zinc-500">
            {rows.length} 件
            {q ? `（検索: 「${q}」）` : ""}
          </p>
        )}
      </main>
    </div>
  );
}
