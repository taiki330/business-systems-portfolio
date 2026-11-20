"use client";

import { useSession } from "@/components/auth/SessionProvider";

/** ログイン中の本人のワーカープロフィール。他のワーカーの情報は渡さない。 */
export function useCurrentWorker() {
  const { me, ready } = useSession();
  return { worker: me?.worker ?? null, ready };
}
