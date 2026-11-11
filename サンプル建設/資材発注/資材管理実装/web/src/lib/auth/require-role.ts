import { isAuthzEnabled } from "@/lib/auth/authz-flag";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import type { AppUser, AppUserRole } from "@/types/app-user";
import type { StockRequestStatus } from "@/types/stock-request";
import { redirect } from "next/navigation";

type RegisteredUser = AppUser & { role: AppUserRole };

type RequestCreatorUser = AppUser & { role: "internal" | "vendor" };

/** Redirect authorization denials so production keeps the 403 context. */
function denyAccess(): never {
  redirect("/forbidden");
}

export type VendorOwnedRequest = {
  id: string;
  status: StockRequestStatus;
  requested_by: string | null;
  site_id: string;
};

function assertRegistered(user: AppUser | null): RegisteredUser {
  if (!user) {
    denyAccess();
  }
  if (user.role === null) {
    denyAccess();
  }
  return user as RegisteredUser;
}

/**
 * ログイン済み + app_users 登録済み（role !== null）。
 * (b) 未登録は /forbidden へ遷移する。
 */
export async function requireAuthenticatedUser(): Promise<RegisteredUser> {
  if (!isAuthzEnabled()) {
    const user = await getCurrentUser();
    if (!user || user.role === null) {
      return {
        id: user?.id ?? "",
        email: user?.email ?? null,
        role: "internal",
        display_name: user?.display_name ?? null,
        vendor_id: user?.vendor_id ?? null,
        site_id: user?.site_id ?? null,
        center_id: user?.center_id ?? null,
      };
    }
    return user as RegisteredUser;
  }
  return assertRegistered(await getCurrentUser());
}

/** internal のみ。vendor / (b) は /forbidden へ遷移する。（レガシー。新規は requireAdmin/requireCenter を使う） */
export async function requireInternal(): Promise<
  AppUser & { role: "internal" }
> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return user as AppUser & { role: "internal" };
  }
  if (user.role !== "internal") {
    denyAccess();
  }
  return user as AppUser & { role: "internal" };
}

/**
 * admin(事務) のみ。マスタ管理・在庫直接補正・ユーザー/業者管理用。
 * internal はレガシー superuser として admin 相当に許可する（移行期間の無停止）。
 */
export async function requireAdmin(): Promise<RegisteredUser> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return user;
  }
  if (user.role !== "admin" && user.role !== "internal") {
    denyAccess();
  }
  return user;
}

/**
 * center(サンプル市Aセンター) のみ。受付・出庫確定・返却登録・入出庫・依頼キャンセル用。
 * internal はレガシー superuser として center 相当に許可する（移行期間の無停止）。
 */
export async function requireCenter(): Promise<RegisteredUser> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return user;
  }
  if (user.role !== "center" && user.role !== "internal") {
    denyAccess();
  }
  return user;
}

/** admin または center。両者が参照可能な機能用。 */
export async function requireAdminOrCenter(): Promise<RegisteredUser> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return user;
  }
  if (
    user.role !== "admin" &&
    user.role !== "center" &&
    user.role !== "internal"
  ) {
    denyAccess();
  }
  return user;
}

/** createOrder 用: internal | vendor。 */
export async function requireRequestCreator(): Promise<RequestCreatorUser> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return user as RequestCreatorUser;
  }
  if (user.role !== "internal" && user.role !== "vendor") {
    denyAccess();
  }
  return user as RequestCreatorUser;
}

/**
 * vendor の依頼操作前に、自分の依頼かつ status 条件を検証する。
 * cancel 用: allowedStatuses: ['requested']（Q-app2-1）。
 */
export async function requireVendorOwnedRequest(
  requestId: string,
  options?: { allowedStatuses?: StockRequestStatus[] },
): Promise<VendorOwnedRequest> {
  const user = await requireAuthenticatedUser();
  if (!isAuthzEnabled()) {
    return {
      id: requestId,
      status: "requested",
      requested_by: user.id,
      site_id: "",
    };
  }
  if (user.role !== "vendor") {
    denyAccess();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_requests")
    .select("id, status, requested_by, site_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    denyAccess();
  }
  if (!data) {
    denyAccess();
  }
  if (data.requested_by !== user.id) {
    denyAccess();
  }

  const allowed = options?.allowedStatuses;
  if (allowed && !allowed.includes(data.status as StockRequestStatus)) {
    denyAccess();
  }

  return data as VendorOwnedRequest;
}
