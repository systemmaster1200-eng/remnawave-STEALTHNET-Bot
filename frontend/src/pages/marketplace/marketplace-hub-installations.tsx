import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, ExternalLink, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceInstallationDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BannerCard } from "./marketplace-layout";

export function MarketplaceHubInstallationsPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [items, setItems] = useState<MarketplaceInstallationDto[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    setLoading(true);
    api.marketplaceHubInstallations(state.accessToken, q)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = setTimeout(reload, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken, q]);

  const ban = async (i: MarketplaceInstallationDto) => {
    if (!state.accessToken) return;
    if (i.isBanned) {
      try {
        await api.marketplaceHubBanInstallation(state.accessToken, i.id, false);
        reload();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const reason = window.prompt(t("admin.marketplace.hub.ban_reason"), "spam") ?? undefined;
    if (reason === undefined) return;
    try {
      await api.marketplaceHubBanInstallation(state.accessToken, i.id, true, reason);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (i: MarketplaceInstallationDto) => {
    if (!state.accessToken) return;
    if (!window.confirm(`Delete installation ${i.domain}? All its listings will be removed.`)) return;
    try {
      await api.marketplaceHubDeleteInstallation(state.accessToken, i.id);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.marketplace.hub.search_placeholder")} className="pl-9" />
        </div>
        <Button size="sm" variant="outline" onClick={reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </Card>

      {error && <BannerCard tone="danger">{error}</BannerCard>}

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-3">Domain / contact</th>
              <th className="text-left px-4 py-3">Listings</th>
              <th className="text-left px-4 py-3">Last seen</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground animate-pulse">…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">—</td></tr>
            )}
            {!loading && items.map((i) => (
              <tr key={i.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="font-semibold">{i.displayName ?? i.domain}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <a href={`https://${i.domain}`} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline flex items-center gap-1">
                      {i.domain} <ExternalLink className="h-3 w-3" />
                    </a>
                    · @{i.contactUsername}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">{i.totalListings}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(i.lastSeenAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {i.isBanned ? (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/30">
                      banned{i.banReason ? `: ${i.banReason}` : ""}
                    </span>
                  ) : (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                      active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => ban(i)}>
                      {i.isBanned ? <ShieldCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      {i.isBanned ? t("admin.marketplace.hub.unban") : t("admin.marketplace.hub.ban")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
