import type { ComponentProps } from "react";

export function Input(props: ComponentProps<"input">) {
  return <input className="rounded border border-border px-3 py-2" {...props} />;
}
