import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
export const dynamic = "force-static";
export const metadata: Metadata = { title: "プライバシーポリシー | シフルン" };
export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
