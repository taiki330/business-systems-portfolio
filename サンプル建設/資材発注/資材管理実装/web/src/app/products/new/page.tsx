import { createProduct } from "@/app/products/actions";
import { ProductForm } from "@/components/products/ProductForm";
import { fetchProductCategoryOptions } from "@/lib/products/fetch-categories";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewProductPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const categories = await fetchProductCategoryOptions();

  return (
    <div className="min-h-full bg-zinc-50">
      <ProductForm
        action={createProduct}
        categories={categories}
        error={error ? decodeURIComponent(error) : undefined}
        title="商品を新規追加"
        submitLabel="登録"
      />
    </div>
  );
}
