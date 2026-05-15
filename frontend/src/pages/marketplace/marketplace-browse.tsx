import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Eye, Flag, Search, ShoppingBag } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceCategoryDto, type MarketplaceListingDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GlassSelect } from "@/components/ui/glass-select";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { flagEmoji, formatPrice, priceUnitKey, safeUrl } from "./marketplace-helpers";

type SortValue = "new" | "cheap" | "expensive";
const COUNTRY_OPTIONS: { value: string; labelKey?: string; label?: string }[] = [
  { value: "", labelKey: "admin.marketplace.browse.any_country" },
  { value: "RU", label: "Russia" },
  { value: "US", label: "United States" },
  { value: "DE", label: "Germany" },
  { value: "NL", label: "Netherlands" },
  { value: "FI", label: "Finland" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "PL", label: "Poland" },
  { value: "TR", label: "Turkey" },
  { value: "AE", label: "UAE" },
  { value: "JP", label: "Japan" },
  { value: "SG", label: "Singapore" },
];

export function MarketplaceBrowsePage() {
  const { t } = useTranslation();
  const { state } = useAuth();

  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [items, setItems] = useState<MarketplaceListingDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [currency, setCurrency] = useState<string>("");
  const [sort, setSort] = useState<SortValue>("new");

  const [active, setActive] = useState<MarketplaceListingDto | null>(null);

  useEffect(() => {
    if (!state.accessToken) return;
    api.marketplaceCategories(state.accessToken).then((r) => setCategories(r.items)).catch(() => undefined);
  }, [state.accessToken]);

  useEffect(() => {
    if (!state.accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .marketplaceListings(state.accessToken, {
        page,
        limit: 20,
        sort,
        category: category || undefined,
        country: country || undefined,
        currency: (currency || undefined) as "USD" | "RUB" | "EUR" | "USDT" | undefined,
        q: q.trim() || undefined,
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.accessToken, page, sort, category, country, currency, q]);

  const lang = (typeof navigator !== "undefined" && navigator.language?.startsWith("ru")) ? "ru" : "en";
  const categoryOptions = useMemo(
    () => [
      { value: "", label: t("admin.marketplace.browse.all_categories") },
      ...categories.map((c) => ({ value: c.slug, label: lang === "ru" ? c.labelRu : c.labelEn })),
    ],
    [categories, lang, t]
  );
  const countryOptions = useMemo(
    () => COUNTRY_OPTIONS.map((c) => ({ value: c.value, label: c.labelKey ? t(c.labelKey) : (c.label ?? c.value) })),
    [t]
  );
  const currencyOptions = useMemo(
    () => [
      { value: "", label: t("admin.marketplace.browse.any_currency") },
      { value: "USD", label: "USD" },
      { value: "EUR", label: "EUR" },
      { value: "RUB", label: "RUB" },
      { value: "USDT", label: "USDT" },
    ],
    [t]
  );
  const sortOptions = useMemo(
    () => [
      { value: "new", label: t("admin.marketplace.browse.sort_new") },
      { value: "cheap", label: t("admin.marketplace.browse.sort_cheap") },
      { value: "expensive", label: t("admin.marketplace.browse.sort_expensive") },
    ],
    [t]
  );

  return (
    <div className="space-y-5">
      <Card className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-5 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
            placeholder={t("admin.marketplace.browse.search_placeholder")}
            className="pl-9"
          />
        </div>
        <div className="md:col-span-3">
          <GlassSelect value={category} onChange={(v) => { setPage(1); setCategory(v); }} options={categoryOptions} />
        </div>
        <div className="md:col-span-2">
          <GlassSelect value={country} onChange={(v) => { setPage(1); setCountry(v); }} options={countryOptions} />
        </div>
        <div className="md:col-span-1">
          <GlassSelect value={currency} onChange={(v) => { setPage(1); setCurrency(v); }} options={currencyOptions} />
        </div>
        <div className="md:col-span-1">
          <GlassSelect value={sort} onChange={(v) => setSort(v as SortValue)} options={sortOptions} />
        </div>
      </Card>

      {loading && <SkeletonGrid />}
      {!loading && error && (
        <Card className="p-6 text-sm text-red-600 dark:text-red-300 border-red-500/30 bg-red-500/5">
          {t("admin.marketplace.browse.load_error")}: {error}
        </Card>
      )}
      {!loading && !error && items.length === 0 && (
        <Card className="p-12 text-center space-y-2">
          <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <h3 className="text-lg font-semibold">{t("admin.marketplace.browse.empty_title")}</h3>
          <p className="text-sm text-muted-foreground">{t("admin.marketplace.browse.empty_subtitle")}</p>
        </Card>
      )}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((it) => (
              <ListingCard key={it.id} item={it} lang={lang} onClick={() => setActive(it)} />
            ))}
          </div>
          {total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ←
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {Math.max(1, Math.ceil(total / 20))}
              </span>
              <Button size="sm" variant="outline" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage((p) => p + 1)}>
                →
              </Button>
            </div>
          )}
        </>
      )}

      <ListingDialog open={!!active} item={active} lang={lang} onClose={() => setActive(null)} />
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden animate-pulse">
          <div className="h-40 bg-muted/40" />
          <div className="p-4 space-y-2">
            <div className="h-4 w-2/3 bg-muted/40 rounded" />
            <div className="h-3 w-full bg-muted/30 rounded" />
            <div className="h-3 w-1/2 bg-muted/30 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ListingCard({ item, lang, onClick }: { item: MarketplaceListingDto; lang: "ru" | "en"; onClick: () => void }) {
  const { t } = useTranslation();
  const cover = safeUrl(item.coverImageUrl);
  const country = flagEmoji(item.country);
  const catLabel = lang === "ru" ? item.category.labelRu : item.category.labelEn;
  return (
    <Card
      className="overflow-hidden flex flex-col hover:shadow-xl hover:scale-[1.01] transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="relative h-40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent overflow-hidden">
        {cover ? (
          <img src={cover} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-primary/40">
            <ShoppingBag className="h-14 w-14" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1">
          <span className="rounded-full bg-background/80 backdrop-blur px-2.5 py-1 text-[11px] font-medium border">
            {catLabel}
          </span>
          {country && (
            <span className="rounded-full bg-background/80 backdrop-blur px-2.5 py-1 text-[11px] font-medium border">
              {country} {item.country}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 p-4 space-y-3">
        <h3 className="font-semibold text-base leading-snug line-clamp-2">{item.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-3">{item.description}</p>
        <div className="flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("admin.marketplace.card.from")}</div>
            <div className="text-lg font-bold leading-tight">
              {formatPrice(item.priceCents, item.currency)}
              <span className="text-xs text-muted-foreground ml-1">{t(priceUnitKey(item.priceUnit))}</span>
            </div>
          </div>
          <div className="text-right text-[11px] text-muted-foreground flex items-center gap-1">
            <Eye className="h-3 w-3" /> {item.views}
          </div>
        </div>
        <div className="flex items-center justify-between border-t pt-3 mt-1">
          <div className="flex items-center gap-2 min-w-0">
            <SellerAvatar item={item} />
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{item.seller.displayName ?? `@${item.seller.contactUsername}`}</div>
              <div className="text-[11px] text-muted-foreground truncate">@{item.seller.contactUsername}</div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onClick(); }}>
            {t("admin.marketplace.browse.view_listing")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SellerAvatar({ item }: { item: MarketplaceListingDto }) {
  const logo = safeUrl(item.seller.logoUrl);
  if (logo) {
    return <img src={logo} alt="" className="h-8 w-8 rounded-full object-cover border" />;
  }
  const initial = (item.seller.displayName ?? item.seller.contactUsername ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold border">
      {initial}
    </div>
  );
}

function ListingDialog({ open, item, lang, onClose }: { open: boolean; item: MarketplaceListingDto | null; lang: "ru" | "en"; onClose: () => void }) {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => {
    if (!open || !item || !state.accessToken) return;
    api.marketplaceTrackView(state.accessToken, item.id).catch(() => undefined);
    setReportSent(false);
  }, [open, item, state.accessToken]);

  if (!item) return null;
  const cover = safeUrl(item.coverImageUrl);
  const catLabel = lang === "ru" ? item.category.labelRu : item.category.labelEn;
  const tgUrl = item.seller.contactUrl;
  const country = flagEmoji(item.country);

  const submitReport = async () => {
    if (!state.accessToken) return;
    const reason = window.prompt("Reason: spam | scam | wrong_category | offensive | other", "spam");
    if (!reason) return;
    const allowed = ["spam", "scam", "wrong_category", "offensive", "other"] as const;
    if (!allowed.includes(reason as (typeof allowed)[number])) return;
    const comment = window.prompt("Comment (optional)") ?? undefined;
    try {
      await api.marketplaceReport(state.accessToken, { listingId: item.id, reason: reason as (typeof allowed)[number], comment });
      setReportSent(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3">
            <div className="rounded-xl overflow-hidden border bg-muted/30 aspect-[16/9] flex items-center justify-center">
              {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <ShoppingBag className="h-14 w-14 text-muted-foreground/40" />}
            </div>
            {item.gallery.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-3">
                {item.gallery.slice(0, 8).map((g) => {
                  const u = safeUrl(g);
                  return u ? <img key={g} src={u} alt="" className="h-16 w-full object-cover rounded-lg border" /> : null;
                })}
              </div>
            )}
            <div className="mt-4 text-sm whitespace-pre-line leading-relaxed">{item.description}</div>
            {item.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {item.tags.map((tg) => (
                  <span key={tg} className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">#{tg}</span>
                ))}
              </div>
            )}
          </div>
          <div className="md:col-span-2 space-y-3">
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("admin.marketplace.card.from")}</div>
              <div className="text-2xl font-bold">
                {formatPrice(item.priceCents, item.currency)}
                <span className="text-sm text-muted-foreground ml-1">{t(priceUnitKey(item.priceUnit))}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Info label={t("admin.marketplace.card.country")} value={country ? `${country} ${item.country}` : (item.country ?? "—")} />
                <Info label="Category" value={catLabel} />
              </div>
            </Card>
            <Card className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("admin.marketplace.card.seller")}</div>
              <div className="flex items-center gap-3">
                <SellerAvatar item={item} />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{item.seller.displayName ?? `@${item.seller.contactUsername}`}</div>
                  <div className="text-xs text-muted-foreground truncate">@{item.seller.contactUsername}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("admin.marketplace.card.since", { date: new Date(item.seller.memberSince).toLocaleDateString() })}
              </div>
              <Button asChild size="sm" className="w-full mt-2">
                <a href={tgUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("admin.marketplace.browse.contact_seller")}
                </a>
              </Button>
              <Button size="sm" variant="outline" className="w-full" disabled={reportSent} onClick={submitReport}>
                <Flag className="h-3.5 w-3.5" />
                {reportSent ? "✓" : t("admin.marketplace.browse.report")}
              </Button>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className={cn("text-[10px] uppercase tracking-widest text-muted-foreground")}>{label}</div>
      <div className="font-medium text-sm truncate">{value}</div>
    </div>
  );
}
