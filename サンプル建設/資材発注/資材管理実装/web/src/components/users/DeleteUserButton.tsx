"use client";

import { deleteAppUser } from "@/app/users/actions";

type Props = {
  id: string;
  email: string | null;
};

export function DeleteUserButton({ id, email }: Props) {
  const label = email ?? "このアカウント";
  return (
    <form
      action={deleteAppUser.bind(null, id)}
      onSubmit={(event) => {
        if (!confirm(`${label} を削除しますか？\nログインできなくなり、現場との紐付けも解除されます。`)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-sm font-medium text-red-700 hover:text-red-900">
        削除
      </button>
    </form>
  );
}
