import { AccountRequired } from "@/components/ui/AccountRequired";

export function WorkerSetupPrompt() {
  return <AccountRequired role="worker" />;
}
