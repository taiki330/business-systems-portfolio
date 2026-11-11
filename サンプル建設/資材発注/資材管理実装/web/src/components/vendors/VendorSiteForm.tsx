import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { SiteOptionForVendor } from "@/types/vendor";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  sites: SiteOptionForVendor[];
  excludeSiteIds: string[];
};

export function VendorSiteForm({ action, sites, excludeSiteIds }: Props) {
  const excluded = new Set(excludeSiteIds);
  const available = sites.filter((s) => !excluded.has(s.id));

  if (available.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        追加可能な現場がありません。すべての現場が既に紐づいているか、現場マスタが空です。
      </p>
    );
  }

  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_auto] sm:items-end"
    >
      <div>
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
            placeholder="現場名・コードの一部を入力"
            options={available.map((s) => ({
              value: s.id,
              label: s.code ? `${s.code} — ${s.name}` : s.name,
              keywords: s.code ?? undefined,
            }))}
          />
        </div>
      </div>

      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        追加
      </button>
    </form>
  );
}
