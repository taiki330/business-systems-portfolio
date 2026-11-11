import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import { createClient } from "@/lib/supabase/server";
import { HISTORY_PAGE_SIZE, getPagination } from "@/lib/pagination";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import type { OverReturnListRow, OverReturnStatus } from "@/types/over-return";
import type { SiteRef, StockProductRef } from "@/types/stock";

type RawOverReturnRow = {
  id: string;
  quantity: number;
  input_quantity: number;
  normal_quantity: number;
  status: OverReturnStatus;
  memo: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  products: StockProductRef | StockProductRef[] | null;
  sites: SiteRef | SiteRef[] | null;
};

function normalizeSiteRef(raw: SiteRef | SiteRef[] | null): SiteRef | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * 過入庫一覧を新しい順に取得する。
 * 操作者は fetchReturnHistory と同じく resolve_display_names RPC で解決する
 * （app_users の SELECT policy は自分の行のみのため直接 join できない）。
 */
export async function fetchOverReturns(
  filters?: { status?: OverReturnStatus; siteId?: string; search?: string; page?: number },
): Promise<{ rows: OverReturnListRow[]; totalCount: number; page: number; totalPages: number; error: { message: string } | null }> {
  const supabase = await createClient();
  const search = sanitizeSearchTerm(filters?.search);
  const [productResult, siteResult] = search
    ? await Promise.all([
        supabase.from("products").select("id").or(orIlike(search, ["code", "name"])),
        supabase.from("sites").select("id").or(orIlike(search, ["code", "name"])),
      ])
    : [{ data: [] }, { data: [] }];
  const productIds = (productResult.data ?? []).map((row) => row.id);
  const siteIds = (siteResult.data ?? []).map((row) => row.id);
  const searchConditions = search
    ? [
        `memo.ilike.%${search}%`,
        ...(productIds.length ? [`product_id.in.(${productIds.join(",")})`] : []),
        ...(siteIds.length ? [`site_id.in.(${siteIds.join(",")})`] : []),
      ]
    : [];

  let countQuery = supabase.from("over_returns").select("id", { count: "exact", head: true });
  if (filters?.status) countQuery = countQuery.eq("status", filters.status);
  if (filters?.siteId) countQuery = countQuery.eq("site_id", filters.siteId);
  if (searchConditions.length) countQuery = countQuery.or(searchConditions.join(","));
  const { count, error: countError } = await countQuery;
  if (countError) return { rows: [], totalCount: 0, page: 1, totalPages: 1, error: { message: countError.message } };
  const pagination = getPagination(filters?.page ?? 1, count ?? 0, HISTORY_PAGE_SIZE);

  let query = supabase
    .from("over_returns")
    .select(
      "id, quantity, input_quantity, normal_quantity, status, memo, created_at, created_by, confirmed_at, confirmed_by, products(code, name, unit), sites(name)",
    )
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.siteId) {
    query = query.eq("site_id", filters.siteId);
  }
  if (searchConditions.length) query = query.or(searchConditions.join(","));

  const { data, error } = await query;
  if (error) return { rows: [], totalCount: 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: { message: error.message } };

  const raws = (data ?? []) as RawOverReturnRow[];

  const userIds = Array.from(
    new Set(
      raws
        .flatMap((r) => [r.created_by, r.confirmed_by])
        .filter((v): v is string => !!v),
    ),
  );

  const displayNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: names, error: namesError } = await supabase.rpc(
      "resolve_display_names",
      { p_user_ids: userIds },
    );
    if (namesError) {
      console.error("resolve_display_names:", namesError.message);
    } else {
      for (const row of (names ?? []) as {
        id: string;
        display_name: string | null;
      }[]) {
        if (row.display_name) displayNameById.set(row.id, row.display_name);
      }
    }
  }

  const rows: OverReturnListRow[] = raws.map((raw) => ({
    id: raw.id,
    quantity: Number(raw.quantity),
    inputQuantity: Number(raw.input_quantity),
    normalQuantity: Number(raw.normal_quantity),
    status: raw.status,
    memo: raw.memo,
    createdAt: raw.created_at,
    confirmedAt: raw.confirmed_at,
    createdByName: raw.created_by
      ? (displayNameById.get(raw.created_by) ?? null)
      : null,
    confirmedByName: raw.confirmed_by
      ? (displayNameById.get(raw.confirmed_by) ?? null)
      : null,
    products: normalizeProductRef(raw.products),
    sites: normalizeSiteRef(raw.sites),
  }));

  return { rows, totalCount: count ?? 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: null };
}
