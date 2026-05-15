import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type MarketplaceCategoryDto,
  type MarketplaceCurrency,
  type MarketplaceListingDto,
  type MarketplaceListingPayload,
  type MarketplacePriceUnit,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { GlassSelect } from "@/components/ui/glass-select";
import { BannerCard } from "./marketplace-layout";

interface FormState {
  categoryId: string;
  title: string;
  description: string;
  priceWhole: string;
  currency: MarketplaceCurrency;
  priceUnit: MarketplacePriceUnit;
  country: string;
  tagsCsv: string;
  coverImageUrl: string;
  galleryRaw: string;
}

const EMPTY: FormState = {
  categoryId: "",
  title: "",
  description: "",
  priceWhole: "0",
  currency: "USD",
  priceUnit: "one_time",
  country: "",
  tagsCsv: "",
  coverImageUrl: "",
  galleryRaw: "",
};

export function MarketplaceEditListingPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("ru") ? "ru" : "en";
  const { state } = useAuth();
  const params = useParams();
  const navigate = useNavigate();
  const id = params.id ?? null;
  const isEdit = Boolean(id);

  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.accessToken) return;
    api.marketplaceCategories(state.accessToken).then((r) => {
      setCategories(r.items);
      setForm((prev) => (prev.categoryId ? prev : { ...prev, categoryId: r.items[0]?.id ?? "" }));
    }).catch(() => undefined);
  }, [state.accessToken]);

  useEffect(() => {
    if (!isEdit || !state.accessToken || !id) return;
    setLoading(true);
    api.marketplaceListing(state.accessToken, id)
      .then((r) => setForm(toForm(r)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [isEdit, id, state.accessToken]);

  const submit = async () => {
    if (!state.accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(form);
      if (isEdit && id) {
        await api.marketplaceUpdateListing(state.accessToken, id, payload);
      } else {
        await api.marketplaceCreateListing(state.accessToken, payload);
      }
      navigate("/admin/marketplace/my");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!state.accessToken || !id) return;
    if (!window.confirm("Delete this listing?")) return;
    try {
      await api.marketplaceDeleteListing(state.accessToken, id);
      navigate("/admin/marketplace/my");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: lang === "ru" ? c.labelRu : c.labelEn })),
    [categories, lang]
  );
  const currencyOptions = useMemo(
    () => [
      { value: "USD", label: "USD" },
      { value: "EUR", label: "EUR" },
      { value: "RUB", label: "RUB" },
      { value: "USDT", label: "USDT" },
    ],
    []
  );
  const priceUnitOptions = useMemo(
    () => [
      { value: "one_time", label: t("admin.marketplace.card.per_one_time") },
      { value: "per_month", label: t("admin.marketplace.card.per_month") },
      { value: "per_gb", label: t("admin.marketplace.card.per_gb") },
      { value: "per_device", label: t("admin.marketplace.card.per_device") },
    ],
    [t]
  );

  return (
    <Card className="p-5 md:p-7 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost"><Link to="/admin/marketplace/my"><ArrowLeft className="h-3.5 w-3.5" /></Link></Button>
        <h2 className="text-lg md:text-xl font-bold">
          {isEdit ? t("admin.marketplace.listing_form.edit_title") : t("admin.marketplace.listing_form.create_title")}
        </h2>
        <div className="w-8" />
      </div>

      {error && <BannerCard tone="danger">{error}</BannerCard>}
      {loading && <Card className="p-6 text-sm text-muted-foreground animate-pulse">…</Card>}

      {!loading && (
        <div className="space-y-4">
          <div>
            <Label>{t("admin.marketplace.listing_form.category")}</Label>
            <GlassSelect value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} options={categoryOptions} />
          </div>
          <div>
            <Label>{t("admin.marketplace.listing_form.title")}</Label>
            <Input
              value={form.title}
              maxLength={200}
              placeholder={t("admin.marketplace.listing_form.title_placeholder")}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t("admin.marketplace.listing_form.description")}</Label>
            <Textarea
              value={form.description}
              rows={6}
              maxLength={4000}
              placeholder={t("admin.marketplace.listing_form.description_placeholder")}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t("admin.marketplace.listing_form.price")}</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form.priceWhole}
                onChange={(e) => setForm({ ...form, priceWhole: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.marketplace.listing_form.currency")}</Label>
              <GlassSelect value={form.currency} onChange={(v) => setForm({ ...form, currency: v as MarketplaceCurrency })} options={currencyOptions} />
            </div>
            <div>
              <Label>{t("admin.marketplace.listing_form.price_unit")}</Label>
              <GlassSelect value={form.priceUnit} onChange={(v) => setForm({ ...form, priceUnit: v as MarketplacePriceUnit })} options={priceUnitOptions} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>{t("admin.marketplace.listing_form.country")}</Label>
              <Input value={form.country} maxLength={8} placeholder="NL" onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>{t("admin.marketplace.listing_form.tags")}</Label>
              <Input value={form.tagsCsv} placeholder={t("admin.marketplace.listing_form.tags_placeholder")} onChange={(e) => setForm({ ...form, tagsCsv: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>{t("admin.marketplace.listing_form.cover")}</Label>
            <Input value={form.coverImageUrl} placeholder="https://…" onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })} />
          </div>
          <div>
            <Label>{t("admin.marketplace.listing_form.gallery")}</Label>
            <Textarea value={form.galleryRaw} rows={4} placeholder={"https://…\nhttps://…"} onChange={(e) => setForm({ ...form, galleryRaw: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 pt-3 border-t">
            <Button onClick={submit} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {t("admin.marketplace.listing_form.save")}
            </Button>
            <Button variant="outline" asChild disabled={saving}>
              <Link to="/admin/marketplace/my">{t("admin.marketplace.listing_form.cancel")}</Link>
            </Button>
            {isEdit && (
              <Button variant="destructive" onClick={remove} className="ml-auto">
                <Trash2 className="h-3.5 w-3.5" />
                {t("admin.marketplace.listing_form.delete")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function toForm(l: MarketplaceListingDto): FormState {
  return {
    categoryId: l.category.id,
    title: l.title,
    description: l.description,
    priceWhole: ((l.priceCents ?? 0) / 100).toString(),
    currency: l.currency,
    priceUnit: l.priceUnit,
    country: l.country ?? "",
    tagsCsv: l.tags.join(", "),
    coverImageUrl: l.coverImageUrl ?? "",
    galleryRaw: l.gallery.join("\n"),
  };
}

function toPayload(form: FormState): MarketplaceListingPayload {
  const priceCents = Math.max(0, Math.round(parseFloat(form.priceWhole.replace(",", ".") || "0") * 100));
  const tags = form.tagsCsv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .slice(0, 12);
  const gallery = form.galleryRaw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 8);
  return {
    categoryId: form.categoryId,
    title: form.title.trim(),
    description: form.description.trim(),
    priceCents,
    currency: form.currency,
    priceUnit: form.priceUnit,
    country: form.country.trim() ? form.country.trim().toUpperCase() : null,
    tags,
    coverImageUrl: form.coverImageUrl.trim() || null,
    gallery,
  };
}
