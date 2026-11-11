"use client";

import { SiteMultiSelect } from "@/components/users/SiteMultiSelect";
import type { CenterOptionForUser, SiteOptionForUser } from "@/types/user-management";
import Link from "next/link";
import { useState } from "react";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  sites: SiteOptionForUser[];
  centers: CenterOptionForUser[];
  error?: string;
};

export function RegisterUserForm({ action, sites, centers, error }: Props) {
  const [role, setRole] = useState("vendor");
  const [displayName, setDisplayName] = useState("");

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link href="/users" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← ユーザー一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        アカウントを発行
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        現場用アカウントに、利用できる現場を1つ以上割り当てます。
        利用者へ招待メールを送信します。
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-zinc-700"
          >
            メールアドレス <span className="text-red-600">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="招待するメールアドレス"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-zinc-700">
            役割 <span className="text-red-600">*</span>
          </span>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="admin"
                required
                checked={role === "admin"}
                onChange={(event) => setRole(event.target.value)}
                className="text-zinc-900"
              />
              admin(事務)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="center"
                required
                checked={role === "center"}
                onChange={(event) => setRole(event.target.value)}
              />
              center(地域センター)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="role"
                value="vendor"
                required
                checked={role === "vendor"}
                onChange={(event) => setRole(event.target.value)}
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
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
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
          <div className="mt-1"><SiteMultiSelect sites={sites} /></div>
          <p className="mt-2 text-xs text-zinc-500">
            選択肢にない場合は、先に
            <Link href="/sites/new" className="mx-1 underline hover:text-zinc-800">
              現場を追加
            </Link>
            してください。
          </p>
        </div>}

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
            placeholder={role === "vendor" ? "現場名が自動で入ります" : "任意"}
          />
          {role === "vendor" && (
            <p className="mt-1 text-xs text-zinc-500">
              未入力の場合は、最初に選んだ現場名を表示名にします。
            </p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-zinc-700">
            発行方法 <span className="text-red-600">*</span>
          </span>
          <div className="mt-2 flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="issue_method"
                value="invite"
                defaultChecked
                required
              />
              招待メールを送る
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" name="issue_method" value="link" required />
              招待リンクを発行する（メールが使えない場合）
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            アカウントを発行
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
