import { createClient } from "./server";

export type SupabaseHealth = {
  ok: boolean;
  message: string;
};

/** API キーと PostgREST への到達性を確認（テーブル不要） */
export async function checkSupabaseConnection(): Promise<SupabaseHealth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      ok: false,
      message: ".env.local に NEXT_PUBLIC_SUPABASE_URL / ANON_KEY がありません。",
    };
  }

  if (url.includes("/rest/v1")) {
    return {
      ok: false,
      message:
        "SUPABASE_URL に /rest/v1 は付けないでください。例: https://xxxx.supabase.co",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();

    if (error) {
      return { ok: false, message: `接続エラー: ${error.message}` };
    }

    return { ok: true, message: "Supabase に接続できました。" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
