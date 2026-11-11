import {
  addOrderItem,
  completeOrderShipment,
  setOrderItemOwnership,
  updateRequestQuantity,
  updateYardLoadingDate,
} from "@/app/orders/actions";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { CenterSectionNav } from "@/components/center/CenterSectionNav";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { formatJstDateTime } from "@/lib/datetime/jst";
import { resolveUiRole } from "@/lib/auth/ui-capabilities";
import { fetchOrderDetail } from "@/lib/orders/fetch-orders";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { OWNERSHIP_LABELS } from "@/types/order";
import { STOCK_REQUEST_STATUS_LABEL } from "@/types/stock-request";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

function okMessage(ok: string | undefined): string | null {
  if (ok === "quantity_updated") return "数量を更新しました。";
  if (ok === "yard_date_updated") return "ヤード積込日を更新しました。";
  if (ok === "item_added") return "明細を追加しました。";
  if (ok === "ownership_updated") return "自社／リース区分を更新しました。";
  if (ok === "shipped") return "出庫完了しました。センター在庫を減らし、現場在庫へ反映しました。";
  return null;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "requested":
      return "bg-amber-100 text-amber-800";
    case "accepted":
      return "bg-blue-100 text-blue-800";
    case "shipped":
      return "bg-green-100 text-green-800";
    default:
      return "bg-zinc-200 text-zinc-700";
  }
}

export default async function OrderDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error: queryError, ok } = await searchParams;

  const [{ order, error }, products, user] = await Promise.all([
    fetchOrderDetail(id),
    fetchProductOptions(),
    getCurrentUser(),
  ]);

  const uiRole = resolveUiRole(user);
  const isCenter = uiRole === "center";
  const canManage = uiRole === "admin";
  const canEditYardLoadingDate = uiRole === "admin" || isCenter;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link href="/orders" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!order) {
    notFound();
  }

  const okText = okMessage(ok);
  const canCompleteShipment =
    isCenter &&
    order.items.length > 0 &&
    order.items.every(
      (item) => item.status === "requested" || item.status === "accepted",
    );

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <Link href="/orders" className="text-sm text-zinc-500 hover:text-zinc-800">
            ← オーダー一覧
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            オーダー詳細
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            現場: {order.site_name}／依頼日時:{" "}
            {new Date(order.created_at).toLocaleString("ja-JP")}
          </p>
          <Link
            href={`/orders/${order.id}/print`}
            className={`mt-3 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold ${
              isCenter
                ? "bg-blue-700 text-white hover:bg-blue-800"
                : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
            }`}
          >
            資材発注書を確認・印刷 →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
        {isCenter && <CenterSectionNav active="orders" />}

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

        <section>
          <h2 className="text-sm font-semibold text-zinc-900">
            オーダー番号
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {order.order_number ?? "—"}
            <span className="ml-2 text-xs text-zinc-500">
              （登録順にシステムが自動採番）
            </span>
          </p>
        </section>

        {isCenter && (
          <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h2 className="text-sm font-semibold text-zinc-900">出庫完了</h2>
            <p className="mt-1 text-sm text-zinc-700">
              このオーダーの全明細を現場へ出庫します。センター在庫を減らし、現場在庫へ反映します。
            </p>
            {canCompleteShipment ? (
              <form action={completeOrderShipment.bind(null, order.id)} className="mt-3">
                <button
                  type="submit"
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  出庫完了
                </button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-zinc-600">
                出庫済みまたはキャンセル済みの明細があるため、このオーダーは出庫できません。
              </p>
            )}
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-zinc-900">納期</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {order.delivery_deadline
              ? formatJstDateTime(order.delivery_deadline)
              : "未入力"}
            <span className="ml-2 text-xs text-zinc-500">
              （依頼した職人が入力）
            </span>
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-900">
            ヤード積込日
          </h2>
          {isCenter && (
            <p className="mt-1 text-xs text-zinc-500">
              現場がオーダー時に入力した日付です。必要な場合のみ訂正してください。
            </p>
          )}
          {canEditYardLoadingDate ? (
            <form
              action={updateYardLoadingDate.bind(null, order.id)}
              className="mt-2 flex items-center gap-2"
            >
              <input
                type="date"
                name="yard_loading_date"
                defaultValue={order.yard_loading_date ?? ""}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                保存
              </button>
            </form>
          ) : (
            <p className="mt-1 text-sm text-zinc-700">
              {order.yard_loading_date ?? "未入力"}
            </p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-900">
            明細（{order.items.length}件）
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            出庫（shipped）前の依頼は確定数量を修正できます。
            自社／リースは在庫から自動判定しますが、両方で持っている資材（枠など）は
            判別できないため、必要なら事務が手で選び直してください。
          </p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-3 py-2 font-medium">商品</th>
                  <th className="px-3 py-2 font-medium text-right">当初依頼</th>
                  <th className="px-3 py-2 font-medium">ステータス</th>
                  <th className="px-3 py-2 font-medium">確定数量</th>
                  <th className="px-3 py-2 font-medium">自社／リース</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {order.items.map((item) => {
                  const editable =
                    canManage &&
                    (item.status === "requested" || item.status === "accepted");
                  const updateAction = updateRequestQuantity.bind(
                    null,
                    order.id,
                    item.id,
                  );
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-zinc-900">
                        {item.product_code
                          ? `${item.product_code} — ${item.product_name}`
                          : item.product_name}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-600">
                        {item.original_quantity ?? item.quantity}
                        {item.product_unit ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                        >
                          {STOCK_REQUEST_STATUS_LABEL[item.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <form
                            action={updateAction}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="number"
                              name="quantity"
                              min={0.01}
                              step="1"
                              defaultValue={item.quantity}
                              className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                            />
                            <span className="text-xs text-zinc-500">
                              {item.product_unit ?? ""}
                            </span>
                            <button
                              type="submit"
                              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                              更新
                            </button>
                          </form>
                        ) : (
                          <span className="text-zinc-900">
                            {item.quantity}
                            {item.product_unit ?? ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <form
                            action={setOrderItemOwnership.bind(
                              null,
                              order.id,
                              item.id,
                            )}
                            className="flex items-center gap-2"
                          >
                            <select
                              name="ownership"
                              defaultValue={item.ownership_override ?? ""}
                              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                            >
                              <option value="">
                                自動（{OWNERSHIP_LABELS[item.ownership_auto]}）
                              </option>
                              <option value="owned">自社</option>
                              <option value="leased">リース</option>
                            </select>
                            <button
                              type="submit"
                              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                              変更
                            </button>
                          </form>
                        ) : (
                          <span className="text-zinc-900">
                            {OWNERSHIP_LABELS[item.ownership]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canManage && (
          <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-white p-4">
            <h3 className="text-sm font-medium text-zinc-900">明細を追加</h3>
            <p className="mt-1 text-xs text-zinc-500">
              発注書に手書きで足された資材をここから登録します。追加分は「依頼中」で登録されます。
            </p>
            <form
              action={addOrderItem.bind(null, order.id)}
              className="mt-3 flex flex-wrap items-start gap-2"
            >
              <input type="hidden" name="operation_id" value={crypto.randomUUID()} />
              <div className="min-w-[16rem] flex-1">
                <SearchableSelect
                  name="product_id"
                  required
                  ariaLabel="追加する資材"
                  placeholder="資材名・コードの一部を入力"
                  options={products.map((p) => ({
                    value: p.id,
                    label: p.code ? `${p.code} — ${p.name}` : p.name,
                    keywords: p.code ?? undefined,
                    group: p.category_name ?? null,
                  }))}
                />
              </div>
              <input
                type="number"
                name="quantity"
                min={0.01}
                step="1"
                required
                placeholder="数量"
                className="w-24 rounded-lg border border-zinc-300 px-2 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <SubmitButton
                pendingLabel="追加中..."
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                追加
              </SubmitButton>
            </form>
          </div>
          )}
        </section>

      </main>
    </div>
  );
}
