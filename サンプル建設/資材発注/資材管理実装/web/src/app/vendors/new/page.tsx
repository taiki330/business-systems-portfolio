import { createVendor } from "@/app/vendors/actions";
import { VendorForm } from "@/components/vendors/VendorForm";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewVendorPage({ searchParams }: PageProps) {
  const { error } = await searchParams;

  return (
    <div className="min-h-full bg-zinc-50">
      <VendorForm
        action={createVendor}
        error={error ? decodeURIComponent(error) : undefined}
        title="業者を新規追加"
        submitLabel="登録"
      />
    </div>
  );
}
