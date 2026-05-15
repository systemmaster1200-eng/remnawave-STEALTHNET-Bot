/**
 * ConcentricRings — большая иконочная капля с тремя концентрическими красными
 * кольцами вокруг (как у Hundler VPN на каждом шаге wizard'а).
 *
 * Структура:
 *  - 3 ring-обводки (size: 100, 130, 160 px, цвет тающий — opacity 60%/30%/15%)
 *  - центральный чёрный круг 90px с bordered red glow
 *  - иконка 28px по центру (любая Lucide-иконка)
 *
 * Используется на wizard-шагах + где нужно «фокусировать внимание» на одном
 * крупном иконочном элементе.
 */

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  /** Размер центрального круга в px (внешние кольца масштабируются от него). */
  size?: number;
  /** Custom CSS color для всех колец и glow. По умолчанию rose-500. */
  accent?: string;
  className?: string;
}

export function ConcentricRings({ icon: Icon, size = 88, accent = "rgb(255 35 87)", className }: Props) {
  const r1 = size + 24;
  const r2 = size + 56;
  const r3 = size + 88;
  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: r3, height: r3, margin: "0 auto" }}>
      {/* Outer rings (тающие) */}
      <div className="absolute rounded-full border" style={{ width: r3, height: r3, borderColor: accent, opacity: 0.12 }} />
      <div className="absolute rounded-full border" style={{ width: r2, height: r2, borderColor: accent, opacity: 0.22 }} />
      <div className="absolute rounded-full border" style={{ width: r1, height: r1, borderColor: accent, opacity: 0.4 }} />
      {/* Glow */}
      <div
        className="absolute rounded-full"
        style={{ width: size + 12, height: size + 12, background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`, filter: "blur(12px)" }}
      />
      {/* Central circle */}
      <div
        className="relative rounded-full bg-zinc-950 border flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderColor: `${accent}55`,
          boxShadow: `0 0 30px -8px ${accent}66, inset 0 0 24px ${accent}1a`,
        }}
      >
        <Icon className="h-7 w-7 text-white" strokeWidth={1.8} />
      </div>
    </div>
  );
}
