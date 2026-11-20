"use client";

import { useActionState, useState } from "react";
import {
  AuthFormState, resetPassword, sendPasswordResetCode, signInWithPassword, signUpWithPassword, verifySignUpCode,
} from "@/lib/actions/auth";

type Mode = "signin" | "signup" | "reset";
const TABS: { mode: Mode; label: string }[] = [
  { mode: "signin", label: "ログイン" },
  { mode: "signup", label: "新規登録" },
  { mode: "reset", label: "パスワード再設定" },
];

/** 店長のログイン：メールアドレスとパスワード。新規登録とパスワード再設定はメールの確認コードで本人確認する。 */
export function StoreAuthForms({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  return <div className="space-y-4">
    <div role="tablist" aria-label="ログイン方法" className="grid grid-cols-3 gap-1 rounded-xl bg-chip p-1">
      {TABS.map((tab) => <button key={tab.mode} type="button" role="tab" aria-selected={mode === tab.mode} onClick={() => setMode(tab.mode)}
        className={`min-h-11 rounded-xl px-2 text-sm font-semibold ${mode === tab.mode ? "bg-white text-brand-blue-dark" : "text-ink-soft"}`}>{tab.label}</button>)}
    </div>
    {mode === "signin" && <SignIn next={next} onForgot={() => setMode("reset")} />}
    {mode === "signup" && <SignUp next={next} />}
    {mode === "reset" && <Reset next={next} />}
  </div>;
}

function EmailField({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return <div><label htmlFor={id} className="app-label">メールアドレス</label><input id={id} name="email" type="email" inputMode="email" autoComplete="email" required defaultValue={defaultValue} className="app-input" /></div>;
}

function PasswordField({ id, label, autoComplete }: { id: string; label: string; autoComplete: "current-password" | "new-password" }) {
  const isNew = autoComplete === "new-password";
  return <div>
    <label htmlFor={id} className="app-label">{label}</label>
    <input id={id} name="password" type="password" autoComplete={autoComplete} required minLength={isNew ? 8 : undefined} maxLength={72} className="app-input" />
    {isNew && <p className="mt-2 text-xs text-ink-soft">8文字以上。ほかのサービスと同じパスワードは避けてください。</p>}
  </div>;
}

function CodeField() {
  return <div><label htmlFor="store_code" className="app-label">確認コード</label><input id="store_code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={12} required className="app-input text-center text-2xl tracking-[0.4em] tabular-nums" /></div>;
}

function Feedback({ state }: { state: AuthFormState }) {
  return <>
    {state.message && <p role="status" className="text-sm leading-relaxed text-ink-soft">{state.message}</p>}
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
  </>;
}

function SignIn({ next, onForgot }: { next: string; onForgot: () => void }) {
  const [state, action, pending] = useActionState(signInWithPassword, {} as AuthFormState);
  return <form action={action} className="app-card space-y-4">
    <input type="hidden" name="next" value={next} />
    <EmailField id="signin_email" defaultValue={state.email} />
    <PasswordField id="signin_password" label="パスワード" autoComplete="current-password" />
    <Feedback state={state} />
    <button disabled={pending} className="app-primary w-full">{pending ? "確認中…" : "ログイン"}</button>
    <button type="button" onClick={onForgot} className="w-full text-center text-sm font-semibold text-brand-blue-dark underline-offset-4 hover:underline">パスワードを忘れた方</button>
  </form>;
}

function SignUp({ next }: { next: string }) {
  const [signedUp, signUp, signingUp] = useActionState(signUpWithPassword, {} as AuthFormState);
  const [verified, verify, verifying] = useActionState(verifySignUpCode, {} as AuthFormState);
  if (signedUp.step !== "code") {
    return <form action={signUp} className="app-card space-y-4">
      <input type="hidden" name="next" value={next} />
      <EmailField id="signup_email" defaultValue={signedUp.email} />
      <PasswordField id="signup_password" label="パスワード（新しく決める）" autoComplete="new-password" />
      <Feedback state={signedUp} />
      <button disabled={signingUp} className="app-primary w-full">{signingUp ? "送信中…" : "確認コードを送る"}</button>
    </form>;
  }
  return <form action={verify} className="app-card space-y-4">
    <input type="hidden" name="next" value={next} />
    <input type="hidden" name="email" value={signedUp.email} />
    <Feedback state={verified.error ? verified : signedUp} />
    <CodeField />
    <button disabled={verifying} className="app-primary w-full">{verifying ? "確認中…" : "登録を完了する"}</button>
  </form>;
}

function Reset({ next }: { next: string }) {
  const [sent, send, sending] = useActionState(sendPasswordResetCode, {} as AuthFormState);
  const [reset, submit, submitting] = useActionState(resetPassword, {} as AuthFormState);
  if (sent.step !== "code") {
    return <form action={send} className="app-card space-y-4">
      <p className="text-sm leading-relaxed text-ink-soft">登録したメールアドレスに確認コードを送ります。コードを入力して、新しいパスワードを決めてください。</p>
      <EmailField id="reset_email" defaultValue={sent.email} />
      <Feedback state={sent} />
      <button disabled={sending} className="app-primary w-full">{sending ? "送信中…" : "確認コードを送る"}</button>
    </form>;
  }
  return <form action={submit} className="app-card space-y-4">
    <input type="hidden" name="next" value={next} />
    <input type="hidden" name="email" value={sent.email} />
    <Feedback state={reset.error ? reset : sent} />
    <CodeField />
    <PasswordField id="reset_password" label="新しいパスワード" autoComplete="new-password" />
    <button disabled={submitting} className="app-primary w-full">{submitting ? "変更中…" : "パスワードを変更してログイン"}</button>
  </form>;
}
