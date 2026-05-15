import { TourMascot } from "./tour-mascot";
import { TourMascotNeko } from "./tour-mascot-neko";
import { TourMascotBusiness } from "./tour-mascot-business";
import { TourMascotGeek } from "./tour-mascot-geek";
import type { MascotMood } from "./tour-mascot";
import type React from "react";

export const MASCOT_REGISTRY: Record<string, { component: React.ComponentType<{ mood: MascotMood; className?: string }>; label: string; emoji: string }> = {
  "girl-1": { component: TourMascot, label: "Техно-тян", emoji: "🎧" },
  "girl-2": { component: TourMascotNeko, label: "Нэко-тян", emoji: "🐱" },
  "girl-3": { component: TourMascotBusiness, label: "Бизнес-тян", emoji: "👓" },
  "boy-1": { component: TourMascotGeek, label: "Гик-кун", emoji: "💻" },
};

export type MascotId = keyof typeof MASCOT_REGISTRY;
export type { MascotMood } from "./tour-mascot";