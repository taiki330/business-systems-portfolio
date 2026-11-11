"use client";

import { deleteSiteProductPlan } from "@/app/plans/actions";

type Props = {
  id: string;
  label: string;
};

export function DeleteSiteProductPlanButton({ id, label }: Props) {
  return (
    <form
      action={deleteSiteProductPlan.bind(null, id)}
      onSubmit={(e) => {
        if (
          !confirm(`「${label}」の予定数量を削除しますか？\nこの操作は取り消せません。`)
        ) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-sm text-red-600 hover:text-red-800">
        削除
      </button>
    </form>
  );
}
