"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

/**
 * 送信中は自動的に disabled になる submit ボタン。
 *
 * コードレビュー指摘（Critical #8）対応: operation_id によるサーバー側の冪等性に加え、
 * UI 側でも送信中の二重押下を防止する。react-dom の useFormStatus は
 * 親 <form> の pending 状態を購読するため、本コンポーネントは必ず
 * action を持つ <form> の内側に置くこと。
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || rest.disabled}
      aria-disabled={pending || rest.disabled}
      className={className}
    >
      {pending ? (pendingLabel ?? "処理中...") : children}
    </button>
  );
}
