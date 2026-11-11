import { updateSupplier } from "@/app/purchases/suppliers/actions";
import { SupplierForm } from "@/components/purchases/SupplierForm";
import { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/types/purchase";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditSupplierPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, note, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link
          href="/purchases/suppliers"
          className="mt-4 inline-block text-sm text-zinc-600"
        >
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  const supplier = data as Supplier;
  const updateAction = updateSupplier.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <SupplierForm
        action={updateAction}
        supplier={supplier}
        error={queryError ? decodeURIComponent(queryError) : undefined}
        title="仕入先を編集"
        submitLabel="更新"
      />
    </div>
  );
}
