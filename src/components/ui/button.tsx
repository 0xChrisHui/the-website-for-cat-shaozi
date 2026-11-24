import type { ComponentProps } from "react";

export function Button(props: ComponentProps<"button">) {
  return <button className="rounded bg-primary px-4 py-2 text-primary-foreground" {...props} />;
}
