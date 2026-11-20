"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getMe, Me } from "@/lib/actions/session";

type SessionValue = { me: Me | null; ready: boolean; refresh: () => Promise<void> };

const SIGNED_OUT: Me = { signedIn: false, email: null, worker: null, store: null };
const SessionContext = createContext<SessionValue>({ me: null, ready: false, refresh: async () => {} });

/** ログイン中の本人（ワーカー・店舗）を画面全体で共有する。ログイン・登録の後は refresh() で取り直す。 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname();
  // 後から始めた読み込みの結果だけを使う（ログアウト直後に古いアカウントの結果で上書きしないため）。
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    return Promise.resolve().then(getMe).then(
      (result) => { if (current === sequence.current) setMe(result); },
      () => { if (current === sequence.current) setMe(SIGNED_OUT); },
    );
  }, []);
  useEffect(() => {
    // ログイン導入前に端末へ保存していたIDは使わないので消しておく。
    try { localStorage.removeItem("shiflun_worker_id"); localStorage.removeItem("shiflun_store_id"); } catch {}
  }, []);
  // ログイン・ログアウト・アカウントの切り替えは画面遷移を伴うので、遷移のたびに取り直す。
  useEffect(() => { void refresh(); }, [refresh, pathname]);
  return <SessionContext.Provider value={{ me, ready: me !== null, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
