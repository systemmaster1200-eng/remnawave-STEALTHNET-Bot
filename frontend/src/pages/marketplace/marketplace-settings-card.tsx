import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Plug, RefreshCw, Save, ShoppingBag, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceStatusDto } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Самодостаточная карточка настроек маркетплейса для страницы /admin/settings.
 * Не зависит от общего стейта settings.tsx, ходит в свои эндпоинты.
 * Якорь: id="marketplace" — открывается при переходе по /admin/settings#marketplace.
 */
export function MarketplaceSettingsCard() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [status, setStatus] = useState<MarketplaceStatusDto | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [role, setRole] = useState<"client" | "hub">("client");
  const [contactUsername, setContactUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    api.marketplaceStatus(state.accessToken).then((s) => {
      setStatus(s);
      setEnabled(s.enabled);
      setRole(s.role);
      setContactUsername(s.contactUsername ?? "");
      setDisplayName(s.displayName ?? "");
      setLogoUrl(s.logoUrl ?? "");
      setDescription(s.description ?? "");
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  // Скролл к секции по якорю #marketplace
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#marketplace") return;
    const el = document.getElementById("marketplace");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const save = async () => {
    if (!state.accessToken) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.marketplaceUpdateSettings(state.accessToken, {
        enabled,
        role,
        contactUsername: contactUsername.trim() || null,
        displayName: displayName.trim() || null,
        logoUrl: logoUrl.trim() || null,
        description: description.trim() || null,
      });
      setMessage(t("admin.marketplace.settings.saved"));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    if (!state.accessToken) return;
    setConnecting(true);
    setMessage(null);
    setError(null);
    try {
      const r = await api.marketplaceConnect(state.accessToken);
      if (r.ok) {
        setMessage(`✓ ${r.status}${r.installationId ? ` (${r.installationId})` : ""}`);
      } else {
        setError(r.message ?? "Connect failed");
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card id="marketplace" className="overflow-hidden border-white/10 mt-6">
      <div className="relative bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-fuchsia-500/10 p-6 sm:p-8 border-b border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-fuchsia-500/5 pointer-events-none" />
        <div className="relative flex items-start gap-5">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500/30 via-violet-500/20 to-fuchsia-500/30 flex items-center justify-center shadow-xl border border-white/20 shrink-0">
            <ShoppingBag className="h-7 w-7 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500">
              {t("admin.marketplace.settings.title")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("admin.marketplace.settings.subtitle")}</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/marketplace"><ExternalLink className="h-3.5 w-3.5" /> {t("admin.marketplace.title")}</Link>
          </Button>
        </div>
      </div>
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="flex items-center justify-between rounded-xl border border-white/10 p-4 bg-card/40">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">{t("admin.marketplace.settings.enabled")}</Label>
            <p className="text-xs text-muted-foreground">{t("admin.marketplace.settings.enabled_hint")}</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">{t("admin.marketplace.settings.role")}</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RoleCard active={role === "client"} onClick={() => setRole("client")} title={t("admin.marketplace.settings.role_client")} />
            <RoleCard active={role === "hub"} onClick={() => setRole("hub")} title={t("admin.marketplace.settings.role_hub")} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>{t("admin.marketplace.settings.contact_username")}</Label>
            <Input value={contactUsername} maxLength={64} onChange={(e) => setContactUsername(e.target.value.replace(/^@/, ""))} placeholder="my_telegram" />
            <p className="text-xs text-muted-foreground mt-1">{t("admin.marketplace.settings.contact_username_hint")}</p>
          </div>
          <div>
            <Label>{t("admin.marketplace.settings.display_name")}</Label>
            <Input value={displayName} maxLength={200} onChange={(e) => setDisplayName(e.target.value)} placeholder="STEALTHNET Pro" />
          </div>
        </div>
        <div>
          <Label>{t("admin.marketplace.settings.logo_url")}</Label>
          <Input value={logoUrl} maxLength={2000} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <Label>{t("admin.marketplace.settings.description")}</Label>
          <Textarea value={description} rows={3} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <Card className="p-4 space-y-2 bg-muted/20">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("admin.marketplace.settings.connection_status")}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <KeyValue label={t("admin.marketplace.settings.hub_url")} value={status?.hubUrl ?? "—"} />
            <KeyValue label={t("admin.marketplace.settings.installation_id")} value={status?.installationId ?? "—"} />
            <KeyValue label="API key" value={status?.apiKeyConnected ? "✓ connected" : "— not connected"} />
            <KeyValue label={t("admin.marketplace.settings.last_connect")} value={status?.lastConnectAt ? `${new Date(status.lastConnectAt).toLocaleString()} (${status.lastConnectStatus ?? ""})` : "—"} />
          </div>
        </Card>

        {message && <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Button onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? "…" : t("admin.marketplace.settings.save")}
          </Button>
          <Button variant="outline" onClick={connect} disabled={connecting}>
            {connecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
            {t("admin.marketplace.settings.connect_now")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RoleCard({ active, title, onClick }: { active: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all ${
        active ? "border-primary bg-primary/10 shadow-sm" : "border-border hover:bg-muted/40"
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
    </button>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card/40 border border-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-medium text-sm break-all">{value}</div>
    </div>
  );
}
