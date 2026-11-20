"use client";

import { useActionState, useEffect, useState } from "react";
import {
  getIdentityVerification,
  submitIdentityVerification,
  SubmitIdentityVerificationState,
} from "@/lib/actions/identity-verification";
import { useWorkerId } from "@/lib/hooks/use-worker-id";
import { LoadingMascot } from "@/components/ui/LoadingMascot";
import { WorkerSetupPrompt } from "@/components/workers/WorkerSetupPrompt";
import { IdentityVerification } from "@/lib/types/database";

const STATUS_LABEL: Record<string, { label: string; style: string }> = {
  unverified: { label: "未提出", style: "bg-chip text-ink-soft" },
  pending: { label: "審査中", style: "bg-brand-yellow-light text-brand-yellow-dark" },
  verified: { label: "確認済み", style: "bg-brand-blue-light text-brand-blue" },
  rejected: { label: "差し戻し", style: "bg-rose-100 text-rose-700" },
};

const DOCUMENT_TYPE_OPTIONS = [
  { value: "license", label: "運転免許証" },
  { value: "my_number_card", label: "マイナンバーカード" },
  { value: "passport", label: "パスポート" },
  { value: "residence_card", label: "在留カード" },
];

const initialState: SubmitIdentityVerificationState = {};

export function IdentityVerificationClient() {
  const { workerId, ready } = useWorkerId();
  const [verification, setVerification] = useState<IdentityVerification | null | undefined>(undefined);
  const [state, formAction, pending] = useActionState(submitIdentityVerification, initialState);

  useEffect(() => {
    if (!workerId) return;
    getIdentityVerification().then(({ verification }) => setVerification(verification));
  }, [workerId, state.success]);

  if (!ready) return null;

  if (!workerId) {
    return <WorkerSetupPrompt />;
  }

  if (verification === undefined) {
    return <LoadingMascot />;
  }

  const status = verification?.status ?? "unverified";
  const badge = STATUS_LABEL[status];
  const canSubmit = status === "unverified" || status === "rejected";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-line bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-ink">本人確認ステータス</p>
          <p className="mt-1 text-xs text-ink-soft">
            現在は運営スタッフによる目視確認です（本番のeKYC連携は今後導入予定）。
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${badge.style}`}>{badge.label}</span>
      </div>

      {status === "rejected" && verification?.reject_reason && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          差し戻し理由: {verification.reject_reason}
        </p>
      )}

      {canSubmit && (
        <form action={formAction} className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
          <input type="hidden" name="worker_id" value={workerId} />

          {state.error && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
              {state.error}
            </p>
          )}

          <div>
            <label htmlFor="full_name_kana" className="mb-1.5 block text-sm font-semibold text-ink-soft">
              氏名（カナ）
            </label>
            <input
              id="full_name_kana"
              name="full_name_kana"
              required
              placeholder="ヤマダ タロウ"
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="birth_date" className="mb-1.5 block text-sm font-semibold text-ink-soft">
              生年月日
            </label>
            <input
              id="birth_date"
              name="birth_date"
              type="date"
              required
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="document_type" className="mb-1.5 block text-sm font-semibold text-ink-soft">
              身分証の種類
            </label>
            <select
              id="document_type"
              name="document_type"
              required
              defaultValue=""
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none"
            >
              <option value="" disabled>選択してください</option>
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="document" className="mb-1.5 block text-sm font-semibold text-ink-soft">
              身分証の画像
            </label>
            <input
              id="document"
              name="document"
              type="file"
              accept="image/*"
              required
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-blue-light file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-blue"
            />
            <p className="mt-1 text-xs text-ink-soft">8MB以内の画像。運営スタッフのみが確認します。</p>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="app-primary"
          >
            {pending ? "送信中…" : "提出する"}
          </button>
        </form>
      )}

      {state.success && !canSubmit && (
        <p className="rounded-xl border border-brand-blue bg-brand-blue-light px-4 py-3 text-sm text-brand-blue">
          提出しました。運営スタッフの確認をお待ちください。
        </p>
      )}
    </div>
  );
}
