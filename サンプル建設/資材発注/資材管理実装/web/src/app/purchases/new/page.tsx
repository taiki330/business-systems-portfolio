import { registerPurchase } from "@/app/purchases/actions";
import { PurchaseForm } from "@/components/purchases/PurchaseForm";
import { fetchProductOptions } from "@/lib/products/fetch-options";
import { fetchSupplierOptions } from "@/lib/purchases/fetch-suppliers";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

/** 今日（JST）の日付を yyyy-mm-dd で返す。 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 仕入れ登録フォーム（事務のみ）。 */
export default async function NewPurchasePage({ searchParams }: PageProps) {
  const { error: queryError } = await searchParams;
  const supabase = await createClient();

  const [products, suppliers, stockResult] = await Promise.all([
    fetchProductOptions(),
    fetchSupplierOptions(),
    supabase
      .from("stock_items")
      .select("product_id, quantity")
      .eq("location", "center"),
  ]);

  const centerStock: Record<string, number> = {};
  for (const r of (stockResult.data ?? []) as {
    product_id: string;
    quantity: number;
  }[]) {
    centerStock[r.product_id] = Number(r.quantity);
  }

  return (
    <div className="min-h-full bg-zinc-50">
      <PurchaseForm
        action={registerPurchase}
        products={products}
        suppliers={suppliers}
        centerStock={centerStock}
        today={todayJst()}
        error={queryError ? decodeURIComponent(queryError) : undefined}
      />
    </div>
  );
}
