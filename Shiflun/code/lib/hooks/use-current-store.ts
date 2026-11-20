"use client";

import { useSession } from "@/components/auth/SessionProvider";

/** ログイン中の本人がオーナーの店舗。他の店舗の情報は渡さない。 */
export function useCurrentStore() {
  const { me, ready } = useSession();
  return { store: me?.store ?? null, ready };
}
