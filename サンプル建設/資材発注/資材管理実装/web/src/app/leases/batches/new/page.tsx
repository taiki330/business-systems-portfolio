import { createLeaseBatch } from "@/app/leases/batches/actions";
import { LeaseBatchForm } from "@/components/leases/LeaseBatchForm";
import { fetchLeaseCompanyOptions } from "@/lib/leases/fetch-company-options";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewLeaseBatchPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  const [leaseCompanies, sites, products] = await Promise.all([
    fetchLeaseCompanyOptions(),
    fetchSiteOptions(),
    fetchProductOptions(),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-full bg-zinc-50">
      <LeaseBatchForm
        action={createLeaseBatch}
        leaseCompanies={leaseCompanies}
        sites={sites}
        products={products}
        error={error ? decodeURIComponent(error) : undefined}
        today={today}
      />
    </div>
  );
}
