import Link from "next/link";
import { ButtonHTMLAttributes } from "react";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: string;
  variant?: "primary" | "secondary";
};

/** 幅いっぱいのボタン。見た目は globals.css の .app-primary / .app-secondary。 */
export function PrimaryButton({ href, variant = "primary", className = "", type, children, ...props }: PrimaryButtonProps) {
  const classes = `${variant === "primary" ? "app-primary" : "app-secondary"} w-full ${className}`;
  if (href) return <Link href={href} className={classes}>{children}</Link>;
  return <button type={type ?? "button"} className={classes} {...props}>{children}</button>;
}
