import { motion, AnimatePresence } from "framer-motion";
import type { MascotMood } from "./tour-mascot";

interface TourMascotProps {
  mood: MascotMood;
  className?: string;
}

export function TourMascotGeek({ mood, className }: TourMascotProps) {
  return (
    <div className={`relative w-[120px] h-[160px] flex items-end justify-center overflow-hidden ${className || ""}`}>
      {/* Base character SVG */}
      <svg
        viewBox="0 0 120 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-md relative z-10"
      >
        <defs>
          <linearGradient id="skinGradientGeek" x1="60" y1="40" x2="60" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE0D0" />
            <stop offset="1" stopColor="#FFC8B4" />
          </linearGradient>
          <clipPath id="faceClipGeek">
            <path d="M35 50 C35 50 35 95 60 100 C85 95 85 50 85 50 Z" />
          </clipPath>
        </defs>

        {/* Back of Hoodie */}
        <path d="M20 50 C10 80 15 120 25 140 L95 140 C105 120 110 80 100 50 Z" fill="hsl(var(--primary))" />

        {/* Back Hair */}
        <path d="M25 50 C20 60 25 70 30 80 C30 80 40 90 45 70 C45 70 60 70 75 70 C80 90 90 80 90 80 C95 70 100 60 95 50 Z" fill="#2E2E2E" />

        {/* Body/Clothes (Hoodie Front) */}
        <path d="M30 110 C30 110 20 120 15 160 L105 160 C100 120 90 110 90 110 L30 110 Z" fill="hsl(var(--primary))" />
        
        {/* Inner Shirt */}
        <path d="M45 110 L75 110 L60 125 Z" fill="#333333" />
        
        {/* Hoodie Strings */}
        <path d="M45 115 L45 145" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        <path d="M75 115 L75 145" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        
        {/* Neck */}
        <rect x="52" y="90" width="16" height="25" fill="#FFC8B4" />

        {/* Face Base */}
        <path d="M35 50 C35 50 35 95 60 100 C85 95 85 50 85 50 Z" fill="url(#skinGradientGeek)" />

        {/* Blush (Lighter for boy) */}
        <ellipse cx="42" cy="75" rx="5" ry="3" fill="#FF8A8A" opacity="0.2" />
        <ellipse cx="78" cy="75" rx="5" ry="3" fill="#FF8A8A" opacity="0.2" />

        {/* Dynamic Expressions based on mood */}
        <g clipPath="url(#faceClipGeek)">
          {/* Eyes */}
          {mood === "happy" ? (
            <>
              <path d="M40 65 Q45 58 50 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M70 65 Q75 58 80 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          ) : mood === "think" ? (
            <>
              <ellipse cx="45" cy="62" rx="3.5" ry="4" fill="#333" />
              <path d="M70 62 Q75 58 80 62" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M38 52 L50 54" stroke="#333" strokeWidth="2" strokeLinecap="round" />
              <path d="M70 54 L82 52" stroke="#333" strokeWidth="2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx="45" cy="62" rx="3.5" ry="4" fill="#333" />
              <ellipse cx="75" cy="62" rx="3.5" ry="4" fill="#333" />
              <circle cx="44" cy="60" r="1" fill="white" />
              <circle cx="74" cy="60" r="1" fill="white" />
              <path d="M40 53 Q45 52 50 53" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M70 53 Q75 52 80 53" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          )}

          {/* Mouth */}
          {mood === "happy" ? (
            <path d="M55 82 Q60 88 65 82" stroke="#333" strokeWidth="1.5" fill="#FF8A8A" strokeLinecap="round" />
          ) : mood === "think" ? (
            <path d="M57 82 Q60 84 63 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          ) : (
            <path d="M55 82 Q60 84 65 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          )}
        </g>

        {/* Front Hair/Bangs - Messy */}
        <path d="M25 50 C25 50 30 35 60 35 C90 35 95 50 95 50 C95 50 85 20 60 20 C35 20 25 50 25 50 Z" fill="#2E2E2E" />
        <path d="M25 50 L35 65 L45 50 L55 68 L65 50 L75 65 L85 50 L95 50 Z" fill="#2E2E2E" />
        
        {/* Cowlick / Ahoge */}
        <path d="M60 20 Q50 5 55 10 Q50 15 60 20 Z" fill="#2E2E2E" />
      </svg>

      {/* Dynamic Arms/Hands */}
      <AnimatePresence mode="wait">
        {mood === "wave" && (
          <motion.div
            key="wave"
            initial={{ opacity: 0, rotate: -20, x: -10, y: 10 }}
            animate={{ opacity: 1, rotate: [0, -15, 0, -15, 0], x: 0, y: 0 }}
            exit={{ opacity: 0, rotate: -20, x: -10, y: 10 }}
            transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1 }}
            className="absolute top-[80px] left-[10px] w-8 h-8 z-20"
          >
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 32 C10 32 10 20 16 15 C22 10 28 15 28 22 C28 28 22 32 16 32 Z" fill="#FFE0D0" />
              <path d="M16 15 L12 8 Q10 5 14 6 L18 12" stroke="#FFC8B4" strokeWidth="3" strokeLinecap="round" />
              <path d="M18 13 L18 6 Q18 3 22 5 L22 12" stroke="#FFC8B4" strokeWidth="3" strokeLinecap="round" />
              <path d="M21 14 L24 8 Q27 5 28 9 L25 15" stroke="#FFC8B4" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </motion.div>
        )}
        
        {mood === "point" && (
          <motion.div
            key="point"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, x: [0, 5, 0] }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 1, repeat: Infinity }}
            className="absolute top-[90px] left-[0px] w-12 h-10 transform -rotate-12 z-20"
          >
            <svg viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M48 20 L25 20 L25 40 L48 40 Z" fill="hsl(var(--primary))" />
              <path d="M25 25 C15 25 15 35 25 35 Z" fill="#FFE0D0" />
              <path d="M20 28 L5 28 C2 28 2 32 5 32 L20 32 Z" fill="#FFE0D0" />
            </svg>
          </motion.div>
        )}

        {mood === "think" && (
          <motion.div
            key="think"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: [0, -5, 0] }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute top-[85px] left-[35px] w-8 h-8 z-20"
          >
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="8" fill="#FFE0D0" />
              <path d="M10 16 L14 8 C16 4 20 6 18 10 L16 16" fill="#FFE0D0" />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}