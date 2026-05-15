import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingBag, ListChecks, Server, Flag, FolderTree, Settings as SettingsIcon, Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceStatusDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Ctx {
  status: MarketplaceStatusDto | null;
  reload: () => void;
}

export function MarketplaceLayout() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<MarketplaceStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    api.marketplaceStatus(state.accessToken).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  const isHub = status?.role === "hub";

  const tabs = useMemo(
    () => {
      const base: { to: string; label: string; icon: typeof ShoppingBag }[] = [
        { to: "/admin/marketplace", label: t("admin.marketplace.tabs.browse"), icon: ShoppingBag },
        { to: "/admin/marketplace/my", label: t("admin.marketplace.tabs.my"), icon: ListChecks },
      ];
      if (isHub) {
        base.push(
          { to: "/admin/marketplace/hub/installations", label: t("admin.marketplace.tabs.installations"), icon: Server },
          { to: "/admin/marketplace/hub/reports", label: t("admin.marketplace.tabs.reports"), icon: Flag },
          { to: "/admin/marketplace/hub/categories", label: t("admin.marketplace.tabs.categories"), icon: FolderTree },
        );
      }
      return base;
    },
    [t, isHub]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5" />
            {t("admin.marketplace.title")}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">{t("admin.marketplace.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t("admin.marketplace.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/settings#marketplace">
              <SettingsIcon className="h-3.5 w-3.5" /> {t("admin.marketplace.settings.title")}
            </Link>
          </Button>
          {location.pathname.startsWith("/admin/marketplace/my") && (
            <Button asChild size="sm">
              <Link to="/admin/marketplace/my/new">
                <Plus className="h-3.5 w-3.5" /> {t("admin.marketplace.listing_form.create_title")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {!status?.enabled && (
        <BannerCard tone="warning">
          {t("admin.marketplace.settings.enabled_hint")}
        </BannerCard>
      )}
      {status?.enabled && status.role === "client" && !status.apiKeyConnected && (
        <BannerCard tone="warning">
          <div className="space-y-2">
            <div>{t("admin.marketplace.settings.username_missing")}</div>
            <Button size="sm" asChild>
              <Link to="/admin/settings#marketplace">{t("admin.marketplace.settings.title")}</Link>
            </Button>
          </div>
        </BannerCard>
      )}
      {error && <BannerCard tone="danger">{error}</BannerCard>}

      <Card className="p-1.5 inline-flex flex-wrap gap-1 max-w-full overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/admin/marketplace"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted/50"
              )
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}
      </Card>

      <Outlet context={{ status, reload } satisfies Ctx} />
    </div>
  );
}

export function BannerCard({ tone, children }: { tone: "warning" | "info" | "danger"; children: ReactNode }) {
  const palette =
    tone === "danger"
      ? "border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-300"
      : tone === "warning"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
      : "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300";
  return <Card className={cn("px-4 py-3 text-sm", palette)}>{children}</Card>;
}

export type MarketplaceLayoutContext = Ctx;
