"use server";

import { getAuth, getCurrentStore, getCurrentWorker } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { Store, Worker } from "@/lib/types/database";

export type Me = {
  signedIn: boolean;
  email: string | null;
  worker: Worker | null;
  store: Store | null;
};

/** 画面側に渡す、ログイン中の本人の情報。DB未接続のモック表示では、モックのワーカー・店舗を返す。 */
export async function getMe(): Promise<Me> {
  if (!isSupabaseConfigured() || process.env.DEMO_MOCK === "true") {
    const { MOCK_STORES, MOCK_WORKERS } = await import("@/lib/mocks/data");
    return { signedIn: true, email: null, worker: MOCK_WORKERS[0] ?? null, store: MOCK_STORES[0] ?? null };
  }
  const { user } = await getAuth();
  if (!user) return { signedIn: false, email: null, worker: null, store: null };
  const [worker, store] = await Promise.all([getCurrentWorker(), getCurrentStore()]);
  return { signedIn: true, email: user.email ?? null, worker, store };
}
