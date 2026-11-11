import type { LeaseCompany } from "@/types/lease-company";
import Link from "next/link";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  leaseCompany?: LeaseCompany;
  error?: string;
  title: string;
  submitLabel: string;
};

export function LeaseCompanyForm({
  action,
  leaseCompany,
  error,
  title,
  submitLabel,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-lg px-6 py-10">
      <Link
        href="/leases/companies"
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← リース会社一覧
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">{title}</h1>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={action} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-zinc-700"
          >
            リース会社名 <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={leaseCompany?.name ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="note"
            className="block text-sm font-medium text-zinc-700"
          >
            備考
          </label>
          <input
            id="note"
            name="note"
            type="text"
            defaultValue={leaseCompany?.note ?? ""}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            placeholder="任意"
          />
        </div>

        <div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="is_active"
              value="1"
              defaultChecked={leaseCompany?.is_active ?? true}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
            />
            有効（新規の借用登録で選択できる）
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            無効にしても、登録済みの借用データは残ります。
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            {submitLabel}
          </button>
          <Link
            href="/leases/companies"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </div>
  );
}
