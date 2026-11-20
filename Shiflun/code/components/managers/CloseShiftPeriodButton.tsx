"use client";

import { useActionState } from "react";
import { closeShiftPeriod, ShiftPeriodActionState } from "@/lib/actions/shift-periods";

const initialState: ShiftPeriodActionState = {};

type CloseShiftPeriodButtonProps = {
  periodId: string;
};

export function CloseShiftPeriodButton({ periodId }: CloseShiftPeriodButtonProps) {
  const [state, formAction, isPending] = useActionState(
    closeShiftPeriod,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="period_id" value={periodId} />
      {state.error && (
        <p className="mb-1 text-xs text-rose-600">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-60"
      >
        {isPending ? "処理中..." : "希望締切にする"}
      </button>
    </form>
  );
}
