/**
 * Spacer — пустой блок-разделитель. Размер выбирается через variant: xs/sm/md/lg/xl.
 */

import type { LandingApiBlock } from "../types";

const SIZE_CLASS: Record<string, string> = {
  "xs": "h-4 md:h-6",
  "sm": "h-8 md:h-12",
  "md": "h-16 md:h-24",
  "lg": "h-24 md:h-40",
  "xl": "h-40 md:h-60",
};

export function Spacer({ block }: { block: LandingApiBlock }) {
  const cls = SIZE_CLASS[block.variant] ?? SIZE_CLASS.md;
  return <div className={cls} aria-hidden="true" />;
}
