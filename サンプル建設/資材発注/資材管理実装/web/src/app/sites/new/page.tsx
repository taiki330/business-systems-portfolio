import { createSite } from "@/app/sites/actions";
import { SiteForm } from "@/components/sites/SiteForm";
import { createClient } from "@/lib/supabase/server";
import type { CenterOption, PrimeContractorOption } from "@/types/site";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewSitePage({ searchParams }: PageProps) {
  const [{ error }, supabase] = await Promise.all([searchParams, createClient()]);
  const [{ data: primeContractors }, { data: centers }] = await Promise.all([
    supabase
      .from("prime_contractors")
      .select("id, name, slip_number")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("centers").select("id, code, name").order("code", { ascending: true }),
  ]);

  return (
    <div className="min-h-full bg-zinc-50">
      <SiteForm
        action={createSite}
        error={error ? decodeURIComponent(error) : undefined}
        title="現場を追加"
        submitLabel="登録"
        primeContractors={(primeContractors ?? []) as PrimeContractorOption[]}
        centers={(centers ?? []) as CenterOption[]}
      />
    </div>
  );
}
