import { createSupplier } from "@/app/purchases/suppliers/actions";
import { SupplierForm } from "@/components/purchases/SupplierForm";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewSupplierPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  return (
    <div className="min-h-full bg-zinc-50">
      <SupplierForm
        action={createSupplier}
        error={error ? decodeURIComponent(error) : undefined}
        title="仕入先を新規追加"
        submitLabel="登録"
      />
    </div>
  );
}
