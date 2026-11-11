"use client";

import { SiteMultiSelect } from "@/components/users/SiteMultiSelect";
import type {
  AppUserListRow,
  CenterOptionForUser,
  SiteOptionForUser,
} from "@/types/user-management";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  user: AppUserListRow;
  sites: SiteOptionForUser[];
  centers: CenterOptionForUser[];
  isSelf: boolean;
  error?: string;
};

export function EditUserForm({
  action,
  user,
  sites,
  centers,
  isSelf,
  error,
}: Props) {
  const [role, setRole] = useState<string>(
    user.role === "internal" ? "admin" : user.role,
  );
  const [displayName, setDisplayName] = useState(user.display_name ?? "");

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/users" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← ユーザー一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        ユーザーを編集
      </h1>
      <p className="mt-2 text-sm text-zinc-500">{user.email ?? "-"}</p>

      {isSelf && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          ご自身のアカウントです。役割・現場の変更はできません（表示名のみ編集可能）。
          変更が必要な場合は、他の事務アカウントに依頼してください。
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="display_name"
            className="block text-sm font-medium text-zinc-700"
          >
            表示名
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-zinc-700">役割</span>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="admin"
                checked={role === "admin"}
                onChange={(event) => setRole(event.target.value)}
                disabled={isSelf}
                className="text-zinc-900"
              />
              admin(事務)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="center"
                checked={role === "center"}
                onChange={(event) => setRole(event.target.value)}
                disabled={isSelf}
              />
              center(地域センター)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="vendor"
                checked={role === "vendor"}
                onChange={(event) => setRole(event.target.value)}
                disabled={isSelf}
              />
              現場
            </label>
          </div>
        </div>

        {role === "center" && <div>
          <label
            htmlFor="center_id"
            className="block text-sm font-medium text-zinc-700"
          >
            担当地域 <span className="text-red-600">*</span>
          </label>
          <select
            id="center_id"
            name="center_id"
            required
            defaultValue={user.center_id ?? ""}
            disabled={isSelf}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:bg-zinc-100"
          >
            <option value="" disabled>
              選択してください
            </option>
            {centers.map((center) => (
              <option key={center.id} value={center.id}>
                {center.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-zinc-500">
            このアカウントは、選択した地域のセンター在庫・現場在庫だけを参照できます。
          </p>
        </div>}

        {role === "vendor" && <div>
          <label
            className="block text-sm font-medium text-zinc-700"
          >
            現場 <span className="text-red-600">*</span>
          </label>
          <div className="mt-1">
            <SiteMultiSelect
              sites={sites}
              defaultValues={user.site_ids?.length ? user.site_ids : (user.site_id ? [user.site_id] : [])}
              disabled={isSelf}
            />
          </div>
        </div>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            更新
          </button>
          <Link
            href="/users"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
