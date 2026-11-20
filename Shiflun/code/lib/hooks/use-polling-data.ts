"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePollingData<T extends { error: string | null }>(load: () => Promise<T>, interval = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const alive = useRef(false);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    return Promise.resolve().then(load).then((result) => {
      if (alive.current && current === sequence.current) { setData(result); setError(result.error); }
    }).catch(() => {
      if (alive.current && current === sequence.current) setError("読み込めませんでした。時間をおいて再度お試しください。");
    });
  }, [load]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, interval);
    window.addEventListener("focus", refresh);
    return () => { alive.current = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refresh, interval]);
  return { data, error, refresh };
}
