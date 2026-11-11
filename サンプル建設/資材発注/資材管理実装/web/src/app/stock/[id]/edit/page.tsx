import { redirect } from "next/navigation";

export default function EditStockPage() {
  redirect(
    `/stock?error=${encodeURIComponent("直接の在庫補正は廃止しました。棚卸または在庫調整申請の承認で反映してください。")}`,
  );
}
