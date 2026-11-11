import { createClient } from "@/lib/supabase/server";
import { normalizeProductRef } from "@/lib/stock/normalize-product-ref";
import { HISTORY_PAGE_SIZE, getPagination } from "@/lib/pagination";
import { orIlike, sanitizeSearchTerm } from "@/lib/search/list-filter";
import type { SiteRef, StockProductRef } from "@/types/stock";
import type { StockReturnListRow } from "@/types/stock-return";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawReturnRow = {
  id: string;
  quantity: number;
  memo: string | null;
  returned_by: string | null;
  created_at: string;
  corrected_at: string | null;
  over_returns: { quantity: number }[] | null;
  products: StockProductRef | StockProductRef[] | null;
  sites: SiteRef | SiteRef[] | null;
};

function normalizeSiteRef(raw: SiteRef | SiteRef[] | null): SiteRef | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/**
 * 返却履歴（stock_returns）を新しい順に取得する。
 * returned_by は public.resolve_display_names RPC でまとめて表示名に解決する
 * （app_users の SELECT policy は自分の行のみのままのため、直接 join では解決できない）。
 */
export async function fetchReturnHistory(filters?: {
  siteId?: string;
  search?: string;
  page?: number;
}): Promise<{
  rows: StockReturnListRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  error: { message: string } | null;
}> {
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

  let countQuery = supabase
    .from("stock_returns")
    .select("id", { count: "exact", head: true });
  if (filters?.siteId) countQuery = countQuery.eq("site_id", filters.siteId);
  if (searchConditions.length) countQuery = countQuery.or(searchConditions.join(","));
  const { count, error: countError } = await countQuery;
  if (countError) {
    return { rows: [], totalCount: 0, page: 1, totalPages: 1, error: { message: countError.message } };
  }
  const pagination = getPagination(filters?.page ?? 1, count ?? 0, HISTORY_PAGE_SIZE);

  let query = supabase
    .from("stock_returns")
    .select(
      "id, quantity, memo, returned_by, created_at, corrected_at, site_id, products(code, name, unit), sites(name), over_returns(quantity)",
    )
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (filters?.siteId) query = query.eq("site_id", filters.siteId);
  if (searchConditions.length) query = query.or(searchConditions.join(","));

  const { data, error } = await query;

  if (error) {
    return { rows: [], totalCount: 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: { message: error.message } };
  }

  const raws = (data ?? []) as RawReturnRow[];

  const userIds = Array.from(
    new Set(
      raws
        .map((r) => r.returned_by)
        .filter((v): v is string => !!v && UUID_RE.test(v)),
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
      for (const row of (names ?? []) as { id: string; display_name: string | null }[]) {
        if (row.display_name) {
          displayNameById.set(row.id, row.display_name);
        }
      }
    }
  }

  const rows: StockReturnListRow[] = raws.map((raw) => {
    const overQuantity = (raw.over_returns ?? []).reduce((sum, row) => sum + Number(row.quantity), 0);
    return {
    id: raw.id,
    inputQuantity: Number(raw.quantity) + overQuantity,
    quantity: Number(raw.quantity),
    overQuantity,
    memo: raw.memo,
    returnedByName: raw.returned_by
      ? (displayNameById.get(raw.returned_by) ?? null)
      : null,
    createdAt: raw.created_at,
    correctedAt: raw.corrected_at,
    products: normalizeProductRef(raw.products),
    sites: normalizeSiteRef(raw.sites),
  }});

  return { rows, totalCount: count ?? 0, page: pagination.currentPage, totalPages: pagination.totalPages, error: null };
}
