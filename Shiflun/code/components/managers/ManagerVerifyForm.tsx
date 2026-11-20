"use client";

import { useActionState } from "react";
import {
  createManagerVerification,
  CreateManagerVerificationState,
} from "@/lib/actions/verifications";
import { ManagerVerificationDetails } from "@/components/managers/ManagerVerificationDetails";
import {
  FormField,
  inputClassName,
  textareaClassName,
} from "@/components/ui/FormField";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

type ManagerVerifyFormProps = {
  workerId: string;
};

const initialState: CreateManagerVerificationState = {};

export function ManagerVerifyForm({ workerId }: ManagerVerifyFormProps) {
  const [state, formAction, isPending] = useActionState(
    createManagerVerification,
    initialState,
  );

  if (state.success && state.verification) {
    return (
      <section className="rounded-xl border border-brand-blue bg-brand-blue-light p-5">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue-light text-2xl text-brand-blue">
            ✓
          </div>
          <h2 className="mt-4 text-lg font-bold text-emerald-950">
            認証が完了しました
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-brand-blue">
            バイトのプロフィールに「店長認証済み」バッジが表示されます。
          </p>
        </div>
        <div className="mt-5 rounded-xl border border-brand-blue bg-white p-4">
          <ManagerVerificationDetails verification={state.verification} />
        </div>
      </section>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="worker_id" value={workerId} />

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {state.error}
        </div>
      )}

      <FormField label="店長名" htmlFor="manager_name" required>
        <input
          id="manager_name"
          name="manager_name"
          type="text"
          placeholder="例：山田 太郎"
          className={inputClassName}
          autoComplete="name"
          disabled={isPending}
        />
      </FormField>

      <FormField
        label="店長コメント"
        htmlFor="manager_comment"
        required
        hint="このバイトの勤務実績や人物についてコメントしてください"
      >
        <textarea
          id="manager_comment"
          name="manager_comment"
          rows={4}
          placeholder="例：ホール対応が丁寧で、忙しい時間帯も安定して働いています。"
          className={textareaClassName}
          disabled={isPending}
        />
      </FormField>

      <PrimaryButton
        type="submit"
        disabled={isPending}
        className="mt-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800"
      >
        {isPending ? "認証中..." : "このバイトを認証する"}
      </PrimaryButton>
    </form>
  );
}
