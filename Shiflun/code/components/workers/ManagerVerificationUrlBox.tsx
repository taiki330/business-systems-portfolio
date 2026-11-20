"use client";

import { useState } from "react";

type ManagerVerificationUrlBoxProps = {
  verifyUrl: string;
};

export function ManagerVerificationUrlBox({
  verifyUrl,
}: ManagerVerificationUrlBoxProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-xl border-2 border-brand-yellow bg-brand-yellow-light p-5">
      <h2 className="text-base font-bold text-amber-950">
        店長認証URL
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-brand-yellow-dark">
        勤務先の店長に、このURLを送って認証してもらってください。
        認証されると「店長認証済み」バッジが付きます。
      </p>

      <div className="mt-4 rounded-xl border border-brand-yellow bg-white p-3">
        <p className="break-all font-mono text-xs leading-relaxed text-ink">
          {verifyUrl}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
        >
          {copied ? "コピーしました" : "URLをコピー"}
        </button>
        <p className="sr-only" aria-live="polite">
          {copied ? "店長認証URLをコピーしました" : ""}
        </p>
      </div>
    </section>
  );
}
