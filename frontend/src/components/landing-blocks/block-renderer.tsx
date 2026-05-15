/**
 * Диспетчер блоков: по `type+variant` рендерит соответствующий компонент.
 * Для неизвестных типов рисует placeholder (важно для hot-reload новых блок-типов).
 */

import { HeroSplit } from "./hero/hero-split";
import { FeaturesStrip } from "./features/features-strip";
import { BenefitsCards } from "./benefits/benefits-cards";
import { StatsStrip } from "./stats/stats-strip";
import { TariffsLive } from "./tariffs/tariffs-live";
import { DevicesStrip } from "./devices/devices-strip";
import { FaqAccordion } from "./faq/faq-accordion";
import { CtaBanner } from "./cta/cta-banner";
import { CustomJourney } from "./custom/journey";
import { CustomFooter } from "./custom/footer";
import { LogosStrip } from "./logos/logos-strip";
import { TestimonialsCards } from "./testimonials/testimonials-cards";
import { VideoEmbed } from "./video/video-embed";
import { Spacer } from "./spacer/spacer";
import type { LandingApiBlock } from "./types";

interface BlockRendererProps {
  block: LandingApiBlock;
  serviceName: string;
}

export function BlockRenderer({ block, serviceName }: BlockRendererProps) {
  const key = `${block.type}/${block.variant}`;

  switch (block.type) {
    case "hero":
      return <HeroSplit block={block} serviceName={serviceName} />;
    case "features":
      return <FeaturesStrip block={block} />;
    case "benefits":
      return <BenefitsCards block={block} />;
    case "stats":
      return <StatsStrip block={block} />;
    case "tariffs":
      return <TariffsLive block={block} />;
    case "devices":
      return <DevicesStrip block={block} />;
    case "faq":
      return <FaqAccordion block={block} />;
    case "cta":
      return <CtaBanner block={block} />;
    case "logos":
      return <LogosStrip block={block} />;
    case "testimonials":
      return <TestimonialsCards block={block} />;
    case "video":
      return <VideoEmbed block={block} />;
    case "spacer":
      return <Spacer block={block} />;
    case "custom":
      if (block.variant === "journey") return <CustomJourney block={block} />;
      if (block.variant === "footer") return <CustomFooter block={block} serviceName={serviceName} />;
      return <UnknownBlock block={block} />;
    default:
      return <UnknownBlock block={block} />;
  }

  // unused, but keeps TS happy if cases are missing
  void key;
}

function UnknownBlock({ block }: { block: LandingApiBlock }) {
  if (import.meta.env.PROD) return null;
  return (
    <section className="container mx-auto px-4 py-6">
      <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/40 p-6 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-100">
        <strong>Unknown block:</strong> {block.type}/{block.variant} (id={block.id}). Нет рендерера в block-renderer.tsx.
      </div>
    </section>
  );
}
