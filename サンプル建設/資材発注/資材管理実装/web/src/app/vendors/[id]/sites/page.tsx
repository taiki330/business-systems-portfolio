import { addVendorSite } from "@/app/vendors/[id]/sites/actions";
import { DeleteVendorSiteButton } from "@/components/vendors/DeleteVendorSiteButton";
import { VendorSiteForm } from "@/components/vendors/VendorSiteForm";
import {
  fetchSiteOptionsForVendor,
  fetchVendorSitesByVendor,
} from "@/lib/vendors/fetch-options";
import { createClient } from "@/lib/supabase/server";
import type { Vendor } from "@/types/vendor";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

function okMessage(ok: string | undefined): string | null {
  if (ok === "created") return "現場を紐づけました。";
  if (ok === "deleted") return "紐づけを削除しました。";
  return null;
}

export default async function VendorSitesPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError, ok } = await searchParams;

  const supabase = await createClient();
  const { data: vendorData, error: vendorError } = await supabase
    .from("vendors")
    .select("id, name, note, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (vendorError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-700">読み込みエラー: {vendorError.message}</p>
        <Link href="/vendors" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!vendorData) notFound();

  const vendor = vendorData as Vendor;
  const [rows, sites] = await Promise.all([
    fetchVendorSitesByVendor(id),
    fetchSiteOptionsForVendor(),
  ]);

  const createAction = addVendorSite.bind(null, id);
  const excludeSiteIds = rows.map((r) => r.site_id);
  const okText = okMessage(ok);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <Link
              href="/vendors"
              className="text-sm text-zinc-500 hover:text-zinc-800"
            >
              ← 業者一覧
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              業者の現場紐づけ
            </h1>
            <p className="mt-1 text-sm text-zinc-600">{vendor.name}</p>
          </div>
          <Link
            href={`/vendors/${vendor.id}/edit`}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            業者情報を編集
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
          ここに登録された現場が、この業者が<strong>出庫依頼を作成できる現場</strong>になります。
          紐づけを削除すると、その現場への新規依頼はできなくなります(進行中の依頼には影響しません)。
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
            <VendorSiteForm
              action={createAction}
              sites={sites}
              excludeSiteIds={excludeSiteIds}
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
            <p className="px-6 py-10 text-center text-sm text-zinc-500">
              紐づけられた現場がありません。
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => {
                  const siteLabel = row.sites
                    ? row.sites.code
                      ? `${row.sites.code} — ${row.sites.name}`
                      : row.sites.name
                    : "(現場情報なし)";
                  return (
                    <tr key={row.site_id}>
                      <td className="px-6 py-3 text-zinc-900">{siteLabel}</td>
                      <td className="px-6 py-3 text-right">
                        <DeleteVendorSiteButton
                          vendorId={id}
                          siteId={row.site_id}
                          siteLabel={siteLabel}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
