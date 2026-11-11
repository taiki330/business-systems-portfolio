import { updateVendor } from "@/app/vendors/actions";
import { VendorForm } from "@/components/vendors/VendorForm";
import { createClient } from "@/lib/supabase/server";
import type { Vendor } from "@/types/vendor";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditVendorPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, note, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link href="/vendors" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  const vendor = data as Vendor;
  const updateAction = updateVendor.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <VendorForm
        action={updateAction}
        vendor={vendor}
        error={queryError ? decodeURIComponent(queryError) : undefined}
        title="業者を編集"
        submitLabel="更新"
      />
      <div className="mx-auto w-full max-w-lg px-6 pb-10">
        <Link
          href={`/vendors/${id}/sites`}
          className="inline-block text-sm text-zinc-600 hover:text-zinc-900"
        >
          → この業者の現場紐づけを編集する
        </Link>
      </div>
    </div>
  );
}
