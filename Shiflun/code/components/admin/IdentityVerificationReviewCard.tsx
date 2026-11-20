"use client";

import { useActionState } from "react";
import { PendingIdentityVerification, reviewIdentityVerification, ReviewIdentityVerificationState } from "@/lib/actions/identity-review";

const initialState: ReviewIdentityVerificationState = {};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  license: "運転免許証",
  my_number_card: "マイナンバーカード",
  passport: "パスポート",
  residence_card: "在留カード",
};

export function IdentityVerificationReviewCard({ verification }: { verification: PendingIdentityVerification }) {
  const { imageUrl } = verification;
  const [state, formAction, pending] = useActionState(reviewIdentityVerification, initialState);

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm font-bold text-ink">
        {verification.workers?.name ?? "（不明なワーカー）"}
        <span className="ml-2 text-xs font-normal text-ink-soft">{verification.workers?.current_store}</span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-ink-soft">
        <dt className="text-ink-soft">氏名（カナ）</dt>
        <dd>{verification.full_name_kana}</dd>
        <dt className="text-ink-soft">生年月日</dt>
        <dd>{verification.birth_date}</dd>
        <dt className="text-ink-soft">身分証の種類</dt>
        <dd>{verification.document_type ? DOCUMENT_TYPE_LABEL[verification.document_type] : "—"}</dd>
      </dl>

      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="提出された身分証" className="mt-3 max-h-64 w-full rounded-xl border border-line object-contain" />
      ) : (
        <p className="mt-3 text-xs text-rose-500">画像を読み込めませんでした。</p>
      )}

      {state.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}

      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="verification_id" value={verification.id} />
        <textarea
          name="reject_reason"
          placeholder="却下する場合は理由を入力"
          rows={2}
          className="resize-none rounded-lg border border-line px-3 py-2 text-xs focus:border-brand-blue focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            name="decision"
            value="verified"
            disabled={pending}
            className="app-primary min-h-9 px-3 py-1.5 text-xs flex-1"
          >
            確認済みにする
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            disabled={pending}
            className="flex-1 rounded-lg border border-rose-200 bg-white py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            差し戻す
          </button>
        </div>
      </form>
    </div>
  );
}
