import { AppHeader } from "@/components/layout/AppHeader";
import { StoreSettingsForm } from "@/components/companies/StoreSettingsForm";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { DeleteAccountSection } from "@/components/account/DeleteAccountSection";

export const dynamic = "force-dynamic";
export default function StoreSettingsPage() {
  return <div className="app-page"><AppHeader title="店舗・時給設定" description="お店の条件を整えて、ぴったりの人へスカウト。" backHref="/managers/more" backLabel="その他" /><main className="space-y-6"><StoreSettingsForm /><SignOutButton className="text-center" /><DeleteAccountSection /></main><LegalLinks className="mt-8" /></div>;
}
