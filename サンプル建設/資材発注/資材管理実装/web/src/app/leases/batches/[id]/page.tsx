import {
  approveLeaseBatch,
  cancelLeaseBatch,
  closeLeaseBatchItemReceiving,
  receiveLeaseBatchItem,
  returnLeaseStockFromSite,
  returnLeaseToCompany,
  shipLeaseStockToSite,
} from "@/app/leases/batches/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { LeaseSectionNav } from "@/components/leases/LeaseSectionNav";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowLeaseBatchAdminActions,
  canShowLeaseStockActions,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import {
  fetchLeaseBatch,
  fetchLeaseBatchItems,
} from "@/lib/leases/fetch-batches";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import {
  LEASE_BATCH_STATUS_LABELS,
  LEASE_DELIVERY_KIND_LABELS,
  LEASE_DUE_STATE_LABELS,
  resolveLeaseDueState,
  type LeaseDueState,
} from "@/types/lease";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

const OK_MESSAGES: Record<string, string> = {
  created: "借用を登録しました。承認するとセンターが受入できます。",
  approved: "借用を承認しました。",
  cancelled: "借用をキャンセルしました。",
  received: "受入を登録しました。",
  receiving_closed: "未受入のまま受入を終了しました。",
  shipped: "現場へ出庫しました。",
  returned_from_site: "現場からセンターへの返却を登録しました。",
  returned_to_company: "リース会社への返却を登録しました。",
};

const DUE_STYLES: Record<LeaseDueState, string> = {
  overdue: "bg-red-50 text-red-700",
  today: "bg-amber-50 text-amber-800",
  before: "bg-zinc-100 text-zinc-600",
  none: "bg-zinc-50 text-zinc-400",
};

/**
 * 二重送信対策（コードレビュー指摘 Critical #8）用の非表示フィールド。
 * 描画時に1回だけ operation_id を生成する。同一ページの再描画（別操作）では
 * 新しい id になるが、同一フォームの再送（二重クリック・ブラウザの再送）では
 * 同じ id が送られるため、Server Action 側で RPC の p_operation_id に渡し
 * 冪等に扱う。
 */
function OperationIdField() {
  return <input type="hidden" name="operation_id" value={crypto.randomUUID()} />;
}

export default async function LeaseBatchDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError, ok } = await searchParams;

  const user = await getCurrentUser();
  const role = resolveUiRole(user);
  const showAdminActions = canShowLeaseBatchAdminActions(role);
  const showStockActions = canShowLeaseStockActions(role);

  const [{ batch, error: batchError }, { rows: items, error: itemsError }, sites] =
    await Promise.all([
      fetchLeaseBatch(id),
      fetchLeaseBatchItems(id),
      fetchSiteOptions(),
    ]);

  if (batchError) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {batchError.message}</p>
        <Link
          href="/leases/batches"
          className="mt-4 inline-block text-sm text-zinc-600"
        >
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!batch) notFound();

  const okText = ok ? OK_MESSAGES[ok] : null;
  const canApprove = showAdminActions && batch.status === "draft";
  const canCancel =
    showAdminActions &&
    (batch.status === "draft" || batch.status === "approved") &&
    batch.total_received === 0;
  const canReceive =
    showStockActions &&
    (batch.status === "approved" || batch.status === "receiving");
  const canMove = showStockActions && (batch.status === "receiving" || batch.status === "received");

  const approveAction = approveLeaseBatch.bind(null, id);
  const cancelAction = cancelLeaseBatch.bind(null, id);
  const receiveAction = receiveLeaseBatchItem.bind(null, id);
  const closeReceivingAction = closeLeaseBatchItemReceiving.bind(null, id);
  const shipAction = shipLeaseStockToSite.bind(null, id);
  const returnFromSiteAction = returnLeaseStockFromSite.bind(null, id);
  const returnToCompanyAction = returnLeaseToCompany.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link
            href="/leases/batches"
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            ← リース借用一覧
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            {batch.lease_company_name ?? "（リース会社不明）"}
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {batch.borrowed_at} 借用
            </span>
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <LeaseSectionNav active="batches" />

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

        {itemsError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            明細の読み込みエラー: {itemsError.message}
          </p>
        )}

        {/* ---- 借用情報 ---- */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <dl className="grid flex-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">状態</dt>
                <dd className="mt-0.5 font-medium text-zinc-900">
                  {LEASE_BATCH_STATUS_LABELS[batch.status]}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">伝票番号</dt>
                <dd className="mt-0.5 text-zinc-900">
                  {batch.slip_number ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">納品先</dt>
                <dd className="mt-0.5 text-zinc-900">
                  {LEASE_DELIVERY_KIND_LABELS[batch.delivery_kind]}
                  {batch.delivery_site_name
                    ? `（${batch.delivery_site_name}）`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">承認日時</dt>
                <dd className="mt-0.5 text-zinc-900">
                  {batch.approved_at
                    ? new Date(batch.approved_at).toLocaleString("ja-JP")
                    : "未承認"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-zinc-500">備考</dt>
                <dd className="mt-0.5 text-zinc-900">{batch.note ?? "—"}</dd>
              </div>
            </dl>

            {(canApprove || canCancel) && (
              <div className="flex flex-col gap-2">
                {canApprove && (
                  <form action={approveAction}>
                    <OperationIdField />
                    <SubmitButton
                      className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                      pendingLabel="承認中..."
                    >
                      承認する
                    </SubmitButton>
                  </form>
                )}
                {canCancel && (
                  <form action={cancelAction}>
                    <OperationIdField />
                    <SubmitButton
                      className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      pendingLabel="処理中..."
                    >
                      キャンセル
                    </SubmitButton>
                  </form>
                )}
              </div>
            )}
          </div>

          {batch.status === "draft" && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              未承認のため、センターは受入できません。
              {showAdminActions
                ? "内容を確認のうえ承認してください。"
                : "事務（admin）の承認をお待ちください。"}
            </p>
          )}
        </section>

        {/* ---- 明細 ---- */}
        {items.map((item) => {
          const dueState = resolveLeaseDueState(
            item.return_due_date,
            item.return_obligation_quantity,
          );

          return (
            <section
              key={item.id}
              className="rounded-lg border border-zinc-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-900">
                  {item.product_code ? `${item.product_code} ` : ""}
                  {item.product_name}
                  {item.product_unit ? (
                    <span className="ml-1 text-xs font-normal text-zinc-500">
                      （{item.product_unit}）
                    </span>
                  ) : null}
                </h2>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${DUE_STYLES[dueState]}`}
                >
                  返却期限: {item.return_due_date ?? "未定"} /{" "}
                  {LEASE_DUE_STATE_LABELS[dueState]}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <div>
                  <dt className="text-zinc-500">借用数量</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">
                    {item.quantity}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">受入済み</dt>
                  <dd className="mt-0.5 text-zinc-900">
                    {item.received_quantity}
                    {item.receiving_closed && (
                      <span className="ml-1 text-xs text-amber-700">
                        （受入終了済）
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">返却済み</dt>
                  <dd className="mt-0.5 text-zinc-900">
                    {item.returned_quantity}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">返却義務残</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900">
                    {item.return_obligation_quantity}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">センター保管</dt>
                  <dd className="mt-0.5 text-zinc-900">
                    {item.center_quantity}
                  </dd>
                </div>
              </dl>

              {item.receiving_closed && item.receiving_closed_reason && (
                <p className="mt-2 text-xs text-zinc-500">
                  受入終了理由: {item.receiving_closed_reason}
                  {item.receiving_closed_at &&
                    `（${new Date(item.receiving_closed_at).toLocaleString("ja-JP")}）`}
                </p>
              )}

              {item.site_quantities.length > 0 && (
                <div className="mt-3 text-sm">
                  <span className="text-zinc-500">現場保管: </span>
                  {item.site_quantities.map((s) => (
                    <span key={s.site_id} className="mr-3 text-zinc-900">
                      {s.site_name} {s.quantity}
                    </span>
                  ))}
                </div>
              )}

              {/* ---- center 操作 ---- */}
              {(canReceive || canMove) && (
                <div className="mt-5 grid gap-4 border-t border-zinc-100 pt-4 lg:grid-cols-2">
                  {canReceive &&
                    item.remaining_to_receive > 0 &&
                    !item.receiving_closed && (
                      <form
                        action={receiveAction}
                        className="rounded-lg bg-zinc-50 p-3"
                      >
                        <OperationIdField />
                        <input type="hidden" name="item_id" value={item.id} />
                        <p className="text-xs font-medium text-zinc-700">
                          受入（残り {item.remaining_to_receive}）
                        </p>
                        <div className="mt-2 flex gap-2">
                          <input
                            name="quantity"
                            type="number"
                            step="1"
                            min="0"
                            max={item.remaining_to_receive}
                            required
                            className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                            placeholder="数量"
                          />
                          <SubmitButton
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                            pendingLabel="送信中..."
                          >
                            受入確定
                          </SubmitButton>
                        </div>
                      </form>
                    )}

                  {canReceive &&
                    item.remaining_to_receive > 0 &&
                    !item.receiving_closed && (
                      <form
                        action={closeReceivingAction}
                        className="rounded-lg bg-zinc-50 p-3"
                      >
                        <OperationIdField />
                        <input type="hidden" name="item_id" value={item.id} />
                        <p className="text-xs font-medium text-zinc-700">
                          未受入のまま受入を終了（欠品・打ち切り等）
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            name="reason"
                            type="text"
                            required
                            placeholder="理由（例: 欠品のため打ち切り）"
                            className="min-w-[200px] flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                          />
                          <SubmitButton
                            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                            pendingLabel="送信中..."
                          >
                            受入終了
                          </SubmitButton>
                        </div>
                      </form>
                    )}

                  {canMove && item.center_quantity > 0 && (
                    <form
                      action={shipAction}
                      className="rounded-lg bg-zinc-50 p-3"
                    >
                      <OperationIdField />
                      <input type="hidden" name="item_id" value={item.id} />
                      <p className="text-xs font-medium text-zinc-700">
                        センター → 現場 出庫（センター {item.center_quantity}）
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <select
                          name="site_id"
                          required
                          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                        >
                          <option value="">現場を選択</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <input
                          name="quantity"
                          type="number"
                          step="1"
                          min="0"
                          max={item.center_quantity}
                          required
                          className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                          placeholder="数量"
                        />
                        <SubmitButton
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                          pendingLabel="送信中..."
                        >
                          出庫
                        </SubmitButton>
                      </div>
                    </form>
                  )}

                  {canMove && item.site_quantities.length > 0 && (
                    <form
                      action={returnFromSiteAction}
                      className="rounded-lg bg-zinc-50 p-3"
                    >
                      <OperationIdField />
                      <input type="hidden" name="item_id" value={item.id} />
                      <p className="text-xs font-medium text-zinc-700">
                        現場 → センター 返却
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <select
                          name="site_id"
                          required
                          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
                        >
                          <option value="">現場を選択</option>
                          {item.site_quantities.map((s) => (
                            <option key={s.site_id} value={s.site_id}>
                              {s.site_name}（{s.quantity}）
                            </option>
                          ))}
                        </select>
                        <input
                          name="quantity"
                          type="number"
                          step="1"
                          min="0"
                          required
                          className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                          placeholder="数量"
                        />
                        <SubmitButton
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                          pendingLabel="送信中..."
                        >
                          返却受付
                        </SubmitButton>
                      </div>
                    </form>
                  )}

                  {canMove && item.center_quantity > 0 && (
                    <form
                      action={returnToCompanyAction}
                      className="rounded-lg bg-zinc-50 p-3"
                    >
                      <OperationIdField />
                      <input type="hidden" name="item_id" value={item.id} />
                      <p className="text-xs font-medium text-zinc-700">
                        リース会社へ返却（一部返却可）
                      </p>
                      <div className="mt-2 flex gap-2">
                        <input
                          name="quantity"
                          type="number"
                          step="1"
                          min="0"
                          max={Math.min(
                            item.center_quantity,
                            item.return_obligation_quantity,
                          )}
                          required
                          className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                          placeholder="数量"
                        />
                        <SubmitButton
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                          pendingLabel="送信中..."
                        >
                          返却登録
                        </SubmitButton>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        現場にある分は、先に現場からセンターへ返却してください。
                      </p>
                    </form>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {items.length === 0 && !itemsError && (
          <p className="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center text-zinc-600">
            明細がありません。
          </p>
        )}
      </main>
    </div>
  );
}
