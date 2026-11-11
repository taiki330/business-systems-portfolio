"use client";

import { deleteVendor } from "@/app/vendors/actions";

type Props = {
  id: string;
  name: string;
};

export function DeleteVendorButton({ id, name }: Props) {
  return (
    <form
      action={deleteVendor.bind(null, id)}
      onSubmit={(e) => {
        if (
          !confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="text-sm text-red-600 hover:text-red-800"
      >
        削除
      </button>
    </form>
  );
}
