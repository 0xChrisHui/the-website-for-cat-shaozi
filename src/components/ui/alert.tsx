import type { ComponentProps } from "react";

export function Alert(props: ComponentProps<"div">) {
  return <div role="alert" className="rounded border border-border p-3" {...props} />;
}
