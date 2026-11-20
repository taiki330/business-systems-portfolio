import { ChatReportReason, ContactCategory } from "@/lib/types/database";

/** チャットの通報理由（migration 023 の chat_reports.reason と同じ値）。 */
export const CHAT_REPORT_REASONS: { value: ChatReportReason; label: string }[] = [
  { value: "harassment", label: "嫌がらせ・暴言" },
  { value: "inappropriate", label: "不適切な内容（性的・差別的など）" },
  { value: "spam", label: "迷惑な勧誘・スパム" },
  { value: "fraud", label: "なりすまし・詐欺の疑い" },
  { value: "other", label: "その他" },
];

/** お問い合わせの種類（migration 023 の contact_inquiries.category と同じ値）。 */
export const CONTACT_CATEGORIES: { value: ContactCategory; label: string }[] = [
  { value: "account", label: "ログイン・アカウントについて" },
  { value: "deletion", label: "退会・データの削除を依頼したい" },
  { value: "report", label: "迷惑行為・規約違反を報告したい" },
  { value: "bug", label: "不具合の報告" },
  { value: "other", label: "その他" },
];
