"use client";

import { useEffect, useState } from "react";

/**
 * 使っている途中で通信が切れたときの帯。保存や送信がうまくいかない理由が分かるようにする。
 * （起動時に接続できないときは、アプリが端末内のオフライン画面 public/offline.html を出す。）
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (!offline) return null;
  return <div role="status" className="sticky top-0 z-[60] bg-ink px-4 py-2.5 text-center text-sm font-bold text-white">
    インターネットに接続されていません。通信が戻るまで、保存や送信はできません。
  </div>;
}
