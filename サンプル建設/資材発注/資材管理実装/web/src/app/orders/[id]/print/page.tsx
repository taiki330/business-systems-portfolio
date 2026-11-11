import { PrintButton } from "@/components/orders/PrintButton";
import { fetchOrderPrintData } from "@/lib/orders/fetch-orders";
import { formatJstDateTime } from "@/lib/datetime/jst";
import { OWNERSHIP_LABELS } from "@/types/order";
import type { OrderPrintItem } from "@/types/order";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

const ITEMS_PER_PAGE = 22;

/**
 * 明細のヤード名。事業所はサンプル市Aセンターのみで他ヤードは想定しない
 * （D-20260801-15 / D-20260805-02）。増設時はここを可変にする。
 */
const YARD_NAME = "サンプル市A";

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

function formatWeight(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
}

function formatDeadline(value: string | null): string {
  if (!value) return "—";
  return formatJstDateTime(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function planLabel(item: OrderPrintItem): string {
  switch (item.planStatus) {
    case "over":
      return `累計超過 +${formatQuantity(item.overQuantity ?? 0)}（予定 ${formatQuantity(item.plannedQuantity ?? 0)}／見込 ${formatQuantity(item.expectedQuantity ?? 0)}）`;
    case "within":
      return `累計予定内（予定 ${formatQuantity(item.plannedQuantity ?? 0)}／見込 ${formatQuantity(item.expectedQuantity ?? 0)}）`;
    case "missing":
      return "予定未登録";
    case "unknown":
      return "判定不可";
  }
}

function planCellClass(item: OrderPrintItem): string {
  if (item.planStatus === "over") return "bg-red-100 font-bold text-red-900";
  if (item.planStatus === "missing" || item.planStatus === "unknown") {
    return "bg-amber-50 font-medium text-amber-900";
  }
  return "";
}

export default async function OrderPrintPage({ params }: PageProps) {
  const { id } = await params;
  const { data, error } = await fetchOrderPrintData(id);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-700">帳票データの読み込みに失敗しました: {error.message}</p>
        <Link href={`/orders/${id}`} className="mt-4 inline-block text-sm text-zinc-600">
          オーダー詳細へ戻る
        </Link>
      </div>
    );
  }
  if (!data) notFound();

  const pages = Array.from(
    { length: Math.max(1, Math.ceil(data.items.length / ITEMS_PER_PAGE)) },
    (_, index) => data.items.slice(index * ITEMS_PER_PAGE, (index + 1) * ITEMS_PER_PAGE),
  );

  return (
    <div className="min-h-full bg-zinc-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-6 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <Link href={`/orders/${id}`} className="text-sm text-zinc-600 hover:text-zinc-900">
          ← オーダー詳細へ戻る
        </Link>
        <PrintButton />
      </div>

      {pages.map((items, pageIndex) => (
        <article
          key={pageIndex}
          className="order-print-page mx-auto mb-6 w-[210mm] min-h-[297mm] bg-white p-[12mm] text-black shadow print:mb-0 print:shadow-none"
        >
          <header className="border-2 border-black">
            <div className="grid grid-cols-[1fr_auto] border-b-2 border-black">
              <div className="px-3 py-2 text-center">
                {/* 資材種別はオーダーの商品カテゴリから自動判別する（D-20260801-10） */}
                <p className="min-h-[1.25rem] text-sm font-medium tracking-widest">
                  {data.materialCategories.join("・")}
                </p>
                <h1 className="text-2xl font-bold tracking-[0.2em]">資材発注書</h1>
              </div>
              <dl className="border-l-2 border-black text-xs">
                <div className="flex border-b border-black"><dt className="w-20 border-r border-black px-2 py-1">ページ</dt><dd className="px-2 py-1">{pageIndex + 1} / {pages.length}</dd></div>
                <div className="flex"><dt className="w-20 border-r border-black px-2 py-1">オーダー番号</dt><dd className="px-2 py-1">{data.order_number ?? "—"}</dd></div>
              </dl>
            </div>
            <div
              className={`border-b border-black px-3 py-1 text-center text-sm font-bold ${
                data.overPlanItemCount > 0
                  ? "bg-red-100 text-red-900"
                  : "bg-zinc-50 text-zinc-700"
              }`}
            >
              {data.overPlanItemCount > 0
                ? `累計見込の予定数量超過あり：${data.overPlanItemCount}件（明細の「予定判定」を確認）`
                : "累計見込の予定数量超過なし"}
            </div>
            <div className="grid grid-cols-2 text-sm">
              <dl className="border-r border-black">
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">現場名</dt><dd className="px-2 py-1">{data.site_name}</dd></div>
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">元請</dt><dd className="px-2 py-1">{data.prime_contractor_name_snapshot ?? "未設定"}</dd></div>
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">伝票用現場番号</dt><dd className="px-2 py-1">{data.prime_contractor_slip_number_snapshot && data.slip_site_number_snapshot ? `${data.prime_contractor_slip_number_snapshot}-${data.slip_site_number_snapshot}` : "未設定"}</dd></div>
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">納期</dt><dd className="px-2 py-1">{formatDeadline(data.delivery_deadline)}</dd></div>
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">ヤード積込日</dt><dd className="px-2 py-1">{formatDate(data.yard_loading_date)}</dd></div>
                <div className="flex border-b border-black"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">発注者名</dt><dd className="px-2 py-1">{data.requesterLabel ?? "未設定"}</dd></div>
                <div className="flex"><dt className="w-28 shrink-0 whitespace-nowrap border-r border-black px-2 py-1">合計重量</dt><dd className="px-2 py-1">{data.totalWeightKg == null ? "—" : `${formatWeight(data.totalWeightKg)} kg`}</dd></div>
              </dl>
              {/* 以下は印刷後に手書きで記入する欄。入力・保存はしない
                  （運転手・リフトマン: D-20260805-01 #4／運送区分・運送情報・伝票備考: D-20260805-02）。 */}
              <dl>
                <div className="flex border-b border-black"><dt className="w-24 border-r border-black px-2 py-1">運転手</dt><dd className="px-2 py-1">&nbsp;</dd></div>
                <div className="flex border-b border-black"><dt className="w-24 border-r border-black px-2 py-1">リフトマン</dt><dd className="px-2 py-1">&nbsp;</dd></div>
                <div className="flex border-b border-black"><dt className="w-24 border-r border-black px-2 py-1">運送区分</dt><dd className="px-2 py-1">&nbsp;</dd></div>
                <div className="flex border-b border-black"><dt className="w-24 border-r border-black px-2 py-1">運送情報</dt><dd className="px-2 py-1">&nbsp;</dd></div>
                <div className="flex"><dt className="w-24 border-r border-black px-2 py-1">伝票備考</dt><dd className="px-2 py-1">&nbsp;</dd></div>
              </dl>
            </div>
          </header>

          <table className="mt-4 w-full border-collapse border-2 border-black text-sm">
            <thead>
              <tr className="bg-zinc-100">
                <th className="border border-black px-2 py-1.5 text-left">商品コード</th>
                <th className="border border-black px-2 py-1.5 text-left">名称</th>
                <th className="border border-black px-2 py-1.5 text-right">数量</th>
                <th className="border border-black px-2 py-1.5 text-right">重量(kg)</th>
                <th className="border border-black px-2 py-1.5 text-center">ヤード名</th>
                <th className="border border-black px-2 py-1.5 text-center">区分</th>
                <th className="border border-black px-2 py-1.5 text-center">半端</th>
                <th className="border border-black px-2 py-1.5 text-center">予定判定（累計）</th>
                <th className="border border-black px-2 py-1.5 text-left">商品備考</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="border border-black px-2 py-1.5">{item.product_code ?? "—"}</td>
                  <td className="border border-black px-2 py-1.5">{item.product_name}</td>
                  <td className="border border-black px-2 py-1.5 text-right">{formatQuantity(item.quantity)}{item.product_unit ?? ""}</td>
                  <td className="border border-black px-2 py-1.5 text-right">{item.lineWeightKg == null ? "—" : formatWeight(item.lineWeightKg)}</td>
                  <td className="border border-black px-2 py-1.5 text-center">{YARD_NAME}</td>
                  <td className="border border-black px-2 py-1.5 text-center">{OWNERSHIP_LABELS[item.ownership]}</td>
                  <td className="border border-black px-2 py-1.5 text-center">{item.isLotSizeViolation ? "半端" : ""}</td>
                  <td className={`border border-black px-2 py-1.5 text-center text-xs ${planCellClass(item)}`}>
                    {planLabel(item)}
                  </td>
                  {/* 商品備考は印刷後に手書きする欄（D-20260805-02） */}
                  <td className="border border-black px-2 py-1.5">&nbsp;</td>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, ITEMS_PER_PAGE - items.length) }, (_, index) => (
                <tr key={`blank-${index}`} className="h-8"><td className="border border-black" colSpan={9} /></tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-xs text-zinc-600">
            運転手・リフトマン・運送区分・運送情報・伝票備考・商品備考は手書き用の空欄です。
            重量が未登録の資材は合計重量に含まれません。予定判定は「既出庫＋未処理オーダー」を予定数量と比較しています。
          </p>
        </article>
      ))}
    </div>
  );
}
