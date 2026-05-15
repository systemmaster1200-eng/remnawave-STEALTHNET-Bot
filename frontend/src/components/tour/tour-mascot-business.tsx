import { motion, AnimatePresence } from "framer-motion";
import type { MascotMood } from "./tour-mascot";

interface TourMascotProps {
  mood: MascotMood;
  className?: string;
}

export function TourMascotBusiness({ mood, className }: TourMascotProps) {
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
          <linearGradient id="skinGradientBus" x1="60" y1="40" x2="60" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE0D0" />
            <stop offset="1" stopColor="#FFC8B4" />
          </linearGradient>
          <clipPath id="faceClipBus">
            <path d="M35 50 C35 50 30 90 60 100 C90 90 85 50 85 50 Z" />
          </clipPath>
        </defs>

        {/* Back Hair Bun */}
        <circle cx="25" cy="65" r="15" fill="#3B2F2F" />
        <circle cx="95" cy="65" r="15" fill="#3B2F2F" />
        
        {/* Back Hair */}
        <path d="M25 50 C15 70 20 100 30 120 C30 120 40 130 45 110 L75 110 C80 130 90 120 90 120 C100 100 105 70 95 50 Z" fill="#3B2F2F" />

        {/* Body/Clothes (Blazer) */}
        <path d="M30 110 C30 110 20 120 15 160 L105 160 C100 120 90 110 90 110 L30 110 Z" fill="#2C3E50" />
        <path d="M45 110 L75 110 L60 130 Z" fill="#ffffff" />
        
        {/* Tie/Scarf */}
        <path d="M55 125 L65 125 L60 145 Z" fill="hsl(var(--primary))" />
        {/* Blazer Lapels */}
        <path d="M45 110 L55 135 L40 160" stroke="#1A252F" strokeWidth="2" fill="none" />
        <path d="M75 110 L65 135 L80 160" stroke="#1A252F" strokeWidth="2" fill="none" />

        {/* Neck */}
        <rect x="52" y="90" width="16" height="25" fill="#FFC8B4" />

        {/* Face Base */}
        <path d="M35 50 C35 50 30 90 60 100 C90 90 85 50 85 50 Z" fill="url(#skinGradientBus)" />

        {/* Dynamic Expressions based on mood */}
        <g clipPath="url(#faceClipBus)">
          {/* Eyes */}
          {mood === "happy" ? (
            <>
              <path d="M40 65 Q45 55 50 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M70 65 Q75 55 80 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          ) : mood === "think" ? (
            <>
              <ellipse cx="45" cy="62" rx="4" ry="5" fill="#333" />
              <path d="M70 62 Q75 58 80 62" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M38 52 L50 55" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M70 55 L82 52" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx="45" cy="62" rx="4.5" ry="6" fill="#333" />
              <ellipse cx="75" cy="62" rx="4.5" ry="6" fill="#333" />
              <circle cx="43" cy="59" r="1.5" fill="white" />
              <circle cx="73" cy="59" r="1.5" fill="white" />
              <path d="M40 52 Q45 50 50 52" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M70 52 Q75 50 80 52" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </>
          )}

          {/* Mouth */}
          {mood === "happy" ? (
            <path d="M55 82 Q60 88 65 82" stroke="#333" strokeWidth="1.5" fill="#FF8A8A" strokeLinecap="round" />
          ) : mood === "think" ? (
            <path d="M57 82 Q60 84 63 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          ) : (
            <path d="M55 82 Q60 85 65 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          )}

          {/* Glasses */}
          {/* Left Lens */}
          <rect x="35" y="52" width="22" height="15" rx="3" fill="rgba(255,255,255,0.3)" stroke="hsl(var(--primary))" strokeWidth="2" />
          {/* Right Lens */}
          <rect x="63" y="52" width="22" height="15" rx="3" fill="rgba(255,255,255,0.3)" stroke="hsl(var(--primary))" strokeWidth="2" />
          {/* Bridge */}
          <path d="M57 58 L63 58" stroke="hsl(var(--primary))" strokeWidth="2" />
          {/* Arms */}
          <path d="M35 55 L30 55" stroke="hsl(var(--primary))" strokeWidth="2" />
          <path d="M85 55 L90 55" stroke="hsl(var(--primary))" strokeWidth="2" />
        </g>

        {/* Front Hair/Bangs - Neat and professional */}
        <path d="M30 50 C30 50 45 35 60 35 C75 35 90 50 90 50 C90 50 85 20 60 20 C35 20 30 50 30 50 Z" fill="#3B2F2F" />
        <path d="M60 35 Q40 45 30 65 L28 50 Z" fill="#3B2F2F" />
        <path d="M60 35 Q80 45 90 65 L92 50 Z" fill="#3B2F2F" />
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
              <path d="M48 20 L25 20 L25 40 L48 40 Z" fill="#2C3E50" />
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