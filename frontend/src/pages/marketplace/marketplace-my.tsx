import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Archive, Edit, ExternalLink, Eye, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceListingDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPrice, priceUnitKey, safeUrl } from "./marketplace-helpers";
import { BannerCard } from "./marketplace-layout";

export function MarketplaceMyListingsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [items, setItems] = useState<MarketplaceListingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    setLoading(true);
    api.marketplaceMyListings(state.accessToken)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  const setStatus = async (id: string, status: "active" | "archived") => {
    if (!state.accessToken) return;
    try {
      await api.marketplaceUpdateListing(state.accessToken, id, { status });
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!state.accessToken) return;
    if (!window.confirm("Delete this listing?")) return;
    try {
      await api.marketplaceDeleteListing(state.accessToken, id);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      {error && <BannerCard tone="danger">{error}</BannerCard>}

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground animate-pulse">…</Card>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Upload className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <h3 className="text-lg font-semibold">{t("admin.marketplace.browse.empty_subtitle")}</h3>
          <Button asChild>
            <Link to="/admin/marketplace/my/new">
              <Plus className="h-3.5 w-3.5" />
              {t("admin.marketplace.listing_form.create_title")}
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <Card key={it.id} className="p-4 flex flex-col md:flex-row gap-4 items-start">
              <div className="h-24 w-32 rounded-lg overflow-hidden border bg-muted/40 flex items-center justify-center shrink-0">
                {safeUrl(it.coverImageUrl) ? (
                  <img src={safeUrl(it.coverImageUrl)!} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-muted-foreground">no cover</span>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate">{it.title}</h3>
                  <StatusBadge status={it.status} />
                  <span className="text-[11px] text-muted-foreground">{it.category.labelEn}</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{it.description}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{formatPrice(it.priceCents, it.currency)}</span>
                  <span>{t(priceUnitKey(it.priceUnit))}</span>
                  <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {it.views}</span>
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                {it.status === "active" ? (
                  <Button size="sm" variant="outline" onClick={() => setStatus(it.id, "archived")}>
                    <Archive className="h-3.5 w-3.5" />
                    {t("admin.marketplace.listing_form.archive")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setStatus(it.id, "active")}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("admin.marketplace.listing_form.publish")}
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/admin/marketplace/my/${it.id}/edit`}>
                    <Edit className="h-3.5 w-3.5" />
                    {t("admin.marketplace.listing_form.save")}
                  </Link>
                </Button>
                <Button size="sm" variant="destructive" onClick={() => remove(it.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const palette =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
      : status === "archived"
      ? "bg-muted text-muted-foreground border-border"
      : "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30";
  return <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", palette)}>{status}</span>;
}
