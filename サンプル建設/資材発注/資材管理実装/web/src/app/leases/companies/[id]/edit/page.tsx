import { updateLeaseCompany } from "@/app/leases/companies/actions";
import { LeaseCompanyForm } from "@/components/leases/LeaseCompanyForm";
import { createClient } from "@/lib/supabase/server";
import type { LeaseCompany } from "@/types/lease-company";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditLeaseCompanyPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lease_companies")
    .select("id, name, note, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link
          href="/leases/companies"
          className="mt-4 inline-block text-sm text-zinc-600"
        >
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  const leaseCompany = data as LeaseCompany;
  const updateAction = updateLeaseCompany.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <LeaseCompanyForm
        action={updateAction}
        leaseCompany={leaseCompany}
        error={queryError ? decodeURIComponent(queryError) : undefined}
        title="リース会社を編集"
        submitLabel="更新"
      />
    </div>
  );
}
