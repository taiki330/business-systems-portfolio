import type { CenterOption, PrimeContractorOption, Site } from "@/types/site";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  site?: Site;
  error?: string;
  title: string;
  submitLabel: string;
  primeContractors: PrimeContractorOption[];
  centers: CenterOption[];
};

export function SiteForm({
  action,
  site,
  error,
  title,
  submitLabel,
  primeContractors,
  centers,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link
        href="/sites"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← 現場一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">{title}</h1>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="prime_contractor_id"
            className="block text-sm font-medium text-zinc-700"
          >
            元請
          </label>
          <select
            id="prime_contractor_id"
            name="prime_contractor_id"
            defaultValue={site?.prime_contractor_id ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            <option value="">未設定</option>
            {primeContractors.map((primeContractor) => (
              <option key={primeContractor.id} value={primeContractor.id}>
                {primeContractor.name}（元請番号: {primeContractor.slip_number}）
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-zinc-600">
            伝票用現場番号は、元請を設定して保存した時点で元請ごとに自動採番されます。
          </p>
        </div>
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-zinc-700"
          >
            コード
          </label>
          <input
            id="code"
            name="code"
            type="text"
            defaultValue={site?.code ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意"
          />
        </div>

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-zinc-700"
          >
            現場名 <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={site?.name ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="center_id"
            className="block text-sm font-medium text-zinc-700"
          >
            地域センター
          </label>
          <select
            id="center_id"
            name="center_id"
            defaultValue={site?.center_id ?? centers.find((c) => c.code === "kansai")?.id ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            {centers.map((center) => (
              <option key={center.id} value={center.id}>
                {center.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-zinc-600">
            センターロールのアカウントは、自分の地域の現場・在庫だけを参照します。設定・変更は事務のみ行えます。
          </p>
        </div>

        <div>
          <label
            htmlFor="address"
            className="block text-sm font-medium text-zinc-700"
          >
            住所
          </label>
          <input
            id="address"
            name="address"
            type="text"
            defaultValue={site?.address ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意"
          />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <label
            htmlFor="allow_partial_lot_default"
            className="flex items-center gap-2 text-sm font-medium text-zinc-800"
          >
            <input
              id="allow_partial_lot_default"
              name="allow_partial_lot_default"
              type="checkbox"
              defaultChecked={site?.allow_partial_lot_default ?? true}
              className="h-4 w-4 rounded border-zinc-300"
            />
            半端な数量の注文を基本的に許可する
          </label>
          <p className="mt-2 text-xs text-zinc-600">
            チェックを外すと、束の半分単位に合わない注文を「半端もんの確認」に表示します。商品ごとに例外設定できます。
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {submitLabel}
          </button>
          <Link
            href="/sites"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
