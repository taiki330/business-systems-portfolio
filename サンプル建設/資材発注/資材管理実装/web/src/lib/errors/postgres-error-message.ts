import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Postgres エラーコード → 共通の日本語メッセージ（テーブル横断・共通文言）。
 * コードを追加する場合はこのマップに追記するだけでよい。
 * 参考: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_MESSAGES: Record<string, string> = {
  "23503": "他のデータから参照されているため削除できません。",
  "23505": "既に登録されているデータと重複しています。",
  "23502": "必須項目が入力されていません。",
};

const DEFAULT_MESSAGE = "処理に失敗しました。時間をおいて再度お試しください。";

export function toUserFacingMessage(error: PostgrestError): string {
  return PG_ERROR_MESSAGES[error.code] ?? DEFAULT_MESSAGE;
}
