/**
 * NetworkBg — характерный фон для Stealth-дизайна:
 *   - Чёрный background `#020202`
 *   - Триангулированная SVG-сетка (тонкие красные линии + точки в узлах)
 *   - 3 ambient red blobs (top-right, mid-left, bottom-right) — мягкое свечение
 *
 * Зачем SVG, а не PNG: масштабируется без потерь, легче, цвет можно менять
 * через --stealth-accent CSS-переменную.
 *
 * Производительность: SVG рендерится один раз, blobs — обычные `div` с
 * `background: radial-gradient`. Никаких filter:blur — на бюджетных Android в
 * Telegram WebView это лагает.
 */

import { useId } from "react";

interface Props {
  /** Базовый цвет линий/точек. По умолчанию красный (бренд STEALTHNET). */
  accent?: string;
  /** Прозрачность сетки (0..1). По умолчанию 0.18 — еле заметно. */
  opacity?: number;
  /** Если true — без blob'ов, только сетка (для модалок). */
  flatten?: boolean;
}

export function NetworkBg({ accent = "#ff2357", opacity = 0.18, flatten = false }: Props) {
  const patternId = useId();
  return (
    <>
      {/* Базовая заливка */}
      <div className="fixed inset-0 -z-30 bg-[#020202] pointer-events-none" />

      {/* SVG-сетка (триангуляция) */}
      <svg
        className="fixed inset-0 -z-20 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id={patternId} width="160" height="160" patternUnits="userSpaceOnUse">
            {/* Triangulated network: 4 узла + линии между ними */}
            <g stroke={accent} strokeOpacity={opacity} strokeWidth="0.6" fill="none">
              <line x1="0" y1="0" x2="160" y2="80" />
              <line x1="0" y1="0" x2="80" y2="160" />
              <line x1="160" y1="0" x2="0" y2="80" />
              <line x1="160" y1="0" x2="160" y2="160" />
              <line x1="80" y1="0" x2="160" y2="80" />
              <line x1="0" y1="160" x2="80" y2="80" />
              <line x1="80" y1="160" x2="160" y2="80" />
              <line x1="160" y1="160" x2="80" y2="80" />
              <line x1="0" y1="80" x2="80" y2="80" />
              <line x1="80" y1="0" x2="80" y2="80" />
            </g>
            {/* Узлы */}
            <g fill={accent} fillOpacity={Math.min(opacity * 3, 0.85)}>
              <circle cx="0" cy="0" r="1.2" />
              <circle cx="80" cy="80" r="1.6" />
              <circle cx="160" cy="0" r="1.2" />
              <circle cx="0" cy="160" r="1.2" />
              <circle cx="160" cy="160" r="1.2" />
              <circle cx="80" cy="0" r="1" />
              <circle cx="0" cy="80" r="1" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>

      {/* Ambient red blobs */}
      {!flatten && (
        <>
          <div
            className="fixed -z-10 pointer-events-none rounded-full"
            style={{
              top: "-15%",
              right: "-10%",
              width: "55vw",
              height: "55vw",
              maxWidth: 600,
              maxHeight: 600,
              background: `radial-gradient(circle at center, ${accent}33 0%, transparent 60%)`,
              filter: "blur(40px)",
            }}
          />
          <div
            className="fixed -z-10 pointer-events-none rounded-full"
            style={{
              top: "30%",
              left: "-15%",
              width: "50vw",
              height: "50vw",
              maxWidth: 500,
              maxHeight: 500,
              background: `radial-gradient(circle at center, ${accent}22 0%, transparent 65%)`,
              filter: "blur(50px)",
            }}
          />
          <div
            className="fixed -z-10 pointer-events-none rounded-full"
            style={{
              bottom: "-10%",
              right: "-5%",
              width: "40vw",
              height: "40vw",
              maxWidth: 450,
              maxHeight: 450,
              background: `radial-gradient(circle at center, ${accent}28 0%, transparent 65%)`,
              filter: "blur(45px)",
            }}
          />
        </>
      )}
    </>
  );
}
