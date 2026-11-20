"use client";

import { useActionState, useMemo } from "react";
import {
  AvailabilityActionState,
  createAvailabilitySlot,
} from "@/lib/actions/availability";
import {
  FormField,
  inputClassName,
} from "@/components/ui/FormField";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { getNextAvailabilityDateOptions } from "@/lib/utils/availability";

type AvailabilityFormProps = {
  workerId: string;
};

const initialState: AvailabilityActionState = {};

export function AvailabilityForm({ workerId }: AvailabilityFormProps) {
  const dateOptions = useMemo(() => getNextAvailabilityDateOptions(14), []);
  const [state, formAction, isPending] = useActionState(
    createAvailabilitySlot,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="worker_id" value={workerId} />

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {state.error}
        </div>
      )}

      {state.success && (
        <div
          role="status"
          className="rounded-xl border border-brand-blue bg-brand-blue-light px-4 py-3 text-sm text-brand-blue"
        >
          {state.createdCount && state.createdCount > 1
            ? `${state.createdCount}件の勤務希望を登録しました。店長の確認をお待ちください。`
            : "勤務希望を登録しました。店長の確認をお待ちください。"}
        </div>
      )}

      <FormField
        label="勤務希望日"
        htmlFor="work_dates"
        required
        hint="今後14日分から、同じ時間帯で働きたい日を選べます。"
      >
        <fieldset className="flex flex-col gap-3" disabled={isPending}>
          <legend className="sr-only">勤務希望日</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {dateOptions.map((option) => (
              <label
                key={option.value}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors has-checked:border-brand-blue has-checked:bg-brand-blue-light has-checked:text-brand-blue has-disabled:cursor-not-allowed has-disabled:opacity-60"
              >
                <input
                  id={`work_date_${option.value}`}
                  type="checkbox"
                  name="work_dates"
                  value={option.value}
                  className="h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="開始時間" htmlFor="start_time" required>
          <input
            id="start_time"
            name="start_time"
            type="time"
            className={inputClassName}
            disabled={isPending}
          />
        </FormField>

        <FormField label="終了時間" htmlFor="end_time" required>
          <input
            id="end_time"
            name="end_time"
            type="time"
            className={inputClassName}
            disabled={isPending}
          />
        </FormField>
      </div>

      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "登録中..." : "勤務希望を登録"}
      </PrimaryButton>
    </form>
  );
}
