import { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span className="ml-1.5 text-xs font-medium text-rose-600">必須</span>
        )}
      </label>
      {hint && <p className="text-xs leading-relaxed text-ink-soft">{hint}</p>}
      {children}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

export const inputClassName =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-soft focus:border-brand-blue focus:ring-2 focus:ring-brand-blue-light";

export const selectClassName =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-base text-ink outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue-light";

export const textareaClassName =
  "w-full resize-none rounded-lg border border-line bg-white px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-soft focus:border-brand-blue focus:ring-2 focus:ring-brand-blue-light";
