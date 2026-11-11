import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { LeaseCompanyOption } from "@/types/lease-company";
import type { SiteOption } from "@/lib/sites/fetch-options";
import type { ProductOption } from "@/types/stock";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  leaseCompanies: LeaseCompanyOption[];
  sites: SiteOption[];
  products: ProductOption[];
  error?: string;
  today: string;
};

/** 明細の入力行数。1伝票で扱う商品数の想定上限。 */
const ITEM_ROWS = 5;

/**
 * リース借用の登録フォーム（admin 専用）。
 *
 * ヘッダー（リース会社・伝票番号・借用日・納品先・備考）と
 * 明細（商品・借用数量・返却期限）を 1 画面で登録する。
 * 登録直後は draft（未承認）。承認するまで center は受入できない。
 */
export function LeaseBatchForm({
  action,
  leaseCompanies,
  sites,
  products,
  error,
  today,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/leases/batches"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← リース借用一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        リース借用を登録
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        リース会社との連絡（電話・FAX・メール等）で確定した内容を登録します。
        登録後に承認すると、センターが受入できるようになります。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {leaseCompanies.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          有効なリース会社が登録されていません。先に
          <Link href="/leases/companies/new" className="mx-1 underline">
            リース会社
          </Link>
          を登録してください。
        </p>
      )}

      <form action={action} className="mt-6 space-y-6">
        <input type="hidden" name="operation_id" value={crypto.randomUUID()} />
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-900">借用情報</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="lease_company_id"
                className="block text-sm font-medium text-zinc-700"
              >
                リース会社 <span className="text-red-600">*</span>
              </label>
              <div className="mt-1">
                <SearchableSelect
                  id="lease_company_id"
                  name="lease_company_id"
                  required
                  placeholder="リース会社名の一部を入力"
                  options={leaseCompanies.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="slip_number"
                className="block text-sm font-medium text-zinc-700"
              >
                伝票番号
              </label>
              <input
                id="slip_number"
                name="slip_number"
                type="text"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                placeholder="任意"
              />
            </div>

            <div>
              <label
                htmlFor="borrowed_at"
                className="block text-sm font-medium text-zinc-700"
              >
                借用日 <span className="text-red-600">*</span>
              </label>
              <input
                id="borrowed_at"
                name="borrowed_at"
                type="date"
                required
                defaultValue={today}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="delivery_kind"
                className="block text-sm font-medium text-zinc-700"
              >
                納品先 <span className="text-red-600">*</span>
              </label>
              <select
                id="delivery_kind"
                name="delivery_kind"
                required
                defaultValue="center"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                <option value="center">センター納品</option>
                <option value="site">現場直送</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="delivery_site_id"
                className="block text-sm font-medium text-zinc-700"
              >
                納品先の現場（現場直送の場合のみ）
              </label>
              <SearchableSelect
                id="delivery_site_id"
                name="delivery_site_id"
                allowEmpty
                emptyLabel="選択なし"
                placeholder="現場名・コードの一部を入力"
                options={sites.map((s) => ({
                  value: s.id,
                  label: s.code ? `${s.code} ${s.name}` : s.name,
                  keywords: s.code ?? undefined,
                }))}
              />
              <p className="mt-1 text-xs text-zinc-500">
                現場直送の場合も、この登録と承認が済むまでセンターは受入できません。
              </p>
            </div>

            <div className="sm:col-span-2">
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
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                placeholder="連絡手段・担当者名など（任意）"
              />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-900">
            借用明細 <span className="text-red-600">*</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            1行以上入力してください。同じ商品でも借用日・返却期限が異なる場合は別の借用として登録します。
          </p>

          <div className="mt-4 space-y-3">
            {Array.from({ length: ITEM_ROWS }).map((_, index) => (
              <div
                key={index}
                className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-end"
              >
                <div>
                  <label
                    htmlFor={`item_product_id_${index}`}
                    className="block text-xs font-medium text-zinc-600"
                  >
                    商品
                  </label>
                  <div className="mt-1">
                    <SearchableSelect
                      id={`item_product_id_${index}`}
                      name="item_product_id"
                      allowEmpty
                      emptyLabel="選択なし"
                      placeholder="資材名の一部を入力"
                      options={products.map((p) => ({
                        value: p.id,
                        label: p.code ? `${p.code} ${p.name}` : p.name,
                        keywords: p.code ?? undefined,
                        group: p.category_name ?? null,
                      }))}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={`item_quantity_${index}`}
                    className="block text-xs font-medium text-zinc-600"
                  >
                    借用数量
                  </label>
                  <input
                    id={`item_quantity_${index}`}
                    name="item_quantity"
                    type="number"
                    step="1"
                    min="0"
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`item_return_due_date_${index}`}
                    className="block text-xs font-medium text-zinc-600"
                  >
                    返却期限
                  </label>
                  <input
                    id={`item_return_due_date_${index}`}
                    name="item_return_due_date"
                    type="date"
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex gap-3">
          <SubmitButton
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            pendingLabel="登録中..."
          >
            登録
          </SubmitButton>
          <Link
            href="/leases/batches"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
