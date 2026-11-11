import { updateSite } from "@/app/sites/actions";
import { SiteForm } from "@/components/sites/SiteForm";
import { createClient } from "@/lib/supabase/server";
import type { CenterOption, PrimeContractorOption, Site } from "@/types/site";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditSitePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: primeContractors }, { data: centers }] = await Promise.all([
    supabase
      .from("sites")
      .select("id, code, name, address, prime_contractor_id, slip_site_number, center_id, allow_partial_lot_default, created_at, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("prime_contractors")
      .select("id, name, slip_number")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("centers").select("id, code, name").order("code", { ascending: true }),
  ]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link href="/sites" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }
  if (!data) notFound();

  const site = data as Site;
  const updateAction = updateSite.bind(null, id);
  return (
    <div className="min-h-full bg-zinc-50">
      <SiteForm
        action={updateAction}
        site={site}
        error={queryError ? decodeURIComponent(queryError) : undefined}
        title="現場を編集"
        submitLabel="更新"
        primeContractors={(primeContractors ?? []) as PrimeContractorOption[]}
        centers={(centers ?? []) as CenterOption[]}
      />
      <div className="mx-auto w-full max-w-lg px-6 pb-10">
        <Link href={`/sites/${id}/products`} className="inline-block text-sm text-zinc-600 hover:text-zinc-900">
          この現場の予定数量を編集する
        </Link>
      </div>
    </div>
  );
}
