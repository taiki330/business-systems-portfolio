"use client";

import { useState } from "react";

type ManagerShiftsUrlBoxProps = {
  shiftsUrl: string;
};

export function ManagerShiftsUrlBox({ shiftsUrl }: ManagerShiftsUrlBoxProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shiftsUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-xl border border-brand-yellow bg-brand-yellow-light p-4">
      <h3 className="text-sm font-bold text-amber-950">店長用：勤務希望確認URL</h3>
      <p className="mt-2 text-xs leading-relaxed text-brand-yellow-dark">
        勤務先の店長に送って、シフト採用または他店への開放を判断してもらってください。
      </p>
      <div className="mt-3 rounded-xl border border-brand-yellow bg-white p-3">
        <p className="break-all font-mono text-xs leading-relaxed text-ink">
          {shiftsUrl}
        </p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-3 w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
      >
        {copied ? "コピーしました" : "URLをコピー"}
      </button>
    </section>
  );
}
