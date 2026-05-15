/**
 * Video (variant: embed) — embed YouTube/Vimeo или локальное видео.
 * Адаптивный 16:9 контейнер, постер до загрузки.
 */

import { txt, p, SECTION_SCROLL_OFFSET } from "../utils";
import type { LandingApiBlock } from "../types";

/** Преобразует YouTube/Vimeo URL в embed-форму. Возвращает оригинал если не распознано. */
function toEmbedUrl(url: string): { embed: string; isExternal: boolean } {
  if (!url) return { embed: "", isExternal: false };

  // YouTube: youtube.com/watch?v=ID или youtu.be/ID или уже /embed/ID
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { embed: `https://www.youtube.com/embed/${yt[1]}`, isExternal: true };

  // Vimeo: vimeo.com/ID
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { embed: `https://player.vimeo.com/video/${vm[1]}`, isExternal: true };

  // Прямое видео: .mp4, .webm, .ogg
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return { embed: url, isExternal: false };

  return { embed: url, isExternal: true };
}

export function VideoEmbed({ block }: { block: LandingApiBlock }) {
  const url = p(block.props, "url");
  const poster = p(block.props, "poster");
  const title = txt(block.text, "title");
  const caption = txt(block.text, "caption");

  if (!url) {
    return (
      <section className={`container mx-auto px-4 py-12 ${SECTION_SCROLL_OFFSET}`}>
        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-white/10 bg-white/40 dark:bg-white/5 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Укажите URL видео в props.url (YouTube, Vimeo или прямой mp4).
        </div>
      </section>
    );
  }

  const { embed, isExternal } = toEmbedUrl(url);

  return (
    <section className={`container mx-auto px-4 py-12 md:py-16 ${SECTION_SCROLL_OFFSET}`}>
      {title ? (
        <h2 className="mb-6 text-center text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl dark:text-white">
          {title}
        </h2>
      ) : null}

      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-slate-200/70 dark:border-white/10 bg-black shadow-2xl">
        <div className="relative aspect-video">
          {isExternal ? (
            <iframe
              src={embed}
              title={title || "Video"}
              loading="lazy"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : (
            <video
              src={embed}
              poster={poster || undefined}
              controls
              playsInline
              className="absolute inset-0 h-full w-full"
            />
          )}
        </div>
      </div>

      {caption ? (
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-slate-600 dark:text-slate-400">{caption}</p>
      ) : null}
    </section>
  );
}
