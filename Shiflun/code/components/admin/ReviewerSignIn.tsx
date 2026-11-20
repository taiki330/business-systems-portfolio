"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFormState, MfaState, signInReviewer, startReviewerMfaEnrollment, verifyReviewerMfa } from "@/lib/actions/auth";

type Props = { step: "password" | "mfa"; hasFactor: boolean };

/** 審査担当のログイン：パスワード → 認証アプリのコード（はじめての時は認証アプリの登録から）。 */
export function ReviewerSignIn({ step, hasFactor }: Props) {
  const router = useRouter();
  const [signedIn, signIn, signingIn] = useActionState(async (prev: AuthFormState, form: FormData) => {
    const result = await signInReviewer(prev, form);
    if (result.step === "done") router.refresh();
    return result;
  }, {});
  if (step === "password") {
    return <form action={signIn} className="app-card space-y-4">
      <div><label htmlFor="reviewer_email" className="app-label">メールアドレス</label><input id="reviewer_email" name="email" type="email" autoComplete="email" required defaultValue={signedIn.email} className="app-input" /></div>
      <div><label htmlFor="reviewer_password" className="app-label">パスワード</label><input id="reviewer_password" name="password" type="password" autoComplete="current-password" required className="app-input" /></div>
      {signedIn.error && <p role="alert" className="app-error">{signedIn.error}</p>}
      <button disabled={signingIn} className="app-primary w-full">{signingIn ? "確認中…" : "次へ"}</button>
    </form>;
  }
  return <MfaStep hasFactor={hasFactor} />;
}

function MfaStep({ hasFactor }: { hasFactor: boolean }) {
  const [enroll, setEnroll] = useState<MfaState["enroll"]>();
  const [enrollError, setEnrollError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [state, verify, verifying] = useActionState(verifyReviewerMfa, {} as MfaState);

  if (!hasFactor && !enroll) {
    return <div className="app-card space-y-4">
      <p className="text-sm leading-relaxed text-ink-soft">身分証の審査には2段階認証が必要です。スマートフォンの認証アプリ（Google Authenticator、Microsoft Authenticator など）を登録してください。</p>
      {enrollError && <p role="alert" className="app-error">{enrollError}</p>}
      <button type="button" disabled={starting} className="app-primary w-full" onClick={async () => {
        setStarting(true);
        const result = await startReviewerMfaEnrollment();
        setStarting(false);
        if (result.error) setEnrollError(result.error); else setEnroll(result.enroll);
      }}>{starting ? "準備中…" : "認証アプリを登録する"}</button>
    </div>;
  }

  return <form action={verify} className="app-card space-y-4">
    {enroll && <>
      <input type="hidden" name="factor_id" value={enroll.factorId} />
      <p className="text-sm leading-relaxed text-ink-soft">認証アプリでこのQRコードを読み取り、表示された6桁の数字を入力してください。</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enroll.qrCode} alt="認証アプリ登録用のQRコード" className="mx-auto size-48 rounded-xl border border-line bg-white p-2" />
      <p className="break-all text-center text-xs text-ink-soft">読み取れない場合は、このキーを手入力してください：<span className="font-mono font-semibold text-ink-soft">{enroll.secret}</span></p>
    </>}
    {!enroll && <p className="text-sm leading-relaxed text-ink-soft">認証アプリに表示されている6桁の数字を入力してください。</p>}
    <div><label htmlFor="reviewer_code" className="app-label">認証コード</label><input id="reviewer_code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus className="app-input text-center text-2xl tracking-[0.4em] tabular-nums" /></div>
    {state.error && <p role="alert" className="app-error">{state.error}</p>}
    <button disabled={verifying} className="app-primary w-full">{verifying ? "確認中…" : "審査画面へ"}</button>
  </form>;
}
