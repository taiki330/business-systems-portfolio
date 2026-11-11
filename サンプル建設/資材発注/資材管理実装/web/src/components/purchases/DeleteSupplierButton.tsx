"use client";

import { deleteSupplier } from "@/app/purchases/suppliers/actions";

type Props = {
  id: string;
  name: string;
};

export function DeleteSupplierButton({ id, name }: Props) {
  return (
    <form
      action={deleteSupplier.bind(null, id)}
      onSubmit={(e) => {
        if (
          !confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)
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
