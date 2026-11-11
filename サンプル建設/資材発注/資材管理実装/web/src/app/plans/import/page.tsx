import { importSiteProductPlansFromCsv } from "@/app/plans/actions";
import { CsvPlanImportForm } from "@/components/plans/CsvPlanImportForm";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ error?: string; site_id?: string }>;
};

export default async function ImportSiteProductPlansPage({ searchParams }: PageProps) {
  const { error, site_id: rawSiteId } = await searchParams;
  const selectedSiteId = rawSiteId?.trim() ?? "";
  const [sites, products] = await Promise.all([fetchSiteOptions(), fetchProductOptions()]);
  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null;

  return (
    <div className="min-h-full bg-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <Link href="/plans" className="text-sm text-zinc-600 hover:text-zinc-900">← 予定数量一覧</Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">予定数量をCSVから取り込む</h1>
        <p className="mt-2 text-sm text-zinc-600">
          現場（棟）を選び、資材予測システムが出力したCSVを確認して予定数量へ反映します。CSVにない既存の予定数量は削除されません。
        </p>

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{decodeURIComponent(error)}</p>}

        <form method="get" action="/plans/import" className="mt-6 max-w-xl">
          <label htmlFor="site_id" className="block text-sm font-medium text-zinc-800">反映先の現場（棟） <span className="text-red-600">*</span></label>
          <div className="mt-1">
            <SearchableSelect
              id="site_id"
              name="site_id"
              required
              submitOnChange
              defaultValue={selectedSiteId}
              placeholder="現場名・コードで検索"
              options={sites.map((site) => ({
                value: site.id,
                label: site.code ? `${site.code} ${site.name}` : site.name,
                keywords: site.code ?? undefined,
              }))}
            />
          </div>
        </form>

        {!selectedSite ? (
          <p className="mt-6 rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-600">先に反映先の現場（棟）を選択してください。</p>
        ) : (
          <CsvPlanImportForm
            action={importSiteProductPlansFromCsv}
            siteId={selectedSite.id}
            siteName={selectedSite.code ? `${selectedSite.code} ${selectedSite.name}` : selectedSite.name}
            products={products}
          />
        )}
      </div>
    </div>
  );
}
