import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { CenterSectionNav } from "@/components/center/CenterSectionNav";
import { CenterTransferForm, type TransferProduct } from "@/components/center/CenterTransferForm";
import { createCenterTransfer } from "@/app/stock/transfers/actions";
import { createClient } from "@/lib/supabase/server";
import type { CenterTransferItemRow, CenterTransferRow } from "@/types/center-transfer";
import Link from "next/link";

type PageProps = { searchParams: Promise<{ error?: string; ok?: string }> };

type RawTransferRow = {
  id: string;
  from_center_id: string;
  to_center_id: string;
  note: string | null;
  created_at: string;
  center_transfer_items: CenterTransferItemRow[] | null;
};

type RawCenterStockRow = {
  product_id: string;
  quantity: number | string;
  products: { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
};

export default async function CenterTransfersPage({ searchParams }: PageProps) {
  const { error: queryError, ok } = await searchParams;
  const user = await getCurrentUser();
  const uiRole = resolveUiRole(user);
  const isCenter = uiRole === "center";

  const supabase = await createClient();

  const [{ data: centers }, { data: transferData }, { data: centerStockData }] = await Promise.all([
    supabase.from("centers").select("id, name").order("code"),
    supabase
      .from("center_transfers")
      .select(
        "id, from_center_id, to_center_id, note, created_at, center_transfer_items(id, product_code_snapshot, product_name_snapshot, product_unit_snapshot, quantity, shortage_quantity)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    isCenter && user?.center_id
      ? supabase
          .from("stock_items")
          .select("product_id, quantity, products(code, name, unit)")
          .eq("storage_kind", "center")
          .eq("center_id", user.center_id)
          .gt("quantity", 0)
      : Promise.resolve({ data: [] as RawCenterStockRow[] }),
  ]);

  const centerNameById = new Map((centers ?? []).map((c) => [c.id as string, c.name as string]));
  const transfers: CenterTransferRow[] = ((transferData ?? []) as RawTransferRow[]).map((t) => ({
    id: t.id,
    from_center_id: t.from_center_id,
    to_center_id: t.to_center_id,
    from_center_name: centerNameById.get(t.from_center_id) ?? "-",
    to_center_name: centerNameById.get(t.to_center_id) ?? "-",
    note: t.note,
    created_at: t.created_at,
    items: (t.center_transfer_items ?? []).map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      shortage_quantity: Number(item.shortage_quantity),
    })),
  }));

  const fromCenterName = isCenter ? (centerNameById.get(user?.center_id ?? "") ?? "自センター") : "";
  const destinationCenters = (centers ?? []).filter((c) => c.id !== user?.center_id);
  const productsById = new Map<string, TransferProduct>();
  for (const row of (centerStockData ?? []) as RawCenterStockRow[]) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    if (!product) continue;
    const existing = productsById.get(row.product_id);
    productsById.set(row.product_id, {
      id: row.product_id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      availableQuantity: (existing?.availableQuantity ?? 0) + Number(row.quantity),
    });
  }
  const products = [...productsById.values()].sort((a, b) => {
    const aLabel = a.code ?? a.name;
    const bLabel = b.code ?? b.name;
    return aLabel.localeCompare(bLabel, "ja");
  });

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
              ホーム
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">センター間移動</h1>
            <p className="mt-1 text-sm text-zinc-500">
              センター同士の資材移動（例: サンプル市A→サンプル市B）を登録・確認できます。
            </p>
          </div>
          {!isCenter && (
            <Link
              href="/stock"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              センター在庫へ戻る
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {isCenter && <CenterSectionNav active="transfers" />}

        {ok === "created" && (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            センター間移動を登録しました。
          </p>
        )}

        {isCenter && (
          <div className="mb-8">
            <CenterTransferForm
              action={createCenterTransfer}
              fromCenterName={fromCenterName}
              destinationCenters={destinationCenters.map((c) => ({ id: c.id, name: c.name }))}
              products={products}
              error={queryError ? decodeURIComponent(queryError) : undefined}
            />
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">移動履歴</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {isCenter ? "自センターが関わる移動のみ表示しています。" : "全センターの移動を新しい順に表示しています。"}
            </p>
          </div>

          {transfers.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-zinc-500">移動履歴はまだありません。</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {transfers.map((t) => (
                <li key={t.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-900">
                      {t.from_center_name}
                      <span className="mx-2 text-zinc-400">→</span>
                      {t.to_center_name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(t.created_at).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  {t.note && <p className="mt-1 text-xs text-zinc-600">備考: {t.note}</p>}
                  <ul className="mt-2 space-y-1">
                    {t.items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                        <span className="font-mono text-xs text-zinc-500">
                          {item.product_code_snapshot ?? "-"}
                        </span>
                        <span>{item.product_name_snapshot ?? "（商品未紐づけ）"}</span>
                        <span className="tabular-nums">
                          {item.quantity}
                          {item.product_unit_snapshot ?? ""}
                        </span>
                        {item.shortage_quantity > 0 && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            不足 {item.shortage_quantity}
                            {item.product_unit_snapshot ?? ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
