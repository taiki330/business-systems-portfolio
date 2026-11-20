"use client";

import { useActionState } from "react";
import { AuthFormState, signInWithPassword } from "@/lib/actions/auth";

/**
 * パスワードでのログイン（ワーカー）。ふだんは閉じておく。
 * ワーカーは通常メールの確認コードでログインするため、パスワードを持っていない。
 * App Store / Google Play の審査担当のように、確認コードのメールを受け取れない人のために
 * 運営がパスワード付きで用意したアカウントだけが使う（docs/mobile-release.md「審査用アカウント」）。
 */
export function WorkerPasswordLogin({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, {} as AuthFormState);
  return <details className="rounded-xl border border-line bg-white px-4" open={Boolean(state.error)}>
    <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium text-ink-soft">パスワードでログイン</summary>
    <form action={action} className="space-y-4 pb-4 pt-1">
      <input type="hidden" name="next" value={next} />
      <p className="text-xs leading-relaxed text-ink-soft">パスワードを設定したアカウント（運営が用意したもの）だけが使えます。通常は上のメールの確認コードでログインしてください。</p>
      <div><label htmlFor="pw_email" className="app-label">メールアドレス</label><input id="pw_email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className="app-input" /></div>
      <div><label htmlFor="pw_password" className="app-label">パスワード</label><input id="pw_password" name="password" type="password" autoComplete="current-password" required className="app-input" /></div>
      {state.error && <p role="alert" className="app-error">{state.error}</p>}
      <button disabled={pending} className="app-secondary w-full">{pending ? "確認中…" : "ログイン"}</button>
    </form>
  </details>;
}
