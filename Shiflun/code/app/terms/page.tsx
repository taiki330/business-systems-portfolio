import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
export const dynamic = "force-static";
export const metadata: Metadata = { title: "利用規約 | シフルン" };
export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
