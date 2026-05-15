import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import {
  api,
  type SingboxNodeListItem,
  type CreateSingboxNodeResponse,
  type SingboxNodeDetail,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Server, Plus, Copy, Check, Loader2, Pencil, Trash2, FileJson, Layers, Tag, Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { SingboxCategoryItem, SingboxTariffListItem } from "@/lib/api";

function formatBytes(s: string): string {
  const n = Number(s);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ONLINE: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
    OFFLINE: "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10",
    DISABLED: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20",
  };
  const dotColor: Record<string, string> = {
    ONLINE: "bg-emerald-400 shadow-[0_0_4px_#10b981]",
    OFFLINE: "bg-muted-foreground/40",
    DISABLED: "bg-amber-400 shadow-[0_0_4px_#fbbf24]",
  };
  const label = status === "ONLINE" ? "Онлайн" : status === "DISABLED" ? "Отключена" : "Офлайн";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md", map[status] ?? map.OFFLINE)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[status] ?? dotColor.OFFLINE)} />
      {label}
    </span>
  );
}

const PROTOCOLS = ["VLESS", "SHADOWSOCKS", "TROJAN", "HYSTERIA2"] as const;

export function SingboxPage() {
  const { state } = useAuth();
  const [nodes, setNodes] = useState<SingboxNodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeProtocol, setNewNodeProtocol] = useState<string>("VLESS");
  const [newNodePort, setNewNodePort] = useState("443");
  const [creating, setCreating] = useState(false);
  const [addResult, setAddResult] = useState<CreateSingboxNodeResponse | null>(null);
  const [copied, setCopied] = useState<"compose" | null>(null);
  const [detailNode, setDetailNode] = useState<SingboxNodeDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configJson, setConfigJson] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SingboxNodeListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editPort, setEditPort] = useState("443");
  const [editProtocol, setEditProtocol] = useState("VLESS");
  const [saving, setSaving] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<SingboxNodeListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("nodes");
  const [categories, setCategories] = useState<SingboxCategoryItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryModal, setCategoryModal] = useState<"add" | { edit: SingboxCategoryItem } | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", sortOrder: "0" });
  const [tariffModal, setTariffModal] = useState<{ kind: "add"; categoryId: string } | { kind: "edit"; tariff: SingboxTariffListItem } | null>(null);
  const [tariffForm, setTariffForm] = useState({
    name: "", categoryId: "", slotCount: "1", durationDays: "30", trafficLimitBytes: "", price: "", currency: "rub", sortOrder: "0", enabled: true,
  });
  const [savingCat, setSavingCat] = useState(false);
  const [savingTariff, setSavingTariff] = useState(false);

  const token = state.accessToken;
  if (!token) return null;

  async function loadNodes() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.getSingboxNodes(token);
      setNodes(res.items);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNodes();
  }, [token]);

  useEffect(() => {
    if (!token || !detailId) {
      setDetailNode(null);
      return;
    }
    setDetailLoading(true);
    api
      .getSingboxNode(token, detailId)
      .then(setDetailNode)
      .catch(() => setDetailNode(null))
      .finally(() => setDetailLoading(false));
  }, [token, detailId]);

  async function loadCategories() {
    if (!token) return;
    setCategoriesLoading(true);
    try {
      const res = await api.getSingboxCategories(token);
      setCategories(res.items);
    } catch {
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "categories" || activeTab === "tariffs") loadCategories();
  }, [activeTab, token]);

  async function handleSaveCategory() {
    if (!token) return;
    const name = categoryForm.name.trim();
    if (!name) return;
    setSavingCat(true);
    try {
      if (categoryModal === "add") {
        await api.createSingboxCategory(token, { name, sortOrder: parseInt(categoryForm.sortOrder, 10) || 0 });
      } else if (categoryModal && "edit" in categoryModal) {
        await api.updateSingboxCategory(token, categoryModal.edit.id, { name, sortOrder: parseInt(categoryForm.sortOrder, 10) || 0 });
      }
      await loadCategories();
      setCategoryModal(null);
      setCategoryForm({ name: "", sortOrder: "0" });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!token || !confirm("Удалить категорию и все тарифы в ней?")) return;
    try {
      await api.deleteSingboxCategory(token, id);
      await loadCategories();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleSaveTariff() {
    if (!token) return;
    const name = tariffForm.name.trim();
    if (!name) return;
    const price = parseFloat(tariffForm.price);
    if (!Number.isFinite(price) || price < 0) return;
    setSavingTariff(true);
    try {
      const trafficBytes = tariffForm.trafficLimitBytes.trim() === "" ? null : (parseInt(tariffForm.trafficLimitBytes, 10) || null);
      const payload = {
        name,
        categoryId: tariffForm.categoryId || (tariffModal && "categoryId" in tariffModal ? tariffModal.categoryId : ""),
        slotCount: parseInt(tariffForm.slotCount, 10) || 1,
        durationDays: parseInt(tariffForm.durationDays, 10) || 30,
        trafficLimitBytes: trafficBytes != null ? trafficBytes * 1024 * 1024 * 1024 : null,
        price,
        currency: tariffForm.currency.toUpperCase(),
        sortOrder: parseInt(tariffForm.sortOrder, 10) || 0,
        enabled: tariffForm.enabled,
      };
      if (tariffModal?.kind === "add") {
        if (!payload.categoryId) return;
        await api.createSingboxTariff(token, payload as Parameters<typeof api.createSingboxTariff>[1]);
      } else if (tariffModal?.kind === "edit") {
        await api.updateSingboxTariff(token, tariffModal.tariff.id, payload);
      }
      await loadCategories();
      setTariffModal(null);
      setTariffForm({ name: "", categoryId: "", slotCount: "1", durationDays: "30", trafficLimitBytes: "", price: "", currency: "rub", sortOrder: "0", enabled: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSavingTariff(false);
    }
  }

  async function handleDeleteTariff(id: string) {
    if (!token || !confirm("Удалить тариф?")) return;
    try {
      await api.deleteSingboxTariff(token, id);
      await loadCategories();
      setTariffModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleAddNode() {
    if (!token) return;
    setCreating(true);
    setAddResult(null);
    try {
      const port = parseInt(newNodePort, 10) || 443;
      const res = await api.createSingboxNode(token, {
        name: newNodeName.trim() || "Sing-box node",
        protocol: newNodeProtocol,
        port,
        tlsEnabled: true,
      });
      setAddResult(res);
      await loadNodes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setCreating(false);
    }
  }

  function copyCompose() {
    if (!addResult?.dockerCompose) return;
    navigator.clipboard.writeText(addResult.dockerCompose);
    setCopied("compose");
    setTimeout(() => setCopied(null), 2000);
  }

  function openEdit(node: SingboxNodeListItem) {
    setEditingNode(node);
    setEditName(node.name);
    setEditPort(String(node.port));
    setEditProtocol(node.protocol);
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!token || !editingNode) return;
    setSaving(true);
    try {
      const port = parseInt(editPort, 10) || 443;
      await api.updateSingboxNode(token, editingNode.id, {
        name: editName.trim(),
        port,
        protocol: editProtocol,
      });
      await loadNodes();
      setEditOpen(false);
      setEditingNode(null);
      if (detailNode?.id === editingNode.id) {
        const updated = await api.getSingboxNode(token, editingNode.id);
        setDetailNode(updated);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !nodeToDelete) return;
    setDeleting(true);
    try {
      await api.deleteSingboxNode(token, nodeToDelete.id);
      await loadNodes();
      if (detailId === nodeToDelete.id) setDetailId(null);
      setNodeToDelete(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setDeleting(false);
    }
  }

  function openConfigEditor() {
    if (!detailNode) return;
    const raw = detailNode.customConfigJson;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setConfigJson(JSON.stringify(parsed, null, 2));
      } catch {
        setConfigJson(raw);
      }
    } else {
      setConfigJson(`{
  "log": { "level": "info" },
  "inbounds": [
    {
      "type": "vless",
      "tag": "stealthnet-in",
      "listen": "::",
      "listen_port": ${detailNode.port},
      "users": []
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" }
  ]
}`);
    }
    setConfigError(null);
    setConfigOpen(true);
  }

  async function saveConfig() {
    if (!token || !detailNode) return;
    setConfigError(null);
    const trimmed = configJson.trim();
    if (!trimmed) {
      setConfigError("Конфиг не может быть пустым");
      return;
    }
    try {
      JSON.parse(trimmed);
    } catch (e) {
      setConfigError("Невалидный JSON: " + (e instanceof Error ? e.message : ""));
      return;
    }
    setConfigSaving(true);
    try {
      await api.updateSingboxNode(token, detailNode.id, { customConfigJson: trimmed });
      setConfigOpen(false);
      const updated = await api.getSingboxNode(token, detailNode.id);
      setDetailNode(updated);
      await loadNodes();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setConfigSaving(false);
    }
  }

  function formatPrice(amount: number, currency: string) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency.toUpperCase() === "RUB" ? "RUB" : "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Boxes className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Sing-box
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ноды VLESS / Shadowsocks / Trojan / Hysteria2. Категории и тарифы для продажи доступов.
            </p>
          </div>
        </div>
        {activeTab === "nodes" && (
          <Button onClick={() => { setAddOpen(true); setAddResult(null); setNewNodeName(""); setNewNodeProtocol("VLESS"); setNewNodePort("443"); }} className="gap-2 rounded-xl">
            <Plus className="h-4 w-4" />
            Добавить ноду
          </Button>
        )}
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3 bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/5 rounded-xl p-1">
          <TabsTrigger value="nodes" className="flex items-center gap-1.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Server className="h-4 w-4" />
            Ноды
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center gap-1.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Layers className="h-4 w-4" />
            Категории
          </TabsTrigger>
          <TabsTrigger value="tariffs" className="flex items-center gap-1.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Tag className="h-4 w-4" />
            Тарифы
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nodes" className="mt-4">
      {loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем ноды…</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight">Ноды</h3>
                <p className="text-xs text-muted-foreground">Список sing-box нод</p>
              </div>
            </div>
            {nodes.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">Нод пока нет. Нажмите «Добавить ноду».</p>
            ) : (
              <ul className="space-y-2">
                {nodes.map((n) => (
                  <motion.li
                    key={n.id}
                    whileHover={{ y: -1 }}
                    className={cn(
                      "relative overflow-hidden flex items-center justify-between gap-2 rounded-xl border p-3 cursor-pointer transition-all backdrop-blur-md",
                      detailId === n.id
                        ? "border-primary/40 bg-primary/5 shadow-md"
                        : "border-white/10 bg-foreground/[0.02] dark:bg-white/[0.02] hover:bg-foreground/[0.05] dark:hover:bg-white/[0.04] hover:border-white/20"
                    )}
                    onClick={() => setDetailId(n.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shrink-0">
                        <Server className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{n.name || n.id.slice(0, 8)}</span>
                          {n.hasCustomConfig && (
                            <FileJson className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {statusBadge(n.status)}
                          <span className="text-[10px] text-muted-foreground">{n.protocol}</span>
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground shrink-0">
                      {n.slotsCount} сл.
                    </span>
                  </motion.li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <FileJson className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight">Детали ноды</h3>
                <p className="text-xs text-muted-foreground">
                  {detailId ? (detailLoading ? "Загрузка…" : "Клик по ноде — детали и конфиг") : "Выберите ноду"}
                </p>
              </div>
            </div>
            {!detailId ? (
              <p className="text-muted-foreground text-sm py-6 text-center">Выберите ноду из списка слева.</p>
            ) : detailLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : detailNode ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 grid gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Название</span><span className="font-medium">{detailNode.name || "—"}</span></div>
                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Статус</span>{statusBadge(detailNode.status)}</div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Хост</span><span className="font-mono text-xs">{detailNode.publicHost || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Порт / протокол</span><span className="font-mono text-xs">{detailNode.port} / {detailNode.protocol}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Heartbeat</span><span className="text-xs">{formatDate(detailNode.lastSeenAt)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Трафик</span><span className="text-xs tabular-nums">↓ {formatBytes(detailNode.trafficInBytes)} ↑ {formatBytes(detailNode.trafficOutBytes)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Слотов</span><span className="font-semibold">{detailNode.slots.length}</span></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={openConfigEditor} className="gap-1.5 rounded-xl">
                    <FileJson className="h-4 w-4" />
                    Конфиг JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit({ ...detailNode, slotsCount: detailNode.slots.length, hasCustomConfig: !!detailNode.customConfigJson } as SingboxNodeListItem)} className="gap-1.5 rounded-xl">
                    <Pencil className="h-4 w-4" />
                    Изменить
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50" onClick={() => setNodeToDelete({ ...detailNode, slotsCount: detailNode.slots.length, hasCustomConfig: !!detailNode.customConfigJson } as SingboxNodeListItem)}>
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </Button>
                </div>
                {detailNode.slots.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Слоты</Label>
                    <ul className="rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] divide-y divide-white/5 text-sm overflow-hidden">
                      {detailNode.slots.map((s) => (
                        <li key={s.id} className="px-3 py-2 flex justify-between items-center">
                          <span className="font-mono text-xs">{s.userIdentifier}</span>
                          <span className="text-muted-foreground text-xs">{formatDate(s.expiresAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Не удалось загрузить ноду.</p>
            )}
          </Card>
        </div>
      )}
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                  <Layers className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">Категории</h3>
                  <p className="text-xs text-muted-foreground">Группы тарифов для магазина доступов</p>
                </div>
              </div>
              <Button onClick={() => { setCategoryModal("add"); setCategoryForm({ name: "", sortOrder: "0" }); }} size="sm" className="gap-1.5 rounded-xl">
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
            {categoriesLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : categories.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Нет категорий. Добавьте категорию, затем тарифы.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((c, i) => (
                  <motion.li
                    key={c.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    whileHover={{ y: -1 }}
                    className="rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-3 flex items-center justify-between hover:border-white/20 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-500/5 border border-white/10 flex items-center justify-center shrink-0">
                        <Layers className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                      </div>
                      <span className="font-medium truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {c.tariffs.length} тарифов
                      </span>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => { setCategoryModal({ edit: c }); setCategoryForm({ name: c.name, sortOrder: String(c.sortOrder) }); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50" onClick={() => handleDeleteCategory(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </motion.li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="tariffs" className="mt-4">
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                  <Tag className="h-5 w-5 text-amber-500 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">Тарифы</h3>
                  <p className="text-xs text-muted-foreground">Тарифы по категориям. Клиенты покупают по singboxTariffId.</p>
                </div>
              </div>
              <Button
                size="sm"
                className="gap-1.5 rounded-xl"
                onClick={() => {
                  if (categories.length === 0) { alert("Сначала добавьте категорию"); return; }
                  setTariffModal({ kind: "add", categoryId: categories[0]!.id });
                  setTariffForm({ name: "", categoryId: categories[0]!.id, slotCount: "1", durationDays: "30", trafficLimitBytes: "", price: "", currency: "rub", sortOrder: "0", enabled: true });
                }}
              >
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
            {categoriesLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : categories.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Добавьте категорию во вкладке «Категории».</p>
            ) : (
              <div className="space-y-5">
                {categories.map((cat) => (
                  <div key={cat.id}>
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 px-1">{cat.name}</h3>
                    {cat.tariffs.length === 0 ? (
                      <p className="text-sm text-muted-foreground ml-2">Нет тарифов</p>
                    ) : (
                      <ul className="space-y-2">
                        {cat.tariffs.map((t) => (
                          <motion.li
                            key={t.id}
                            whileHover={{ y: -1 }}
                            className={cn(
                              "rounded-xl border p-3 flex items-center justify-between gap-3 backdrop-blur-md transition-all flex-wrap",
                              t.enabled
                                ? "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] hover:border-white/20"
                                : "border-amber-500/20 bg-amber-500/[0.04] hover:border-amber-500/30"
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shrink-0">
                                <Tag className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium truncate">{t.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {t.slotCount} сл. · {t.durationDays} дн. · <span className="font-semibold text-emerald-500 dark:text-emerald-400">{formatPrice(t.price, t.currency)}</span>
                                  {t.trafficLimitBytes ? ` · ${formatBytes(t.trafficLimitBytes)}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!t.enabled && (
                                <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium">
                                  Выкл
                                </span>
                              )}
                              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => {
                                setTariffModal({ kind: "edit", tariff: { ...t, categoryId: cat.id, categoryName: cat.name, sortOrder: 0 } as SingboxTariffListItem });
                                setTariffForm({
                                  name: t.name, categoryId: cat.id, slotCount: String(t.slotCount), durationDays: String(t.durationDays),
                                  trafficLimitBytes: t.trafficLimitBytes ? String(Math.round(Number(t.trafficLimitBytes) / (1024 ** 3))) : "", price: String(t.price), currency: t.currency.toLowerCase(), sortOrder: "0", enabled: t.enabled,
                                });
                              }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50" onClick={() => handleDeleteTariff(t.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </motion.li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Диалог: добавить ноду */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Добавить sing-box ноду</DialogTitle>
            <DialogDescription>Заполните параметры. После создания скопируйте docker-compose на сервер.</DialogDescription>
          </DialogHeader>
          {!addResult ? (
            <div className="space-y-4 py-4">
              <div className="grid gap-2">
                <Label>Название</Label>
                <Input
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  placeholder="Sing-box node 1"
                />
              </div>
              <div className="grid gap-2">
                <Label>Протокол</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={newNodeProtocol}
                  onChange={(e) => setNewNodeProtocol(e.target.value)}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Порт</Label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={newNodePort}
                  onChange={(e) => setNewNodePort(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
                <Button onClick={handleAddNode} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Создать
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <p className="text-sm text-green-600 dark:text-green-400">Нода создана. Скопируйте docker-compose на сервер и выполните <code className="rounded bg-muted px-1">docker compose up -d --build</code>.</p>
              <div className="grid gap-2">
                <Label>Docker Compose</Label>
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">{addResult.dockerCompose}</pre>
                <Button variant="outline" size="sm" onClick={copyCompose}>
                  {copied === "compose" ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  Копировать
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{addResult.instructions}</p>
              <DialogFooter>
                <Button onClick={() => { setAddOpen(false); setAddResult(null); }}>Закрыть</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Диалог: редактировать ноду */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Изменить ноду</DialogTitle>
          </DialogHeader>
          {editingNode && (
            <div className="space-y-4 py-4">
              <div className="grid gap-2">
                <Label>Название</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Протокол</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={editProtocol}
                  onChange={(e) => setEditProtocol(e.target.value)}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Порт</Label>
                <Input type="number" min={1} max={65535} value={editPort} onChange={(e) => setEditPort(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
                <Button onClick={handleSaveEdit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Сохранить</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Диалог: категория (добавить / изменить) */}
      <Dialog open={categoryModal !== null} onOpenChange={(open) => !open && setCategoryModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{categoryModal === "add" ? "Добавить категорию" : "Изменить категорию"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Название</Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Например: Доступы VLESS"
              />
            </div>
            <div className="grid gap-2">
              <Label>Порядок (sortOrder)</Label>
              <Input
                type="number"
                value={categoryForm.sortOrder}
                onChange={(e) => setCategoryForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryModal(null)}>Отмена</Button>
            <Button onClick={handleSaveCategory} disabled={savingCat || !categoryForm.name.trim()}>
              {savingCat ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог: тариф (добавить / изменить) */}
      <Dialog open={tariffModal !== null} onOpenChange={(open) => !open && setTariffModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tariffModal?.kind === "add" ? "Добавить тариф" : "Изменить тариф"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Категория</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={tariffForm.categoryId}
                onChange={(e) => setTariffForm((f) => ({ ...f, categoryId: e.target.value }))}
                disabled={tariffModal?.kind === "edit"}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Название</Label>
              <Input value={tariffForm.name} onChange={(e) => setTariffForm((f) => ({ ...f, name: e.target.value }))} placeholder="Тариф 1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>Слотов</Label>
                <Input type="number" min={1} value={tariffForm.slotCount} onChange={(e) => setTariffForm((f) => ({ ...f, slotCount: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Дней</Label>
                <Input type="number" min={1} value={tariffForm.durationDays} onChange={(e) => setTariffForm((f) => ({ ...f, durationDays: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Лимит трафика (ГБ), пусто — без лимита</Label>
              <Input value={tariffForm.trafficLimitBytes} onChange={(e) => setTariffForm((f) => ({ ...f, trafficLimitBytes: e.target.value }))} placeholder="5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>Цена</Label>
                <Input type="number" min={0} step={0.01} value={tariffForm.price} onChange={(e) => setTariffForm((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Валюта</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={tariffForm.currency} onChange={(e) => setTariffForm((f) => ({ ...f, currency: e.target.value }))}>
                  <option value="rub">RUB</option>
                  <option value="usd">USD</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="tariff-enabled" checked={tariffForm.enabled} onChange={(e) => setTariffForm((f) => ({ ...f, enabled: e.target.checked }))} className="rounded border-input" />
              <Label htmlFor="tariff-enabled">Включён (доступен к покупке)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTariffModal(null)}>Отмена</Button>
            <Button onClick={handleSaveTariff} disabled={savingTariff || !tariffForm.name.trim()}>
              {savingTariff ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог: удалить ноду */}
      <Dialog open={!!nodeToDelete} onOpenChange={(open) => !open && setNodeToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить ноду?</DialogTitle>
            <DialogDescription>Все слоты на этой ноде будут удалены. Это нельзя отменить.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог: редактор конфига JSON */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Конфиг sing-box (JSON)</DialogTitle>
            <DialogDescription>
              Инбаунд с тегом <code className="rounded bg-muted px-1">stealthnet-in</code> — в него агент подставит пользователей из слотов. Остальное можно менять свободно.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <textarea
              className="flex-1 min-h-[300px] w-full rounded-md border border-input bg-muted/30 p-3 font-mono text-sm resize-y"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              spellCheck={false}
            />
            {configError && <p className="text-sm text-destructive">{configError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Отмена</Button>
            <Button onClick={saveConfig} disabled={configSaving}>
              {configSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
