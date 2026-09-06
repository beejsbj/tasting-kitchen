import type { ButtonHTMLAttributes } from "react";
// Primitive: tone controls emphasis; focus/disabled/pressed share one token contract.
export function KitchenButton({ tone = "quiet", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "quiet" | "primary" }) {
  return <button type="button" className={`kitchen-button kitchen-button--${tone} ${className}`} {...props} />;
}
