/**
 * Migration: SystemSetting (landing_*) → LandingBlock + LandingTheme.
 *
 * Запускается автоматически при старте API один раз: если в `landing_blocks` 0 строк,
 * читает старые ключи из `system_settings` и создаёт стартовые блоки.
 * Идемпотентен: повторный запуск ничего не делает.
 *
 * Можно запустить вручную: `tsx src/scripts/migrate-landing-to-blocks.ts`.
 */

import { prisma } from "../db.js";
import { ensureTheme } from "../modules/landing/landing.service.js";

const ORDER_STEP = 10;

async function getSettingsMap(): Promise<Record<string, string>> {
  const all = await prisma.systemSetting.findMany();
  const out: Record<string, string> = {};
  for (const s of all) out[s.key] = s.value;
  return out;
}

function bool(v: string | undefined, dflt = true): boolean {
  if (v === undefined) return dflt;
  if (v === "false" || v === "0" || v === "") return false;
  return true;
}

function str(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t || undefined;
}

function safeJsonArray<T>(v: string | undefined): T[] | undefined {
  if (!v) return undefined;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const k in obj) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out as T;
}

export async function migrateLandingToBlocks(): Promise<{ migrated: boolean; reason?: string; created?: number }> {
  const existing = await prisma.landingBlock.count();
  if (existing > 0) return { migrated: false, reason: "blocks already exist" };

  const m = await getSettingsMap();
  await ensureTheme();

  let order = 0;
  const next = () => (order += ORDER_STEP);

  // ─── Hero ──────────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "hero",
      variant: "split",
      order: next(),
      visible: true,
      props: {
        ctaUrl: "/cabinet/register",
        secondaryCtaUrl: "/cabinet/login",
        showRightCard: true,
      },
      i18n: {
        ru: clean({
          badge: str(m.landing_hero_badge),
          headline1: str(m.landing_hero_headline_1),
          headline2: str(m.landing_hero_headline_2),
          title: str(m.landing_hero_title),
          subtitle: str(m.landing_hero_subtitle),
          hint: str(m.landing_hero_hint),
          ctaText: str(m.landing_hero_cta_text) ?? "Попробовать",
          secondaryCtaText: str(m.landing_button_login_cabinet),
          headerBadge: str(m.landing_header_badge),
          paymentText: str(m.landing_default_payment_text),
        }),
      },
    },
  });

  // ─── Features Strip ────────────────────────────────────────────────────────
  const featureItemsRu = [];
  for (let i = 1; i <= 5; i++) {
    const label = str(m[`landing_feature_${i}_label`]);
    const sub = str(m[`landing_feature_${i}_sub`]);
    if (label || sub) featureItemsRu.push(clean({ label, sub }));
  }
  await prisma.landingBlock.create({
    data: {
      type: "features",
      variant: "strip",
      order: next(),
      visible: bool(m.landing_show_features, true),
      props: {},
      i18n: {
        ru: clean({
          items: featureItemsRu.length > 0 ? featureItemsRu : undefined,
        }),
      },
    },
  });

  // ─── Benefits ──────────────────────────────────────────────────────────────
  const benefitItemsRu = [];
  for (let i = 1; i <= 6; i++) {
    const title = str(m[`landing_benefit_${i}_title`]);
    const desc = str(m[`landing_benefit_${i}_desc`]);
    if (title || desc) benefitItemsRu.push(clean({ title, desc }));
  }
  await prisma.landingBlock.create({
    data: {
      type: "benefits",
      variant: "cards-6",
      order: next(),
      visible: bool(m.landing_show_benefits, true),
      props: {},
      i18n: {
        ru: clean({
          title: str(m.landing_benefits_title),
          subtitle: str(m.landing_benefits_subtitle),
          badge: str(m.landing_benefits_badge),
          items: benefitItemsRu.length > 0 ? benefitItemsRu : undefined,
        }),
      },
    },
  });

  // ─── Stats ─────────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "stats",
      variant: "strip-3",
      order: next(),
      visible: true,
      props: {},
      i18n: {
        ru: clean({
          platforms: str(m.landing_stats_platforms),
          tariffsLabel: str(m.landing_stats_tariffs_label),
          accessLabel: str(m.landing_stats_access_label),
          paymentMethods: str(m.landing_stats_payment_methods),
        }),
      },
    },
  });

  // ─── Tariffs ───────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "tariffs",
      variant: "live",
      order: next(),
      visible: bool(m.landing_show_tariffs, true),
      props: {},
      i18n: {
        ru: clean({
          title: str(m.landing_tariffs_title),
          subtitle: str(m.landing_tariffs_subtitle),
          noTariffsMessage: str(m.landing_no_tariffs_message),
          buttonChooseTariff: str(m.landing_button_choose_tariff),
          tariffDefaultDesc: str(m.landing_tariff_default_desc),
          tariffBullets: clean({
            "1": str(m.landing_tariff_bullet_1),
            "2": str(m.landing_tariff_bullet_2),
            "3": str(m.landing_tariff_bullet_3),
          }),
          lowestTariffDesc: str(m.landing_lowest_tariff_desc),
        }),
      },
    },
  });

  // ─── Devices ───────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "devices",
      variant: "strip",
      order: next(),
      visible: bool(m.landing_show_devices, true),
      props: {
        items: safeJsonArray<{ name: string }>(m.landing_devices_list_json) ?? undefined,
      },
      i18n: {
        ru: clean({
          title: str(m.landing_devices_title),
          subtitle: str(m.landing_devices_subtitle),
          cockpitText: str(m.landing_devices_cockpit_text),
        }),
      },
    },
  });

  // ─── How it works (journey) ────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "custom",
      variant: "journey",
      order: next(),
      visible: bool(m.landing_show_how_it_works, true),
      props: {
        steps: safeJsonArray<{ title: string; desc: string }>(m.landing_journey_steps_json) ?? undefined,
      },
      i18n: {
        ru: clean({
          title: str(m.landing_how_it_works_title),
          desc: str(m.landing_how_it_works_desc),
        }),
      },
    },
  });

  // ─── FAQ ───────────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "faq",
      variant: "accordion",
      order: next(),
      visible: bool(m.landing_show_faq, true),
      props: {},
      i18n: {
        ru: clean({
          title: str(m.landing_faq_title),
          items: safeJsonArray<{ q: string; a: string }>(m.landing_faq_json) ?? undefined,
        }),
      },
    },
  });

  // ─── CTA ───────────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "cta",
      variant: "full-banner",
      order: next(),
      visible: bool(m.landing_show_cta, true),
      props: { ctaUrl: "/cabinet/register" },
      i18n: {
        ru: clean({
          eyebrow: str(m.landing_ready_to_connect_eyebrow),
          title: str(m.landing_ready_to_connect_title),
          desc: str(m.landing_ready_to_connect_desc),
          ctaText: str(m.landing_button_start),
        }),
      },
    },
  });

  // ─── Footer ────────────────────────────────────────────────────────────────
  await prisma.landingBlock.create({
    data: {
      type: "custom",
      variant: "footer",
      order: next(),
      visible: true,
      props: clean({
        offerLink: str(m.landing_offer_link),
        privacyLink: str(m.landing_privacy_link),
      }),
      i18n: {
        ru: clean({
          contacts: str(m.landing_contacts),
          footerText: str(m.landing_footer_text),
        }),
      },
    },
  });

  const total = await prisma.landingBlock.count();
  return { migrated: true, created: total };
}

// CLI: `tsx src/scripts/migrate-landing-to-blocks.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateLandingToBlocks()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      return prisma.$disconnect();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      return prisma.$disconnect().finally(() => process.exit(1));
    });
}
