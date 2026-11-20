"use client";

import { useSession } from "@/components/auth/SessionProvider";

/** ログイン中の本人のワーカーID（ワーカー登録がまだなら null）。 */
export function useWorkerId() {
  const { me, ready, refresh } = useSession();
  return { workerId: me?.worker?.id ?? null, ready, refreshWorker: refresh };
}
