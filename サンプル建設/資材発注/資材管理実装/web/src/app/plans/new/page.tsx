import { saveSiteProductPlans } from "@/app/plans/actions";
import {
  PlanBulkForm,
  type PlanProductRow,
} from "@/components/plans/PlanBulkForm";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; site_id?: string }>;
};

type RawProductRow = {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  product_categories:
    | { name: string; sort_order: number }
    | { name: string; sort_order: number }[]
    | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function NewSiteProductPlanPage({
  searchParams,
}: PageProps) {
  const { error, site_id } = await searchParams;
  const selectedSiteId = site_id?.trim() || "";

  const sites = await fetchSiteOptions();
  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;

  let products: PlanProductRow[] = [];

  if (selectedSite) {
    const supabase = await createClient();
    const [{ data: productRows }, { data: planRows }] = await Promise.all([
      supabase
        .from("products")
        .select("id, code, name, unit, product_categories(name, sort_order)")
        .order("code", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true }),
      supabase
        .from("site_product_plans")
        .select("product_id, planned_quantity")
        .eq("site_id", selectedSite.id),
    ]);

    const plannedByProductId = new Map(
      ((planRows ?? []) as { product_id: string; planned_quantity: number }[]).map(
        (row) => [row.product_id, Number(row.planned_quantity)],
      ),
    );

    products = ((productRows ?? []) as unknown as RawProductRow[]).map((raw) => {
      const category = firstOrNull(raw.product_categories);
      return {
        id: raw.id,
        code: raw.code,
        name: raw.name,
        unit: raw.unit,
        categoryName: category?.name ?? null,
        plannedQuantity: plannedByProductId.get(raw.id) ?? null,
      };
    });
  }

  return (
    <div className="min-h-full bg-zinc-50">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <Link href="/plans" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← 予定数量一覧
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          予定数量を登録
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          現場を選ぶと資材が一覧で並びます。必要な数量を入力してまとめて保存してください。
          予定を超えた依頼は警告表示されますが、出庫は禁止されません。
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(error)}
          </p>
        )}

        {/* 現場の選択（GET で site_id を確定させてから資材一覧を出す） */}
        <form method="get" action="/plans/new" className="mt-6">
          <label
            htmlFor="site_id"
            className="block text-sm font-medium text-zinc-700"
          >
            現場 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            <SearchableSelect
              id="site_id"
              name="site_id"
              required
              submitOnChange
              defaultValue={selectedSiteId}
              placeholder="現場名・コードの一部を入力"
              options={sites.map((s) => ({
                value: s.id,
                label: s.code ? `${s.code} ${s.name}` : s.name,
                keywords: s.code ?? undefined,
              }))}
            />
          </div>
        </form>

        {!selectedSite ? (
          <p className="mt-6 rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-600">
            先に現場を選んでください。
          </p>
        ) : products.length === 0 ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
            商品マスタに資材がありません。先に
            <Link href="/products/new" className="mx-1 underline">
              資材を登録
            </Link>
            してください。
          </p>
        ) : (
          <PlanBulkForm
            action={saveSiteProductPlans}
            siteId={selectedSite.id}
            siteName={
              selectedSite.code
                ? `${selectedSite.code} ${selectedSite.name}`
                : selectedSite.name
            }
            products={products}
          />
        )}
      </div>
    </div>
  );
}
