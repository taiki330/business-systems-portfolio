import {
  ConnectionCheckResult,
  TableCheckResult,
  TableName,
} from "@/lib/types/database";
import { createServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

const TABLES: TableName[] = [
  "workers",
  "manager_verifications",
  "scout_requests",
  "worker_availability_slots",
  "shift_periods",
  "store_join_requests",
];

const TABLE_LABELS: Record<TableName, string> = {
  workers: "ワーカー",
  manager_verifications: "店長認証",
  scout_requests: "スカウト",
  worker_availability_slots: "勤務可能時間",
  shift_periods: "シフト期間",
  store_join_requests: "所属登録の記録",
};

export { TABLE_LABELS };

export async function checkSupabaseConnection(): Promise<ConnectionCheckResult> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      connected: false,
      message:
        "環境変数が未設定です。.env.local に Supabase の URL と anon key を設定してください。",
      tables: [],
    };
  }

  const supabase = await createServerClient();

  if (!supabase) {
    return {
      configured: false,
      connected: false,
      message: "Supabase クライアントを作成できませんでした。",
      tables: [],
    };
  }

  const tables: TableCheckResult[] = [];

  for (const table of TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    tables.push({
      table,
      ok: !error,
      count: error ? null : count,
      error: error?.message ?? null,
    });
  }

  const connected = tables.every((result) => result.ok);

  return {
    configured: true,
    connected,
    message: connected
      ? "Supabase への接続とテーブル参照に成功しました。"
      : "Supabase には接続できましたが、一部テーブルを参照できません。SQL マイグレーションを実行してください。",
    tables,
  };
}
