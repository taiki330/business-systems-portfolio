import { updateProduct } from "@/app/products/actions";
import { ProductForm } from "@/components/products/ProductForm";
import { fetchProductCategoryOptions } from "@/lib/products/fetch-categories";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/types/product";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, code, name, unit, category_id, lot_size, weight_kg, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">読み込みエラー: {error.message}</p>
        <Link href="/products" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!data) notFound();

  const product = data as Product;
  const categories = await fetchProductCategoryOptions(product.category_id);
  const updateAction = updateProduct.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <ProductForm
        action={updateAction}
        product={product}
        categories={categories}
        error={queryError ? decodeURIComponent(queryError) : undefined}
        title="商品を編集"
        submitLabel="更新"
      />
    </div>
  );
}
