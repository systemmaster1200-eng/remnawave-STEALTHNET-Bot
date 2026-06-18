import type { HTMLAttributes } from "react";

type MotionOnlyProps = {
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  transition?: unknown;
  variants?: unknown;
  custom?: unknown;
  whileHover?: unknown;
  whileTap?: unknown;
  layout?: unknown;
};

function stripMotionProps<T extends HTMLElement>({
  initial: _initial,
  animate: _animate,
  exit: _exit,
  transition: _transition,
  variants: _variants,
  custom: _custom,
  whileHover: _whileHover,
  whileTap: _whileTap,
  layout: _layout,
  ...props
}: HTMLAttributes<T> & MotionOnlyProps) {
  return props;
}

export const motion = {
  div: (props: HTMLAttributes<HTMLDivElement> & MotionOnlyProps) => <div {...stripMotionProps<HTMLDivElement>(props)} />,
  li: (props: HTMLAttributes<HTMLLIElement> & MotionOnlyProps) => <li {...stripMotionProps<HTMLLIElement>(props)} />,
  p: (props: HTMLAttributes<HTMLParagraphElement> & MotionOnlyProps) => <p {...stripMotionProps<HTMLParagraphElement>(props)} />,
  section: (props: HTMLAttributes<HTMLElement> & MotionOnlyProps) => <section {...stripMotionProps<HTMLElement>(props)} />,
  span: (props: HTMLAttributes<HTMLSpanElement> & MotionOnlyProps) => <span {...stripMotionProps<HTMLSpanElement>(props)} />,
  tr: (props: HTMLAttributes<HTMLTableRowElement> & MotionOnlyProps) => <tr {...stripMotionProps<HTMLTableRowElement>(props)} />,
};
