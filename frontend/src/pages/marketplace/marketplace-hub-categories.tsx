import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type MarketplaceCategoryDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BannerCard } from "./marketplace-layout";

interface DraftCategory {
  id: string | null;
  slug: string;
  labelRu: string;
  labelEn: string;
  icon: string;
  sortOrder: number;
  isEnabled: boolean;
}

const NEW_DRAFT: DraftCategory = { id: null, slug: "", labelRu: "", labelEn: "", icon: "", sortOrder: 0, isEnabled: true };

export function MarketplaceHubCategoriesPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const [items, setItems] = useState<MarketplaceCategoryDto[]>([]);
  const [draft, setDraft] = useState<DraftCategory>(NEW_DRAFT);
  const [editing, setEditing] = useState<Record<string, MarketplaceCategoryDto>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!state.accessToken) return;
    api.marketplaceHubCategories(state.accessToken)
      .then((r) => {
        setItems(r.items);
        const next: Record<string, MarketplaceCategoryDto> = {};
        r.items.forEach((c) => { next[c.id] = c; });
        setEditing(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  const create = async () => {
    if (!state.accessToken) return;
    if (!draft.slug.trim() || !draft.labelRu.trim() || !draft.labelEn.trim()) return;
    try {
      await api.marketplaceHubCreateCategory(state.accessToken, {
        slug: draft.slug.trim(),
        labelRu: draft.labelRu.trim(),
        labelEn: draft.labelEn.trim(),
        icon: draft.icon.trim() || null,
        sortOrder: draft.sortOrder,
        isEnabled: draft.isEnabled,
      });
      setDraft(NEW_DRAFT);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (c: MarketplaceCategoryDto) => {
    if (!state.accessToken) return;
    try {
      await api.marketplaceHubUpdateCategory(state.accessToken, c.id, {
        labelRu: c.labelRu,
        labelEn: c.labelEn,
        icon: c.icon ?? null,
        sortOrder: c.sortOrder,
        isEnabled: c.isEnabled,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!state.accessToken) return;
    if (!window.confirm("Delete category?")) return;
    try {
      await api.marketplaceHubDeleteCategory(state.accessToken, id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      {error && <BannerCard tone="danger">{error}</BannerCard>}

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> {t("admin.marketplace.tabs.categories")}</div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-2"><Label>slug</Label><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} /></div>
          <div className="md:col-span-3"><Label>label RU</Label><Input value={draft.labelRu} onChange={(e) => setDraft({ ...draft, labelRu: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>label EN</Label><Input value={draft.labelEn} onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>icon (lucide)</Label><Input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} /></div>
          <div className="md:col-span-1"><Label>order</Label><Input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: parseInt(e.target.value) || 0 })} /></div>
          <div className="md:col-span-1 flex items-end"><Button onClick={create} className="w-full"><Plus className="h-3.5 w-3.5" /></Button></div>
        </div>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground border-b">
            <tr>
              <th className="text-left px-3 py-2">slug</th>
              <th className="text-left px-3 py-2">label RU</th>
              <th className="text-left px-3 py-2">label EN</th>
              <th className="text-left px-3 py-2">icon</th>
              <th className="text-left px-3 py-2">order</th>
              <th className="text-left px-3 py-2">enabled</th>
              <th className="text-right px-3 py-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const c = editing[it.id] ?? it;
              const update = (patch: Partial<MarketplaceCategoryDto>) => setEditing((m) => ({ ...m, [it.id]: { ...c, ...patch } }));
              return (
                <tr key={it.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{c.slug}</td>
                  <td className="px-3 py-2"><Input value={c.labelRu} onChange={(e) => update({ labelRu: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input value={c.labelEn} onChange={(e) => update({ labelEn: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input value={c.icon ?? ""} onChange={(e) => update({ icon: e.target.value })} /></td>
                  <td className="px-3 py-2 w-24"><Input type="number" value={c.sortOrder} onChange={(e) => update({ sortOrder: parseInt(e.target.value) || 0 })} /></td>
                  <td className="px-3 py-2"><Switch checked={c.isEnabled} onCheckedChange={(v) => update({ isEnabled: v })} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => save(c)}><Save className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="destructive" className="ml-2" onClick={() => remove(it.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
