"use client";

import { useSyncExternalStore } from "react";
import { useSession } from "@/components/auth/SessionProvider";

const CHANGE_EVENT = "shiflun-selection-change";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}
const serverId = () => null;
const serverReady = () => false;
const clientReady = () => true;

/** 端末だけに保存する値（同意ページでの同意の記録など）。本人の区別には使わない。 */
export function useStoredId(key: string) {
  const id = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key); } catch { return null; }
  }, serverId);
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  function setId(nextId: string) {
    localStorage.setItem(key, nextId);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  function clearId() {
    localStorage.removeItem(key);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return { id, ready, setId, clearId };
}

/** ログイン中の本人がオーナーの店舗ID（店舗登録がまだなら null）。 */
export function useStoreId() {
  const { me, ready, refresh } = useSession();
  return { storeId: me?.store?.id ?? null, ready, refreshStore: refresh };
}
