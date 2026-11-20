"use client";

import { useState } from "react";
import { signOut } from "@/lib/actions/auth";
import { unregisterPushToken } from "@/lib/actions/push";
import { PUSH_TOKEN_KEY } from "@/components/native/PushRegistration";

/** ログアウトして、トップページに戻る。アプリでは、この端末への通知も止める。 */
export function SignOutButton({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  return <form className={className} action={async () => {
    setPending(true);
    let token: string | null = null;
    try { token = localStorage.getItem(PUSH_TOKEN_KEY); } catch {}
    if (token) {
      await unregisterPushToken(token).catch(() => undefined);
      try { localStorage.removeItem(PUSH_TOKEN_KEY); } catch {}
    }
    await signOut();
  }}>
    <button type="submit" disabled={pending} className="min-h-11 text-sm font-medium text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-50">{pending ? "ログアウト中…" : "ログアウト"}</button>
  </form>;
}
