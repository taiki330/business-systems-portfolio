import { redirect } from "next/navigation";

export default function NewStockPage() {
  redirect(
    `/stock?error=${encodeURIComponent("直接の在庫登録は廃止しました。仕入れ登録、棚卸、または在庫調整申請を利用してください。")}`,
  );
}
