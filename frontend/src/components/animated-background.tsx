import { useEffect, useRef } from "react";
import { useTheme, ACCENT_PALETTES } from "@/contexts/theme";
import { useLocation } from "react-router-dom";

interface OrbConfig {
  x: number;
  y: number;
  r: number;
  dx: number;
  dy: number;
  dur: number;
}

const ORBS: OrbConfig[] = [
  { x: 0.15, y: 0.20, r: 320, dx: 80,  dy: 60,  dur: 18 },
  { x: 0.80, y: 0.10, r: 280, dx: -70, dy: 80,  dur: 22 },
  { x: 0.60, y: 0.70, r: 350, dx: -90, dy: -70, dur: 26 },
  { x: 0.10, y: 0.80, r: 260, dx: 60,  dy: -80, dur: 20 },
  { x: 0.90, y: 0.55, r: 300, dx: -60, dy: 70,  dur: 24 },
  { x: 0.45, y: 0.40, r: 240, dx: 70,  dy: -60, dur: 30 },
];

const LOW_POWER_ORBS = ORBS.slice(0, 3).map((orb) => ({
  ...orb,
  r: Math.round(orb.r * 0.75),
  dx: Math.round(orb.dx * 0.55),
  dy: Math.round(orb.dy * 0.55),
  dur: Math.round(orb.dur * 1.4),
}));

function isGuestPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/admin/login" ||
    pathname === "/cabinet" ||
    pathname === "/cabinet/login" ||
    pathname === "/cabinet/register" ||
    pathname.startsWith("/cabinet/verify") ||
    pathname.startsWith("/gift/")
  );
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 100, g: 100, b: 255 };
}

export function AnimatedBackground({ variant = "fixed", intensity = "normal" }: { variant?: "fixed" | "absolute", intensity?: "normal" | "weak" }) {
  const { config, resolvedMode } = useTheme();
  const location = useLocation();
  if (location.pathname === "/admin" && variant === "fixed") return null;
  const lowPower = variant === "fixed" && isGuestPath(location.pathname);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const lastDrawRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const activeOrbs = lowPower ? LOW_POWER_ORBS : ORBS;
    const minFrameMs = lowPower ? 1000 / 18 : 1000 / 60;

    const resize = () => {
      if (variant === "fixed") {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      } else {
        const rect = canvas.parentElement?.getBoundingClientRect();
        if (rect) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    // Определяем базовые цвета в зависимости от темы
    const palette = ACCENT_PALETTES[config.accent] || ACCENT_PALETTES.default;
    const baseHex = palette.swatch !== "#1e293b" ? palette.swatch : "#6366f1"; // фоллбэк на индиго для дефолтной
    const rgb = hexToRgb(baseHex);
    
    const isDark = resolvedMode === "dark";
    const bgColor = variant === "fixed" ? (isDark ? "#0a0a10" : "#f8fafc") : "transparent";
    
    // В светлой теме цвета более пастельные и прозрачные
    const orbColors = activeOrbs.map((_, i) => {
      // Немного варьируем цвета орбов вокруг базового акцента
      const r = Math.min(255, Math.max(0, rgb.r + (i % 3 === 0 ? 30 : -20)));
      const g = Math.min(255, Math.max(0, rgb.g + (i % 2 === 0 ? 20 : -30)));
      const b = Math.min(255, Math.max(0, rgb.b + (i % 4 === 0 ? 40 : -10)));
      
      const alphaCenter = isDark ? "0.5" : "0.3";
      const alphaEdge = "0.0";
      
      return {
        center: `rgba(${r}, ${g}, ${b}, ${alphaCenter})`,
        edge: `rgba(${r}, ${g}, ${b}, ${alphaEdge})`
      };
    });

    const draw = (ts: number) => {
      if (document.hidden) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }
      if (ts - lastDrawRef.current < minFrameMs) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDrawRef.current = ts;

      if (!startRef.current) startRef.current = ts;
      const t = reducedMotion ? 0 : (ts - startRef.current) / 1000;
      const W = canvas.width;
      const H = canvas.height;

      // Масштаб относительно экрана: на десктопе (1440px) = 1, на мобилке (~400px) ≈ 0.55
      const scale = Math.max(0.45, Math.min(W, H) / 1000);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < activeOrbs.length; i++) {
        const o = activeOrbs[i];
        const colors = orbColors[i];
        
        const phase = (t / o.dur) * Math.PI * 2;
        const scaledDx = o.dx * scale;
        const scaledDy = o.dy * scale;
        const scaledR = o.r * scale;
        const cx = (o.x * W) + Math.sin(phase) * scaledDx;
        const cy = (o.y * H) + Math.cos(phase * 0.7) * scaledDy;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scaledR);
        grad.addColorStop(0, colors.center);
        grad.addColorStop(1, colors.edge);

        ctx.beginPath();
        ctx.arc(cx, cy, scaledR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [config.accent, resolvedMode, lowPower, variant]);

  return (
    <div className={`${variant === "fixed" ? "fixed" : "absolute"} inset-0 ${variant === "fixed" ? "-z-50" : "z-0"} overflow-hidden ${intensity === "weak" ? "opacity-30" : ""}`} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {/* Слой размытия (эффект матового стекла поверх фонарей) */}
      <div className="absolute inset-0 backdrop-blur-[100px] bg-background/20 pointer-events-none" />
    </div>
  );
}
