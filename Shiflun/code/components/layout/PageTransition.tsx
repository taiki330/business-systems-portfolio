"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";

/**
 * ページ遷移ごとに下からふっと浮き上がるアニメーションを再生する。
 * Next.jsのレイアウトはルート遷移で再マウントされないため、pathnameをkeyにして
 * 中身を強制的に再マウントさせることでアニメーションを再トリガーしている。
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page-in">
      {children}
    </div>
  );
}
