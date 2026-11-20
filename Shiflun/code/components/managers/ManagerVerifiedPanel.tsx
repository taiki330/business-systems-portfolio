import { ManagerVerificationDetails } from "@/components/managers/ManagerVerificationDetails";
import { ManagerVerification } from "@/lib/types/database";

type ManagerVerifiedPanelProps = {
  verification: ManagerVerification;
  title?: string;
  description?: string;
};

export function ManagerVerifiedPanel({
  verification,
  title = "このスタッフはすでに店長認証済みです",
  description,
}: ManagerVerifiedPanelProps) {
  return (
    <section className="rounded-xl border border-brand-blue bg-brand-blue-light p-5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue-light text-lg text-brand-blue"
          aria-hidden="true"
        >
          ✓
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-emerald-950">{title}</h2>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-brand-blue">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 rounded-xl border border-brand-blue bg-white p-4">
        <ManagerVerificationDetails verification={verification} />
      </div>
    </section>
  );
}
