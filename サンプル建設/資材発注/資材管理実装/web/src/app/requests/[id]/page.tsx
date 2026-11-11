import {
  acceptRequest,
  cancelRequest,
  shipRequest,
} from "@/app/requests/actions";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  canShowRequestAccept,
  canShowRequestCancel,
  canShowRequestShip,
  resolveUiRole,
} from "@/lib/auth/ui-capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  STOCK_REQUEST_STATUS_LABEL,
  type StockRequestRow,
  type StockRequestStatus,
} from "@/types/stock-request";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

type RawRow = Omit<StockRequestRow, "sites" | "products"> & {
  requested_by: string | null;
  sites:
    | { name: string; code: string | null }
    | { name: string; code: string | null }[]
    | null;
  products:
    | { name: string; code: string | null; unit: string | null }
    | { name: string; code: string | null; unit: string | null }[]
    | null;
};

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function statusBadgeClass(status: StockRequestStatus): string {
  switch (status) {
    case "requested":
      return "bg-amber-100 text-amber-800";
    case "accepted":
      return "bg-blue-100 text-blue-800";
    case "shipped":
      return "bg-green-100 text-green-800";
    case "cancelled":
      return "bg-zinc-200 text-zinc-700";
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ja-JP");
}

function okMessage(ok: string | undefined): string | null {
  if (ok === "accepted") return "受付しました。";
  if (ok === "cancelled") return "キャンセルしました。";
  if (ok === "shipped") return "出庫しました。在庫を減算しました。";
  return null;
}

export default async function RequestDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError, ok } = await searchParams;

  const user = await getCurrentUser();
  const uiRole = resolveUiRole(user);
  const userId = user?.id ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_requests")
    .select(
      "id, site_id, product_id, quantity, status, requested_by, requested_at, accepted_at, shipped_at, cancelled_at, note, sites(name, code), products(name, code, unit)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link
          href="/requests"
          className="mt-4 inline-block text-sm text-zinc-600"
        >
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  const raw = data as RawRow;
  const row: StockRequestRow = {
    id: raw.id,
    site_id: raw.site_id,
    product_id: raw.product_id,
    quantity: Number(raw.quantity),
    status: raw.status,
    requested_at: raw.requested_at,
    accepted_at: raw.accepted_at,
    shipped_at: raw.shipped_at,
    cancelled_at: raw.cancelled_at,
    note: raw.note,
    sites: pickFirst(raw.sites),
    products: pickFirst(raw.products),
  };

  const acceptAction = acceptRequest.bind(null, row.id);
  const cancelAction = cancelRequest.bind(null, row.id);
  const shipAction = shipRequest.bind(null, row.id);

  const okText = okMessage(ok);
  const canAccept = canShowRequestAccept(uiRole, row.status);
  const canShip = canShowRequestShip(uiRole, row.status);
  const canCancel = canShowRequestCancel(uiRole, {
    status: row.status,
    requestedBy: raw.requested_by,
    userId,
  });

  return (
    <div className="min-h-full bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <Link
              href="/requests"
              className="text-sm text-zinc-500 hover:text-zinc-800"
            >
              ← 出庫依頼一覧
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900">
              出庫依頼 詳細
            </h1>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(row.status)}`}
          >
            {STOCK_REQUEST_STATUS_LABEL[row.status]}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
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
          <h2 className="text-sm font-medium text-zinc-500">依頼内容</h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-500">現場</dt>
              <dd className="mt-1 text-zinc-900">
                {row.sites
                  ? row.sites.code
                    ? `${row.sites.code} — ${row.sites.name}`
                    : row.sites.name
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">商品</dt>
              <dd className="mt-1 text-zinc-900">
                {row.products
                  ? row.products.code
                    ? `${row.products.code} — ${row.products.name}`
                    : row.products.name
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">数量</dt>
              <dd className="mt-1 tabular-nums text-zinc-900">
                {row.quantity}
                {row.products?.unit ? (
                  <span className="ml-1 text-xs text-zinc-500">
                    {row.products.unit}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">備考</dt>
              <dd className="mt-1 whitespace-pre-wrap text-zinc-900">
                {row.note ?? "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-zinc-500">ステータス履歴</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-500">依頼日時</dt>
              <dd className="mt-1 text-zinc-900">
                {formatDateTime(row.requested_at)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">受付日時</dt>
              <dd className="mt-1 text-zinc-900">
                {formatDateTime(row.accepted_at)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">出庫日時</dt>
              <dd className="mt-1 text-zinc-900">
                {formatDateTime(row.shipped_at)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">キャンセル日時</dt>
              <dd className="mt-1 text-zinc-900">
                {formatDateTime(row.cancelled_at)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-zinc-500">操作</h2>
          {!canAccept && !canCancel && !canShip && (
            <p className="mt-3 text-sm text-zinc-600">
              現在のステータスでは操作できません（
              {STOCK_REQUEST_STATUS_LABEL[row.status]}）。
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {canAccept && (
              <form action={acceptAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  受付（accepted へ）
                </button>
              </form>
            )}

            {canShip && (
              <form action={shipAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  出庫確定（shipped へ）
                </button>
              </form>
            )}

            {canCancel && (
              <form action={cancelAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  キャンセル
                </button>
              </form>
            )}
          </div>

          {canShip && (
            <p className="mt-4 text-xs text-zinc-500">
              実行するとセンター在庫が減算されます。在庫不足時は処理されません。
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
