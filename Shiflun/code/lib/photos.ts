import { SupabaseClient } from "@supabase/supabase-js";

/** プロフィール写真・店舗写真の保存先（非公開バケット。migration 024）。 */
export const PHOTO_BUCKET = "profile-photos";
/** 画面に出すURLの有効時間（秒）。一覧を開いている間もてば十分。 */
const URL_TTL_SECONDS = 60 * 60;

/**
 * 保存先のパスから、画面表示用の短時間だけ有効なURLを作る。戻り値は「パス → URL」。
 * 見られる範囲は Storage 側のポリシーが決める（読めないパスは結果に入らない）。
 * 024 が未適用・バケットが無いなどで失敗したときは、写真なし（頭文字表示）として扱う。
 */
export async function signPhotoUrls(supabase: SupabaseClient, paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
  if (!unique.length) return {};
  try {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, URL_TTL_SECONDS);
    if (error || !data) return {};
    const urls: Record<string, string> = {};
    for (const item of data) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    return urls;
  } catch {
    return {};
  }
}

/** 行の photo_path をもとに photo_url を付ける。 */
export async function withPhotoUrl<T extends { photo_path?: string | null }>(supabase: SupabaseClient, rows: T[]): Promise<(T & { photo_url: string | null })[]> {
  const urls = await signPhotoUrls(supabase, rows.map((row) => row.photo_path));
  return rows.map((row) => ({ ...row, photo_url: row.photo_path ? urls[row.photo_path] ?? null : null }));
}

/** 店舗IDごとの写真URL。写真のない店舗は入らない。 */
export async function storePhotoUrls(supabase: SupabaseClient, storeIds: (string | null | undefined)[]): Promise<Record<string, string>> {
  const ids = [...new Set(storeIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from("stores").select("id, photo_path").in("id", ids);
  if (error || !data) return {};
  const urls = await signPhotoUrls(supabase, data.map((row) => row.photo_path as string | null));
  const result: Record<string, string> = {};
  for (const row of data) if (row.photo_path && urls[row.photo_path]) result[row.id as string] = urls[row.photo_path];
  return result;
}

/** ワーカーIDごとの写真URL。写真のないワーカーは入らない。 */
export async function workerPhotoUrls(supabase: SupabaseClient, workerIds: (string | null | undefined)[]): Promise<Record<string, string>> {
  const ids = [...new Set(workerIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from("workers").select("id, photo_path").in("id", ids);
  if (error || !data) return {};
  const urls = await signPhotoUrls(supabase, data.map((row) => row.photo_path as string | null));
  const result: Record<string, string> = {};
  for (const row of data) if (row.photo_path && urls[row.photo_path]) result[row.id as string] = urls[row.photo_path];
  return result;
}
