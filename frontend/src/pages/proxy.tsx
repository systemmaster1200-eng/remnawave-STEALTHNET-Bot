import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type ProxyNodeListItem, type CreateProxyNodeResponse, type ProxySlotAdminItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Globe, Plus, Copy, Check, Loader2, Server, Pencil, Trash2, Layers, Download, BarChart3, Users, Ban, KeyRound, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

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

const HEREDOC_MARKER = "ENDOFSTEALTHNET_COMPOSE";

type ProxyTariffItem = {
  id: string;
  categoryId: string;
  name: string;
  proxyCount: number;
  durationDays: number;
  trafficLimitBytes: string | null;
  connectionLimit: number | null;
  price: number;
  currency: string;
  sortOrder: number;
  enabled: boolean;
  nodeIds: string[];
};

type ProxyCategoryItem = {
  id: string;
  name: string;
  sortOrder: number;
  tariffs: ProxyTariffItem[];
};

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency.toUpperCase() === "RUB" ? "RUB" : "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ProxyPage() {
  const { state } = useAuth();
  const [nodes, setNodes] = useState<ProxyNodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  const [creating, setCreating] = useState(false);
  const [addResult, setAddResult] = useState<CreateProxyNodeResponse | null>(null);
  const [copied, setCopied] = useState<"compose" | "token" | "script" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<ProxyNodeListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<string>("");
  const [editCapacity, setEditCapacity] = useState<string>("");
  const [editSocksPort, setEditSocksPort] = useState<string>("1080");
  const [editHttpPort, setEditHttpPort] = useState<string>("8080");
  const [saving, setSaving] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<ProxyNodeListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("nodes");
  const [categories, setCategories] = useState<ProxyCategoryItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryModal, setCategoryModal] = useState<"add" | { edit: ProxyCategoryItem } | null>(null);
  const [tariffModal, setTariffModal] = useState<{ kind: "add"; categoryId: string } | { kind: "edit"; category: ProxyCategoryItem; tariff: ProxyTariffItem } | null>(null);
  const [slots, setSlots] = useState<ProxySlotAdminItem[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [editSlot, setEditSlot] = useState<ProxySlotAdminItem | null>(null);
  const [slotForm, setSlotForm] = useState({ login: "", password: "", connectionLimit: "", status: "" });

  const token = state.accessToken;
  if (!token) return null;

  async function loadNodes() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.getProxyNodes(token);
      setNodes(res.items);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNodes(); }, [token]);

  async function loadCategories() {
    if (!token) return;
    setCategoriesLoading(true);
    try {
      const res = await api.getProxyCategories(token);
      const items = res.items.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        tariffs: c.tariffs.map((t) => ({
          id: t.id,
          categoryId: t.categoryId ?? c.id,
          name: t.name,
          proxyCount: t.proxyCount,
          durationDays: t.durationDays,
          trafficLimitBytes: t.trafficLimitBytes ?? null,
          connectionLimit: t.connectionLimit ?? null,
          price: t.price,
          currency: t.currency,
          sortOrder: t.sortOrder ?? 0,
          enabled: t.enabled ?? true,
          nodeIds: t.nodeIds ?? [],
        })),
      }));
      setCategories(items);
    } catch { setCategories([]); } finally { setCategoriesLoading(false); }
  }

  async function handleDeleteCategory(id: string) {
    if (!token || !confirm("Удалить категорию и все тарифы в ней?")) return;
    try {
      await api.deleteProxyCategory(token, id);
      await loadCategories();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleDeleteTariff(id: string) {
    if (!token || !confirm("Удалить тариф?")) return;
    try {
      await api.deleteProxyTariff(token, id);
      await loadCategories();
      setTariffModal(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  async function handleToggleTariffEnabled(t: ProxyTariffItem) {
    if (!token) return;
    try {
      await api.updateProxyTariff(token, t.id, { enabled: !t.enabled });
      await loadCategories();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function loadSlots() {
    if (!token) return;
    setSlotsLoading(true);
    try {
      const res = await api.getProxySlotsAdmin(token);
      setSlots(res.items);
    } catch { setSlots([]); } finally { setSlotsLoading(false); }
  }

  function openSlotEdit(s: ProxySlotAdminItem) {
    setEditSlot(s);
    setSlotForm({ login: s.login, password: s.password, connectionLimit: s.connectionLimit != null ? String(s.connectionLimit) : "", status: s.status });
  }

  async function handleSaveSlot() {
    if (!token || !editSlot) return;
    setSaving(true);
    try {
      await api.updateProxySlotAdmin(token, editSlot.id, {
        login: slotForm.login.trim() || editSlot.login,
        password: slotForm.password || editSlot.password,
        connectionLimit: slotForm.connectionLimit.trim() === "" ? null : parseInt(slotForm.connectionLimit, 10),
        status: slotForm.status as "ACTIVE" | "EXPIRED" | "REVOKED",
      });
      await loadSlots();
      setEditSlot(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally { setSaving(false); }
  }

  async function handleRevokeSlot(id: string) {
    if (!token || !confirm("Отозвать доступ? Слот станет REVOKED.")) return;
    try {
      await api.updateProxySlotAdmin(token, id, { status: "REVOKED" });
      await loadSlots();
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function handleDeleteSlot(id: string) {
    if (!token || !confirm("Удалить слот? Это нельзя отменить.")) return;
    try {
      await api.deleteProxySlotAdmin(token, id);
      await loadSlots();
    } catch (e) { alert(e instanceof Error ? e.message : "Ошибка"); }
  }

  useEffect(() => {
    if (activeTab === "categories" || activeTab === "tariffs") loadCategories();
    if (activeTab === "slots") loadSlots();
  }, [activeTab, token]);

  async function handleAddNode() {
    if (!token || !newNodeName.trim()) return;
    setCreating(true);
    setAddResult(null);
    try {
      const res = await api.createProxyNode(token, { name: newNodeName.trim() });
      setAddResult(res);
      await loadNodes();
    } catch {
      setAddResult(null);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(node: ProxyNodeListItem) {
    setEditingNode(node);
    setEditName(node.name || "");
    setEditStatus(node.status);
    setEditCapacity(node.capacity != null ? String(node.capacity) : "");
    setEditSocksPort(String(node.socksPort));
    setEditHttpPort(String(node.httpPort));
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!token || !editingNode) return;
    setSaving(true);
    try {
      await api.updateProxyNode(token, editingNode.id, {
        name: editName.trim() || editingNode.name,
        status: editStatus,
        capacity: editCapacity.trim() === "" ? null : parseInt(editCapacity, 10) || null,
        socksPort: parseInt(editSocksPort, 10) || 1080,
        httpPort: parseInt(editHttpPort, 10) || 8080,
      });
      await loadNodes();
      setEditOpen(false);
      setEditingNode(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !nodeToDelete) return;
    setDeleting(true);
    try {
      await api.deleteProxyNode(token, nodeToDelete.id);
      await loadNodes();
      setNodeToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function closeAddDialog() {
    setAddOpen(false);
    setAddResult(null);
    setNewNodeName("");
    setCopied(null);
  }

  function copyToClipboard(text: string, which: "compose" | "token" | "script") {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const publicUrl = typeof window !== "undefined" ? window.location.origin : "";
  const composeWithUrl = addResult?.dockerCompose.replace("{{STEALTHNET_API_URL}}", publicUrl) ?? addResult?.dockerCompose ?? "";

  const installScript = addResult
    ? `mkdir -p /opt/proxy-node && cat > /opt/proxy-node/docker-compose.yml << '${HEREDOC_MARKER}'
${composeWithUrl}
${HEREDOC_MARKER}

cd /opt/proxy-node && docker compose up -d --build`
    : "";

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
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Прокси
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Ноды, категории и тарифы для продажи прокси</p>
          </div>
        </div>
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3 bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/5 rounded-xl p-1">
          <TabsTrigger value="nodes" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Server className="h-4 w-4" /> Ноды
          </TabsTrigger>
          <TabsTrigger value="slots" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Users className="h-4 w-4" /> Слоты
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md">
            <Layers className="h-4 w-4" /> Категории и тарифы
          </TabsTrigger>
        </TabsList>

      <TabsContent value="nodes" className="mt-4 space-y-5">
      {nodes.length > 0 && (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Нагрузка и трафик по нодам</h3>
              <p className="text-xs text-muted-foreground">Текущее состояние: трафик, подключения, слотов</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Трафик (МБ)</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nodes.map((n) => ({ name: n.name || n.id.slice(0, 8), trafficMb: (Number(n.trafficInBytes) + Number(n.trafficOutBytes)) / (1024 * 1024), fill: n.status === "ONLINE" ? "#10b981" : n.status === "DISABLED" ? "#f59e0b" : "#94a3b8" }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `${v}`} />
                    <Tooltip
                      contentStyle={{ background: "rgba(10,10,20,0.85)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "12px", color: "white", fontSize: "12px" }}
                      formatter={(v) => [`${(Number(v) || 0).toFixed(1)} МБ`, "Трафик"]}
                    />
                    <Bar dataKey="trafficMb" name="Трафик (МБ)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Подключения и слотов</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nodes.map((n) => ({ name: n.name || n.id.slice(0, 8), connections: n.currentConnections, slots: n.slotsCount }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-foreground/10" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip contentStyle={{ background: "rgba(10,10,20,0.85)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "12px", color: "white", fontSize: "12px" }} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="connections" name="Подключения" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="slots" name="Слотов" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Card>
      )}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Ноды</h3>
              <p className="text-xs text-muted-foreground">Статус «Онлайн» — нода шлёт heartbeat за последние 5 минут</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => token && api.downloadProxySlotsCsv(token).catch((e) => alert(e instanceof Error ? e.message : "Ошибка"))} className="gap-1.5 rounded-xl">
              <Download className="h-4 w-4" /> Экспорт CSV
            </Button>
            <Button
              size="sm"
              className="gap-1.5 rounded-xl"
              onClick={() => { setAddOpen(true); setAddResult(null); }}
              disabled={creating}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Добавить прокси
            </Button>
          </div>
        </div>
        <div>
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Загрузка…</p>
          ) : nodes.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              Нет нод. Нажмите «Добавить прокси», скопируйте docker-compose на сервер и запустите контейнер.
            </p>
          ) : (
            <div className="rounded-2xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Название</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Статус</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Хост / порты</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs">Слотов</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs">Подключения</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs">Трафик</th>
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Heartbeat</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs w-24">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => (
                      <tr key={n.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3">
                          <span className="font-medium">{n.name || "—"}</span>
                        </td>
                        <td className="py-3 px-3">{statusBadge(n.status)}</td>
                        <td className="py-3 px-3 font-mono text-xs text-muted-foreground">
                          {n.publicHost ?? "—"}:{n.socksPort}/{n.httpPort}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold">{n.slotsCount}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{n.currentConnections}</td>
                        <td className="py-3 px-3 text-right text-xs text-muted-foreground tabular-nums">
                          ↓{formatBytes(n.trafficInBytes)} ↑{formatBytes(n.trafficOutBytes)}
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">{formatDate(n.lastSeenAt)}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(n)} title="Редактировать">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" onClick={() => setNodeToDelete(n)} title="Удалить">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>
      </TabsContent>

      <TabsContent value="slots" className="mt-4">
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Users className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">Прокси-доступы пользователей</h3>
            <p className="text-xs text-muted-foreground">Все выданные слоты. Меняйте логин/пароль, лимит, отзывайте.</p>
          </div>
        </div>
        {slotsLoading ? (
          <p className="text-muted-foreground py-8 text-center">Загрузка...</p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">Нет выданных слотов.</p>
        ) : (
          <div className="rounded-2xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Клиент</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Нода</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Логин</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Пароль</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs">Лимит подкл.</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs">Трафик</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Статус</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs">Истекает</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs w-28">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-medium truncate">{s.clientEmail || s.clientTelegram || s.clientTelegramId || s.clientId.slice(0, 8)}</span>
                      </td>
                      <td className="py-3 px-3 text-xs">{s.nodeName || "—"}<br /><span className="text-muted-foreground font-mono">{s.publicHost ?? "—"}</span></td>
                      <td className="py-3 px-3 font-mono text-xs">{s.login}</td>
                      <td className="py-3 px-3 font-mono text-xs">{s.password}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{s.connectionLimit ?? "—"}</td>
                      <td className="py-3 px-3 text-right text-muted-foreground text-xs tabular-nums">{formatBytes(s.trafficUsedBytes)}{s.trafficLimitBytes ? ` / ${formatBytes(s.trafficLimitBytes)}` : ""}</td>
                      <td className="py-3 px-3">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md",
                          s.status === "ACTIVE" && "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
                          s.status === "REVOKED" && "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
                          s.status !== "ACTIVE" && s.status !== "REVOKED" && "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10",
                        )}>
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            s.status === "ACTIVE" && "bg-emerald-400 shadow-[0_0_4px_#10b981]",
                            s.status === "REVOKED" && "bg-red-400",
                            s.status !== "ACTIVE" && s.status !== "REVOKED" && "bg-muted-foreground/40",
                          )} />
                          {s.status === "ACTIVE" ? "Активен" : s.status === "REVOKED" ? "Отозван" : "Истёк"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">{formatDate(s.expiresAt)}</td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openSlotEdit(s)} title="Редактировать">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {s.status === "ACTIVE" && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-amber-500 dark:text-amber-400 hover:bg-amber-500/10" onClick={() => handleRevokeSlot(s.id)} title="Отозвать">
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" onClick={() => handleDeleteSlot(s.id)} title="Удалить">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
      </TabsContent>

      <TabsContent value="categories" className="mt-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <p className="text-muted-foreground text-sm">
            Категории группируют тарифы. В каждой — свои тарифы (количество прокси, срок, цена).
          </p>
          <Button onClick={() => setCategoryModal("add")} size="sm" className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" /> Добавить категорию
          </Button>
        </div>
        {categoriesLoading ? (
          <p className="text-muted-foreground py-8 text-center">Загрузка…</p>
        ) : categories.length === 0 ? (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
              <Layers className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground mb-4">Нет категорий. Создайте категорию, затем добавьте тарифы.</p>
            <Button onClick={() => setCategoryModal("add")} className="gap-1.5 rounded-xl">
              <Plus className="h-4 w-4" /> Создать категорию
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => (
              <Card key={cat.id} className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/5 bg-foreground/[0.02] dark:bg-white/[0.02]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                      <Layers className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                    </div>
                    <h3 className="text-base font-bold tracking-tight truncate">{cat.name}</h3>
                  </div>
                  <div className="flex gap-2 flex-wrap shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setCategoryModal({ edit: cat })} className="gap-1.5 rounded-xl">
                      <Pencil className="h-3.5 w-3.5" /> Изменить
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50" onClick={() => handleDeleteCategory(cat.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Удалить
                    </Button>
                    <Button size="sm" onClick={() => setTariffModal({ kind: "add", categoryId: cat.id })} className="gap-1.5 rounded-xl">
                      <Plus className="h-3.5 w-3.5" /> Тариф
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  {cat.tariffs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Нет тарифов. Нажмите «Тариф», чтобы добавить.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cat.tariffs.map((t) => (
                        <motion.li
                          key={t.id}
                          whileHover={{ y: -1 }}
                          className={cn(
                            "rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md transition-all",
                            t.enabled
                              ? "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] hover:border-white/20"
                              : "border-amber-500/20 bg-amber-500/[0.04] hover:border-amber-500/30"
                          )}
                        >
                          <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shrink-0">
                              <Tag className="h-4 w-4 text-primary" />
                            </div>
                            <span className="font-semibold truncate">{t.name}</span>
                            <span className="text-xs text-muted-foreground">{t.proxyCount} прокси</span>
                            <span className="text-xs text-muted-foreground">{t.durationDays} дн.</span>
                            <span className="text-sm font-bold text-emerald-500 dark:text-emerald-400">{formatPrice(t.price, t.currency)}</span>
                            <span className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              t.enabled
                                ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"
                            )}>
                              {t.enabled ? "Вкл" : "Выкл"}
                            </span>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => handleToggleTariffEnabled(t)} title={t.enabled ? "Выключить" : "Включить"}>
                              {t.enabled ? "Выкл" : "Вкл"}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setTariffModal({ kind: "edit", category: cat, tariff: t })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" onClick={() => handleDeleteTariff(t.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      </TabsContent>

      </Tabs>

      <Dialog open={addOpen} onOpenChange={(open) => !open && closeAddDialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Добавить прокси-ноду
            </DialogTitle>
            <DialogDescription>
              {addResult
                ? "Скопируйте docker-compose ниже на сервер. Замените URL панели, если нужно. Затем выполните: docker compose up -d"
                : "Нажмите кнопку — будет создана запись и сгенерирован токен. Вы получите готовый docker-compose для запуска на своём сервере."}
            </DialogDescription>
          </DialogHeader>
          {!addResult ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="proxy-node-name">Название ноды</Label>
                <Input
                  id="proxy-node-name"
                  placeholder="Например: Нода 1 или proxy-eu"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeAddDialog}>
                  Отмена
                </Button>
                <Button onClick={handleAddNode} disabled={creating || !newNodeName.trim()}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Сгенерировать токен и docker-compose
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Команда для установки на сервере</p>
                <p className="text-sm text-muted-foreground mb-2">
                  Выполните на сервере (создаёт папку /opt/proxy-node, записывает в неё docker-compose и запускает контейнер):
                </p>
                <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-48">
                  {installScript}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => copyToClipboard(installScript, "script")}
                >
                  {copied === "script" ? <Check className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
                  Копировать команду
                </Button>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Токен ноды (уже подставлен в compose)</p>
                <div className="flex gap-2">
                  <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-xs break-all">{addResult.node.token}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(addResult.node.token, "token")}
                  >
                    {copied === "token" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Docker Compose (для ручного копирования)</p>
                <pre className="rounded-lg bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-40">
                  {composeWithUrl}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => copyToClipboard(composeWithUrl, "compose")}
                >
                  {copied === "compose" ? <Check className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
                  Копировать docker-compose
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={closeAddDialog}>Готово</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать ноду</DialogTitle>
            <DialogDescription>Измените название, статус или лимит слотов.</DialogDescription>
          </DialogHeader>
          {editingNode && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Название</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="edit-status">Статус</Label>
                <select
                  id="edit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="ONLINE">Онлайн</option>
                  <option value="OFFLINE">Офлайн</option>
                  <option value="DISABLED">Отключена</option>
                </select>
              </div>
              <div>
                <Label htmlFor="edit-capacity">Макс. слотов (пусто — без лимита)</Label>
                <Input
                  id="edit-capacity"
                  type="number"
                  min={0}
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(e.target.value)}
                  placeholder="Не ограничено"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-socks-port">Порт SOCKS5</Label>
                  <Input id="edit-socks-port" type="number" min={1} max={65535} value={editSocksPort} onChange={(e) => setEditSocksPort(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="edit-http-port">Порт HTTP</Label>
                  <Input id="edit-http-port" type="number" min={1} max={65535} value={editHttpPort} onChange={(e) => setEditHttpPort(e.target.value)} className="mt-1" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!nodeToDelete} onOpenChange={(open) => !open && setNodeToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить ноду?</DialogTitle>
            <DialogDescription>
              Нода «{nodeToDelete?.name || "—"}» и все её слоты будут удалены. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {categoryModal && (
        <ProxyCategoryModal
          token={token}
          modal={categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={() => { setCategoryModal(null); loadCategories(); }}
          saving={saving}
          setSaving={setSaving}
        />
      )}

      <Dialog open={!!editSlot} onOpenChange={(open) => !open && setEditSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Редактировать слот</DialogTitle>
            <DialogDescription>
              Клиент: {editSlot?.clientEmail || editSlot?.clientTelegram || "—"} / Нода: {editSlot?.nodeName || "—"}
            </DialogDescription>
          </DialogHeader>
          {editSlot && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="slot-login">Логин</Label>
                <Input id="slot-login" value={slotForm.login} onChange={(e) => setSlotForm((f) => ({ ...f, login: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="slot-password">Пароль</Label>
                <Input id="slot-password" value={slotForm.password} onChange={(e) => setSlotForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="slot-connlimit">Лимит подключений (пусто — без лимита)</Label>
                <Input id="slot-connlimit" type="number" min={0} value={slotForm.connectionLimit} onChange={(e) => setSlotForm((f) => ({ ...f, connectionLimit: e.target.value }))} placeholder="Без лимита" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="slot-status">Статус</Label>
                <select id="slot-status" value={slotForm.status} onChange={(e) => setSlotForm((f) => ({ ...f, status: e.target.value }))} className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                  <option value="ACTIVE">Активен</option>
                  <option value="REVOKED">Отозван</option>
                  <option value="EXPIRED">Истёк</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSlot(null)}>Отмена</Button>
            <Button onClick={handleSaveSlot} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tariffModal && (
        <ProxyTariffModal
          token={token}
          nodes={nodes}
          categories={categories}
          modal={tariffModal}
          onClose={() => setTariffModal(null)}
          onSaved={() => { setTariffModal(null); loadCategories(); }}
          saving={saving}
          setSaving={setSaving}
        />
      )}
    </div>
  );
}

function ProxyCategoryModal({
  token,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  modal: "add" | { edit: ProxyCategoryItem };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal !== "add";
  const editCat = isEdit ? modal.edit : null;
  const [name, setName] = useState(editCat?.name ?? "");

  useEffect(() => {
    setName(isEdit && editCat ? editCat.name : "");
  }, [modal, isEdit, editCat?.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    try {
      if (isEdit && editCat) {
        await api.updateProxyCategory(token, editCat.id, { name: name.trim() });
      } else {
        await api.createProxyCategory(token, { name: name.trim() });
      }
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать категорию" : "Новая категория"}</DialogTitle>
          <DialogDescription>Например: Прокси РФ, Прокси EU.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="proxy-cat-name">Название</Label>
              <Input
                id="proxy-cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Прокси РФ"
                className="mt-1"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CURRENCIES = [{ value: "RUB", label: "RUB" }, { value: "USD", label: "USD" }];

function ProxyTariffModal({
  token,
  nodes,
  categories,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  nodes: ProxyNodeListItem[];
  categories: ProxyCategoryItem[];
  modal: { kind: "add"; categoryId: string } | { kind: "edit"; category: ProxyCategoryItem; tariff: ProxyTariffItem };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal.kind === "edit";
  const tariff = isEdit ? modal.tariff : null;
  const categoryId = isEdit ? modal.category.id : modal.categoryId;

  const [name, setName] = useState(tariff?.name ?? "");
  const [proxyCount, setProxyCount] = useState(tariff?.proxyCount ?? 1);
  const [durationDays, setDurationDays] = useState(tariff?.durationDays ?? 30);
  const [price, setPrice] = useState(tariff != null ? String(tariff.price) : "100");
  const [currency, setCurrency] = useState((tariff?.currency ?? "RUB").toUpperCase());
  const [enabled, setEnabled] = useState(tariff?.enabled ?? true);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(tariff?.nodeIds ?? []);

  useEffect(() => {
    if (isEdit && tariff) {
      setName(tariff.name);
      setProxyCount(tariff.proxyCount);
      setDurationDays(tariff.durationDays);
      setPrice(String(tariff.price));
      setCurrency((tariff.currency ?? "RUB").toUpperCase());
      setEnabled(tariff.enabled);
      setSelectedNodeIds(tariff.nodeIds ?? []);
    } else {
      setName("");
      setProxyCount(1);
      setDurationDays(30);
      setPrice("100");
      setCurrency("RUB");
      setEnabled(true);
      setSelectedNodeIds([]);
    }
  }, [modal, isEdit, tariff]);

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      alert("Введите корректную цену");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && tariff) {
        await api.updateProxyTariff(token, tariff.id, {
          name: name.trim(),
          proxyCount,
          durationDays,
          price: priceNum,
          currency,
          enabled,
          nodeIds: selectedNodeIds,
        });
      } else {
        await api.createProxyTariff(token, {
          categoryId,
          name: name.trim(),
          proxyCount,
          durationDays,
          price: priceNum,
          currency,
          enabled: enabled ?? true,
          nodeIds: selectedNodeIds.length > 0 ? selectedNodeIds : undefined,
        });
      }
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const cat = categories.find((c) => c.id === categoryId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать тариф" : "Новый тариф"}</DialogTitle>
          <DialogDescription>
            {cat ? `Категория: ${cat.name}` : "Тариф добавляется в выбранную категорию."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="proxy-t-name">Название</Label>
              <Input
                id="proxy-t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="1 прокси 30 дней"
                className="mt-1"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="proxy-t-count">Кол-во прокси</Label>
                <Input
                  id="proxy-t-count"
                  type="number"
                  min={1}
                  value={proxyCount}
                  onChange={(e) => setProxyCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="proxy-t-days">Срок (дней)</Label>
                <Input
                  id="proxy-t-days"
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="proxy-t-price">Цена</Label>
                <Input
                  id="proxy-t-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="proxy-t-currency">Валюта</Label>
                <select
                  id="proxy-t-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="proxy-t-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <Label htmlFor="proxy-t-enabled" className="cursor-pointer">Включён (отображается в боте и кабинете)</Label>
            </div>
            <div>
              <Label className="mb-2 block">Ноды (только выбранные будут использоваться для этого тарифа; если пусто — все ноды)</Label>
              {nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет нод. Добавьте ноды во вкладке «Ноды».</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
                  {nodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                      <Checkbox
                        checked={selectedNodeIds.includes(n.id)}
                        onCheckedChange={() => toggleNode(n.id)}
                      />
                      <span className="text-sm truncate">{n.name || n.id}</span>
                      <span className="text-xs text-muted-foreground truncate">{n.publicHost ?? "—"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
