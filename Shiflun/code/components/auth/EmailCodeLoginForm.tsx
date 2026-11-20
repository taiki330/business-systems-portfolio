"use client";

import { useActionState } from "react";
import { AuthFormState, sendLoginCode, verifyLoginCode } from "@/lib/actions/auth";

/** ワーカーのログイン：メールアドレスを入れると確認コードが届き、そのコードを入力するとログインできる。 */
export function EmailCodeLoginForm({ next }: { next: string }) {
  const [sent, send, sending] = useActionState(sendLoginCode, {} as AuthFormState);
  const [verified, verify, verifying] = useActionState(verifyLoginCode, {} as AuthFormState);
  const codeStep = sent.step === "code" || verified.step === "code";
  const email = verified.email ?? sent.email ?? "";

  if (!codeStep) {
    return <form action={send} className="app-card space-y-4">
      <div>
        <label htmlFor="login_email" className="app-label">メールアドレス</label>
        <input id="login_email" name="email" type="email" inputMode="email" autoComplete="email" required defaultValue={email} className="app-input" placeholder="例：shiflun@example.com" />
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">はじめての方も同じ手順です。届いたコードを入力すると、アカウントができます。</p>
      </div>
      {sent.error && <p role="alert" className="app-error">{sent.error}</p>}
      <button disabled={sending} className="app-primary w-full">{sending ? "送信中…" : "確認コードを送る"}</button>
    </form>;
  }

  return <div className="space-y-3">
    <form action={verify} className="app-card space-y-4">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <p role="status" className="text-sm leading-relaxed text-ink-soft">{sent.message ?? `${email} に届いた確認コードを入力してください。`}</p>
      <div>
        <label htmlFor="login_code" className="app-label">確認コード</label>
        <input id="login_code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={12} required autoFocus className="app-input text-center text-2xl tracking-[0.4em] tabular-nums" />
      </div>
      {verified.error && <p role="alert" className="app-error">{verified.error}</p>}
      <button disabled={verifying} className="app-primary w-full">{verifying ? "確認中…" : "ログイン"}</button>
    </form>
    <form action={send} className="text-center">
      <input type="hidden" name="email" value={email} />
      <p className="text-xs leading-relaxed text-ink-soft">メールが届かないときは、迷惑メールのフォルダも確認してください。</p>
      <button disabled={sending} className="mt-1 text-sm font-semibold text-brand-blue underline-offset-4 hover:underline">{sending ? "送信中…" : "コードをもう一度送る"}</button>
    </form>
  </div>;
}
