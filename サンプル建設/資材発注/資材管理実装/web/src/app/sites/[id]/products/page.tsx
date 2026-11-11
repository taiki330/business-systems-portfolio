import { createSiteProduct } from "@/app/sites/[id]/products/actions";
import { SiteProductForm } from "@/components/site-products/SiteProductForm";
import { UpdateSiteProductRow } from "@/components/site-products/UpdateSiteProductRow";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSiteProductsBySite } from "@/lib/site-products/fetch";
import { createClient } from "@/lib/supabase/server";
import type { Site } from "@/types/site";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

function okMessage(ok: string | undefined): string | null {
  if (ok === "created") return "商品の紐づけを追加しました。";
  if (ok === "updated") return "紐づけを更新しました。";
  if (ok === "deleted") return "紐づけを削除しました。";
  return null;
}

export default async function SiteProductsPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError, ok } = await searchParams;

  const supabase = await createClient();
  const { data: siteData, error: siteError } = await supabase
    .from("sites")
    .select("id, code, name, address, allow_partial_lot_default, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (siteError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-700">読み込みエラー: {siteError.message}</p>
        <Link href="/sites" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!siteData) notFound();

  const site = siteData as Site;
  const [rows, products] = await Promise.all([
    fetchSiteProductsBySite(id),
    fetchProductOptions(),
  ]);

  const createAction = createSiteProduct.bind(null, id);
  const excludeProductIds = rows.map((r) => r.product_id);
  const okText = okMessage(ok);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <Link
              href="/sites"
              className="text-sm text-zinc-500 hover:text-zinc-800"
            >
              ← 現場一覧
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              現場の商品紐づけ
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {site.code ? `${site.code} — ${site.name}` : site.name}
            </p>
          </div>
          <Link
            href={`/sites/${site.id}/edit`}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            現場情報を編集
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
          この紐づけは基本的に <strong>並び替え補助</strong> です（docs/11）。
          ここに登録された商品は <code>/requests/new</code>{" "}
          の商品プルダウンで上位に並びます。
          <strong>未登録の商品も依頼可能</strong>です（並び順は影響しません）。
          自社在庫品 × 現場のみを対象にしてください（完リース・リースは対象外）。
          「半端もん許可」のチェックを外すと、セット数（商品マスタ）が設定された資材でこの現場から
          倍数以外の数量で依頼があった場合に、
          <Link href="/plans/lot-size" className="underline hover:text-zinc-800">
            半端もんの確認
          </Link>
          画面で確認できるようになります（依頼自体はブロックされません。事務の例外対応用）。
        </p>

        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          この現場の基本設定: 半端な数量の注文を
          <strong className="mx-1">
            {site.allow_partial_lot_default ? "許可する" : "確認対象にする"}
          </strong>
          。商品ごとの設定で変更できます。
        </p>

        {okText && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {okText}
          </p>
        )}

        {queryError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {decodeURIComponent(queryError)}
          </p>
        )}

        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-zinc-500">新規追加</h2>
          <div className="mt-4">
            <SiteProductForm
              action={createAction}
              products={products}
              excludeProductIds={excludeProductIds}
            />
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
            <h2 className="text-sm font-medium text-zinc-500">
              紐づけ一覧
              <span className="ml-2 text-xs text-zinc-400">
                （{rows.length} 件）
              </span>
            </h2>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-zinc-500">
              まだ商品が紐づけられていません。上のフォームから追加してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium" colSpan={3}>
                      並び順 / メモ / 操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <UpdateSiteProductRow key={row.id} siteId={id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
