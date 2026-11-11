import { updateSiteProductPlan } from "@/app/plans/actions";
import { fetchSiteProductPlan } from "@/lib/plans/fetch-plans";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditSiteProductPlanPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;

  const plan = await fetchSiteProductPlan(id);
  if (!plan) notFound();

  const supabase = await createClient();
  const [{ data: site }, { data: product }] = await Promise.all([
    supabase.from("sites").select("name").eq("id", plan.site_id).maybeSingle(),
    supabase
      .from("products")
      .select("code, name")
      .eq("id", plan.product_id)
      .maybeSingle(),
  ]);

  const siteName = (site as { name: string } | null)?.name ?? "(現場不明)";
  const productRow = product as { code: string | null; name: string } | null;
  const productLabel = productRow
    ? `${productRow.code ? `${productRow.code} ` : ""}${productRow.name}`
    : "(商品不明)";

  const updateAction = updateSiteProductPlan.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link href="/plans" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← 予定数量一覧
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          予定数量を編集
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {siteName} / {productLabel}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          現場と商品の組み合わせは変更できません。変更が必要な場合は削除して登録し直してください。
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(error)}
          </p>
        )}

        <form action={updateAction} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="planned_quantity"
              className="block text-sm font-medium text-zinc-700"
            >
              予定数量 <span className="text-red-600">*</span>
            </label>
            <input
              id="planned_quantity"
              name="planned_quantity"
              type="number"
              step="1"
              min="0"
              required
              defaultValue={plan.planned_quantity}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="note"
              className="block text-sm font-medium text-zinc-700"
            >
              備考
            </label>
            <input
              id="note"
              name="note"
              type="text"
              defaultValue={plan.note ?? ""}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="任意"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              更新
            </button>
            <Link
              href="/plans"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              キャンセル
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
