import { createLeaseCompany } from "@/app/leases/companies/actions";
import { LeaseCompanyForm } from "@/components/leases/LeaseCompanyForm";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewLeaseCompanyPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  return (
    <div className="min-h-full bg-zinc-50">
      <LeaseCompanyForm
        action={createLeaseCompany}
        error={error ? decodeURIComponent(error) : undefined}
        title="リース会社を新規追加"
        submitLabel="登録"
      />
    </div>
  );
}
