import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" };

export function Button({ variant = "primary", ...props }: ButtonProps) {
  const style = variant === "primary"
    ? "bg-primary text-primary-foreground"
    : "border border-border bg-surface text-foreground hover:bg-muted";
  return <button className={`min-h-11 cursor-pointer rounded px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-70 ${style}`} {...props} />;
}
