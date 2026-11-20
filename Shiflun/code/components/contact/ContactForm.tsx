"use client";

import { useActionState } from "react";
import { ContactState, submitContactInquiry } from "@/lib/actions/contact";
import { CONTACT_CATEGORIES } from "@/lib/constants/safety";
import { ContactCategory } from "@/lib/types/database";

/** お問い合わせフォーム。ログイン中は、ログインに使っているメールアドレスへ返信する。 */
export function ContactForm({ signedInEmail, defaultCategory }: { signedInEmail: string | null; defaultCategory?: ContactCategory }) {
  const [state, action, pending] = useActionState(submitContactInquiry, {} as ContactState);
  if (state.success) {
    return <section role="status" className="app-card space-y-2 text-center">
      <h2 className="text-lg font-bold text-ink">お問い合わせを受け付けました</h2>
      <p className="text-sm leading-relaxed text-ink-soft">内容を確認し、{signedInEmail ?? "入力いただいたメールアドレス"}宛てにメールで返信します。</p>
    </section>;
  }
  return <form action={action} className="app-card space-y-5">
    <div><label htmlFor="contact_category" className="app-label">お問い合わせの種類</label><select id="contact_category" name="category" required defaultValue={defaultCategory ?? ""} className="app-input"><option value="" disabled>選んでください</option>{CONTACT_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></div>
    {signedInEmail
      ? <div><p className="app-label">返信先</p><p className="rounded-xl bg-paper p-3 text-sm text-ink-soft [overflow-wrap:anywhere]">{signedInEmail}</p></div>
      : <div><label htmlFor="contact_email" className="app-label">返信先のメールアドレス</label><input id="contact_email" name="email" type="email" autoComplete="email" required maxLength={254} className="app-input" /><p className="mt-2 text-xs text-ink-soft">アカウントについてのお問い合わせは、登録に使ったメールアドレスを入力してください。</p></div>}
    <div><label htmlFor="contact_body" className="app-label">お問い合わせの内容</label><textarea id="contact_body" name="body" required rows={6} maxLength={2000} className="app-input" /></div>
    {/* 自動投稿の対策。人には見えず、キーボード操作でも入らない。 */}
    <div aria-hidden="true" className="hidden"><label>このままにしてください<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    <button disabled={pending} className="app-primary w-full">{pending ? "送信中…" : "送信する"}</button>
  </form>;
}
