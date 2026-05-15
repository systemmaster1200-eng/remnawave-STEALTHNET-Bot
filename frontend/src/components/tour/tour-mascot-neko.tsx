import { motion, AnimatePresence } from "framer-motion";
import type { MascotMood } from "./tour-mascot";

interface TourMascotProps {
  mood: MascotMood;
  className?: string;
}

export function TourMascotNeko({ mood, className }: TourMascotProps) {
  return (
    <div className={`relative w-[120px] h-[160px] flex items-end justify-center overflow-hidden ${className || ""}`}>
      {/* Animated Cat Tail (Behind body) */}
      <motion.div
        className="absolute top-[100px] left-[10px] w-12 h-16 origin-bottom-right z-0"
        initial={{ rotate: 0 }}
        animate={{ rotate: [-5, 10, -5] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg viewBox="0 0 50 60" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M40 50 Q10 50 20 20 Q25 5 10 10" stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round" fill="none" />
        </svg>
      </motion.div>

      {/* Base character SVG */}
      <svg
        viewBox="0 0 120 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-md relative z-10"
      >
        <defs>
          <linearGradient id="hairGradientNeko" x1="60" y1="10" x2="60" y2="120" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE0D0" />
            <stop offset="1" stopColor="#FFC8B4" />
          </linearGradient>
          <linearGradient id="skinGradientNeko" x1="60" y1="40" x2="60" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE0D0" />
            <stop offset="1" stopColor="#FFC8B4" />
          </linearGradient>
          <clipPath id="faceClipNeko">
            <path d="M35 50 C35 50 30 90 60 100 C90 90 85 50 85 50 Z" />
          </clipPath>
        </defs>

        {/* Back Hair */}
        <path d="M20 50 C10 80 15 120 25 140 C25 140 40 130 45 110 L75 110 C80 130 95 140 95 140 C105 120 110 80 100 50 Z" fill="#E6D5B8" />

        {/* Cat Ears */}
        {/* Left Ear */}
        <path d="M30 45 L15 15 L50 30 Z" fill="hsl(var(--primary))" />
        <path d="M30 40 L20 20 L45 30 Z" fill="#FFE0D0" />
        
        {/* Right Ear */}
        <path d="M90 45 L105 15 L70 30 Z" fill="hsl(var(--primary))" />
        <path d="M90 40 L100 20 L75 30 Z" fill="#FFE0D0" />

        {/* Body/Clothes */}
        <path d="M30 110 C30 110 20 120 15 160 L105 160 C100 120 90 110 90 110 L30 110 Z" fill="#ffffff" />
        <path d="M45 110 L75 110 L60 130 Z" fill="#f0f0f0" />
        
        {/* Collar/Ribbon (Cat bell) */}
        <path d="M50 125 Q60 135 70 125 L65 115 L55 115 Z" fill="hsl(var(--primary))" />
        <circle cx="60" cy="130" r="5" fill="#FFD700" />
        <path d="M57 130 L63 130 M60 130 L60 135" stroke="#B8860B" strokeWidth="1" />

        {/* Neck */}
        <rect x="52" y="90" width="16" height="25" fill="#FFC8B4" />

        {/* Face Base */}
        <path d="M35 50 C35 50 30 90 60 100 C90 90 85 50 85 50 Z" fill="url(#skinGradientNeko)" />

        {/* Blush */}
        <ellipse cx="42" cy="75" rx="5" ry="3" fill="#FF8A8A" opacity="0.4" />
        <ellipse cx="78" cy="75" rx="5" ry="3" fill="#FF8A8A" opacity="0.4" />

        {/* Dynamic Expressions based on mood */}
        <g clipPath="url(#faceClipNeko)">
          {/* Eyes */}
          {mood === "happy" ? (
            <>
              {/* Happy closed eyes ^ ^ */}
              <path d="M40 65 Q45 55 50 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M70 65 Q75 55 80 65" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
            </>
          ) : mood === "think" ? (
            <>
              {/* Thinking eyes - one open, one half closed */}
              <ellipse cx="45" cy="62" rx="4" ry="5" fill="#333" />
              <path d="M70 62 Q75 58 80 62" stroke="#333" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M38 52 L50 55" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M70 55 L82 52" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              {/* Normal big eyes - cat like (vertical pupil) */}
              <ellipse cx="45" cy="62" rx="5" ry="7" fill="#333" />
              <ellipse cx="75" cy="62" rx="5" ry="7" fill="#333" />
              {/* Vertical pupils/highlights */}
              <ellipse cx="45" cy="62" rx="2" ry="5" fill="hsl(var(--primary))" opacity="0.8" />
              <ellipse cx="75" cy="62" rx="2" ry="5" fill="hsl(var(--primary))" opacity="0.8" />
              <circle cx="43" cy="58" r="1.5" fill="white" />
              <circle cx="73" cy="58" r="1.5" fill="white" />
              {/* Eyebrows */}
              <path d="M40 52 Q45 50 50 52" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M70 52 Q75 50 80 52" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </>
          )}

          {/* Mouth - Cat-like */}
          {mood === "happy" ? (
            <path d="M55 82 Q60 88 65 82" stroke="#333" strokeWidth="1.5" fill="#FF8A8A" strokeLinecap="round" strokeLinejoin="round" />
          ) : mood === "think" ? (
            <path d="M55 82 Q57 80 60 82 Q63 84 65 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          ) : (
            /* W mouth */
            <path d="M55 82 Q57 85 60 82 Q63 85 65 82" stroke="#333" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          )}

          {/* Cat Whiskers */}
          <path d="M35 70 L25 65 M35 75 L25 75 M35 80 L25 85" stroke="#333" strokeWidth="1" opacity="0.3" strokeLinecap="round" />
          <path d="M85 70 L95 65 M85 75 L95 75 M85 80 L95 85" stroke="#333" strokeWidth="1" opacity="0.3" strokeLinecap="round" />
        </g>

        {/* Front Hair/Bangs */}
        <path d="M30 50 C30 50 45 40 60 40 C75 40 90 50 90 50 C90 50 85 20 60 20 C35 20 30 50 30 50 Z" fill="#E6D5B8" />
        <path d="M30 50 Q45 65 55 50" fill="#E6D5B8" />
        <path d="M50 50 Q60 65 70 50" fill="#E6D5B8" />
        <path d="M65 50 Q75 65 90 50" fill="#E6D5B8" />
        {/* Side hair pieces */}
        <path d="M30 50 Q25 70 35 90 Q32 70 35 50 Z" fill="#E6D5B8" />
        <path d="M90 50 Q95 70 85 90 Q88 70 85 50 Z" fill="#E6D5B8" />
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
              {/* Cat paws pads */}
              <circle cx="15" cy="22" r="4" fill="#FF8A8A" opacity="0.6" />
              <circle cx="11" cy="16" r="2" fill="#FF8A8A" opacity="0.6" />
              <circle cx="16" cy="15" r="2" fill="#FF8A8A" opacity="0.6" />
              <circle cx="21" cy="16" r="2" fill="#FF8A8A" opacity="0.6" />
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
              <path d="M48 20 L25 20 L25 40 L48 40 Z" fill="#ffffff" />
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