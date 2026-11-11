import { createClient } from "@/lib/supabase/server";
import { resolveLeaseDueState, type LeaseDueState } from "@/types/lease";

/**
 * リース中一覧・期限超過一覧（Phase 3-6）。
 *
 * 返却義務が残っている借用分のみを警告対象とする（要件定義書 §9 期限管理）。
 * コードレビュー指摘（Critical #4）対応: 警告判定は
 * 「借用数量 - 返却済み数量」（unreturned_quantity・未受入分を含む）ではなく、
 * 「受入済み数量 - 返却済み数量」（return_obligation_quantity・生成列）を用いる。
 * 未受入のまま返却期限を過ぎても、まだ受け取っていない分を「返却期限超過」として
 * 警告してしまわないようにするため。
 */

export type LeaseDueRow = {
  itemId: string;
  batchId: string;
  leaseCompanyName: string | null;
  slipNumber: string | null;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  borrowedAt: string;
  returnDueDate: string | null;
  quantity: number;
  receivedQuantity: number;
  returnedQuantity: number;
  /** 返却義務残 = 受入済み数量 - 返却済み数量（未受入分は含まない） */
  returnObligationQuantity: number;
  dueState: LeaseDueState;
};

type RawRow = {
  id: string;
  lease_batch_id: string;
  quantity: number;
  received_quantity: number;
  returned_quantity: number;
  return_obligation_quantity: number;
  return_due_date: string | null;
  products:
    | { code: string | null; name: string; unit: string | null }
    | { code: string | null; name: string; unit: string | null }[]
    | null;
  lease_batches:
    | {
        borrowed_at: string;
        slip_number: string | null;
        status: string;
        lease_companies: { name: string } | { name: string }[] | null;
      }
    | {
        borrowed_at: string;
        slip_number: string | null;
        status: string;
        lease_companies: { name: string } | { name: string }[] | null;
      }[]
    | null;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchLeaseDueList(options?: {
  overdueOnly?: boolean;
}): Promise<{ rows: LeaseDueRow[]; error: { message: string } | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lease_batch_items")
    .select(
      "id, lease_batch_id, quantity, received_quantity, returned_quantity," +
        " return_obligation_quantity, return_due_date," +
        " products(code, name, unit)," +
        " lease_batches(borrowed_at, slip_number, status, lease_companies(name))",
    )
    .gt("return_obligation_quantity", 0);

  if (error) {
    return { rows: [], error: { message: error.message } };
  }

  const rows: LeaseDueRow[] = [];

  for (const raw of (data ?? []) as unknown as RawRow[]) {
    const batch = firstOrNull(raw.lease_batches);
    // キャンセル済みの借用は対象外
    if (!batch || batch.status === "cancelled") continue;

    const product = firstOrNull(raw.products);
    const obligation = Number(raw.return_obligation_quantity);
    const dueState = resolveLeaseDueState(raw.return_due_date, obligation);

    if (options?.overdueOnly && dueState !== "overdue") continue;

    rows.push({
      itemId: raw.id,
      batchId: raw.lease_batch_id,
      leaseCompanyName: firstOrNull(batch.lease_companies)?.name ?? null,
      slipNumber: batch.slip_number,
      productCode: product?.code ?? null,
      productName: product?.name ?? "(商品不明)",
      productUnit: product?.unit ?? null,
      borrowedAt: batch.borrowed_at,
      returnDueDate: raw.return_due_date,
      quantity: Number(raw.quantity),
      receivedQuantity: Number(raw.received_quantity),
      returnedQuantity: Number(raw.returned_quantity),
      returnObligationQuantity: obligation,
      dueState,
    });
  }

  const DUE_ORDER: Record<LeaseDueState, number> = {
    overdue: 0,
    today: 1,
    before: 2,
    none: 3,
  };

  rows.sort((a, b) => {
    if (a.dueState !== b.dueState) {
      return DUE_ORDER[a.dueState] - DUE_ORDER[b.dueState];
    }
    const dueA = a.returnDueDate ?? "9999-12-31";
    const dueB = b.returnDueDate ?? "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return a.productName.localeCompare(b.productName, "ja");
  });

  return { rows, error: null };
}
