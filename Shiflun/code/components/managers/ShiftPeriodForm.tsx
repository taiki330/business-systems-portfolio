"use client";

import { useActionState } from "react";
import { createShiftPeriod, ShiftPeriodActionState } from "@/lib/actions/shift-periods";
import { FormField } from "@/components/ui/FormField";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

const initialState: ShiftPeriodActionState = {};

export function ShiftPeriodForm() {
  const [state, formAction, isPending] = useActionState(
    createShiftPeriod,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {state.error}
        </div>
      )}

      <FormField
        label="シフト名"
        htmlFor="title"
        required
        hint="例: 2024年7月シフト、7月前半シフト"
      >
        <input
          id="title"
          name="title"
          type="text"
          required
          placeholder="例: 2024年7月シフト"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="開始日" htmlFor="start_date" required>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </FormField>

        <FormField label="終了日" htmlFor="end_date" required>
          <input
            id="end_date"
            name="end_date"
            type="date"
            required
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </FormField>
      </div>

      <FormField
        label="希望締切日"
        htmlFor="submission_deadline"
        hint="バイトが希望を出す期限（任意）"
      >
        <input
          id="submission_deadline"
          name="submission_deadline"
          type="date"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </FormField>

      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "作成中..." : "シフト期間を作成する"}
      </PrimaryButton>
    </form>
  );
}
