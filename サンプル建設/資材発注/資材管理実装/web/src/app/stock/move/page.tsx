import { redirect } from "next/navigation";

export default function StockMovePage() {
  redirect(
    `/stock?error=${encodeURIComponent("理由なしの直接入出庫は廃止しました。業務ごとの登録画面を利用してください。")}`,
  );
}
