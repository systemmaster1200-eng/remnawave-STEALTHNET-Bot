import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Eye, Flag, RefreshCw, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceReportDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlassSelect } from "@/components/ui/glass-select";
import { BannerCard } from "./marketplace-layout";

export function MarketplaceHubReportsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [items, setItems] = useState<MarketplaceReportDto[]>([]);
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    setLoading(true);
    api.marketplaceHubReports(state.accessToken, status)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken, status]);

  const resolve = async (id: string, st: "resolved" | "dismissed", unhide = false) => {
    if (!state.accessToken) return;
    try {
      await api.marketplaceHubResolveReport(state.accessToken, id, { status: st, unhideListing: unhide });
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const forceDelete = async (id: string) => {
    if (!state.accessToken) return;
    if (!window.confirm("Delete this listing entirely?")) return;
    try {
      await api.marketplaceHubForceDeleteListing(state.accessToken, id);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3">
        <GlassSelect
          value={status}
          onChange={(v) => setStatus(v as "open" | "resolved" | "dismissed")}
          options={[
            { value: "open", label: "open" },
            { value: "resolved", label: "resolved" },
            { value: "dismissed", label: "dismissed" },
          ]}
          className="w-40"
        />
        <Button size="sm" variant="outline" onClick={reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </Card>

      {error && <BannerCard tone="danger">{error}</BannerCard>}

      {!loading && items.length === 0 && (
        <Card className="p-12 text-center space-y-2">
          <Flag className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t("admin.marketplace.hub.reports_empty")}</p>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((r) => (
          <Card key={r.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium border">{r.reason}</span>
                  <h3 className="font-semibold truncate">{r.listing.title}</h3>
                  <span className="text-[11px] text-muted-foreground">· {r.listing.category.labelEn}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Reported by <strong>@{r.reporter.displayName ?? r.reporter.domain}</strong> ·{" "}
                  Listing owner: <strong>{r.listing.installation.displayName ?? r.listing.installation.domain}</strong> · @{r.listing.installation.contactUsername}
                </div>
                {r.comment && <p className="text-sm">{r.comment}</p>}
                <div className="text-[11px] text-muted-foreground">
                  Status: {r.status} · created {new Date(r.createdAt).toLocaleString()} · listing.status = {r.listing.status} (reports: {r.listing.reportsCount})
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {r.status === "open" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => resolve(r.id, "resolved", false)}>
                      <Check className="h-3.5 w-3.5" />
                      {t("admin.marketplace.hub.resolve_keep_hidden")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolve(r.id, "dismissed", true)}>
                      <Eye className="h-3.5 w-3.5" />
                      {t("admin.marketplace.hub.resolve_unhide")}
                    </Button>
                  </>
                )}
                {r.status !== "open" && (
                  <Button size="sm" variant="ghost" disabled>
                    <X className="h-3.5 w-3.5" /> {r.status}
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => forceDelete(r.listingId)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
