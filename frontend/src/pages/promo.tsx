import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  PromoGroup,
  PromoGroupDetail,
  CreatePromoGroupPayload,
  UpdatePromoGroupPayload,
  AdminSettings,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Copy,
  Check,
  Users,
  Link2,
  Eye,
  ChevronLeft,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Squad {
  uuid: string;
  name?: string;
}

function formatTraffic(bytes: string | number): string {
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!b || b <= 0) return "Без лимита";
  const gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} ГБ`;
  const mb = b / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

export function PromoPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [groups, setGroups] = useState<PromoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Squads
  const [squads, setSquads] = useState<Squad[]>([]);

  // Create/Edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreatePromoGroupPayload>({
    name: "",
    squadUuid: "",
    trafficLimitBytes: "0",
    deviceLimit: null,
    durationDays: 30,
    maxActivations: 0,
    isActive: true,
  });

  // Detail view
  const [detail, setDetail] = useState<PromoGroupDetail | null>(null);
  const [, setDetailLoading] = useState(false);

  // Bot username for link
  const [botUsername, setBotUsername] = useState<string>("");

  // Copied state
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupsRes, squadsRes, settings] = await Promise.all([
        api.getPromoGroups(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
        api.getSettings(token).catch(() => null),
      ]);
      setGroups(groupsRes);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s: { uuid?: string; name?: string }) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
      setBotUsername((settings as AdminSettings)?.telegramBotUsername?.replace(/^@/, "") ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: "",
      squadUuid: squads[0]?.uuid ?? "",
      trafficLimitBytes: "0",
      deviceLimit: null,
      durationDays: 30,
      maxActivations: 0,
      isActive: true,
    });
    setShowForm(true);
  };

  const openEdit = (g: PromoGroup) => {
    setEditingId(g.id);
    setForm({
      name: g.name,
      squadUuid: g.squadUuid,
      trafficLimitBytes: g.trafficLimitBytes,
      deviceLimit: g.deviceLimit,
      durationDays: g.durationDays,
      maxActivations: g.maxActivations,
      isActive: g.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await api.updatePromoGroup(token, editingId, form as UpdatePromoGroupPayload);
      } else {
        await api.createPromoGroup(token, form);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить промо-группу? Все активации будут удалены.")) return;
    try {
      await api.deletePromoGroup(token, id);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleToggleActive = async (g: PromoGroup) => {
    try {
      await api.updatePromoGroup(token, g.id, { isActive: !g.isActive });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.getPromoGroup(token, id);
      setDetail(d);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setDetailLoading(false);
    }
  };

  const getPromoLink = (code: string) => {
    if (!botUsername) return `t.me/YOUR_BOT?start=promo_${code}`;
    return `https://t.me/${botUsername}?start=promo_${code}`;
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(getPromoLink(code));
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getSquadName = (uuid: string) => {
    const s = squads.find((sq) => sq.uuid === uuid);
    return s?.name || uuid.slice(0, 8) + "…";
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем промо-группы…</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
      </div>
    );
  }

  // Detail view
  if (detail) {
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
            <Button variant="ghost" size="icon" className="rounded-xl shrink-0" onClick={() => setDetail(null)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
              <Link2 className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
                  {detail.name}
                </h1>
                {detail.isActive ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                    Активна
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    Неактивна
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Детали промо-группы и список активаций</p>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Код</p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold truncate">{detail.code}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0" onClick={() => copyLink(detail.code)}>
                  {copiedCode === detail.code ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Активации</p>
              <p className="text-2xl font-bold tabular-nums">
                {detail.activationsCount}
                {detail.maxActivations > 0 && <span className="text-base text-muted-foreground font-normal"> / {detail.maxActivations}</span>}
              </p>
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Подписка</p>
              <p className="text-sm font-medium">{detail.durationDays} дн. • {formatTraffic(detail.trafficLimitBytes)} • {detail.deviceLimit ?? "∞"} устр.</p>
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Сквад</p>
              <p className="text-sm font-medium truncate">{getSquadName(detail.squadUuid)}</p>
            </Card>
          </motion.div>
        </div>

        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <Link2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Ссылка для бота</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Поделитесь этой ссылкой с пользователями</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm bg-foreground/[0.04] dark:bg-white/[0.03] border border-white/5 px-3 py-2 rounded-xl flex-1 select-all break-all font-mono min-w-[200px]">{getPromoLink(detail.code)}</code>
            <Button variant="outline" size="sm" onClick={() => copyLink(detail.code)} className="rounded-xl gap-1.5">
              {copiedCode === detail.code ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copiedCode === detail.code ? "Скопировано" : "Копировать"}
            </Button>
          </div>
        </Card>

        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <Users className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Активации ({detail.activations.length})</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Список клиентов, которые активировали промо-группу</p>
            </div>
          </div>
          {detail.activations.length === 0 ? (
            <div className="px-5 py-12 flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                <Users className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">Ещё никто не активировал этот промокод.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Клиент</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Telegram</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Remna UUID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Дата активации</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.activations.map((a) => (
                    <tr key={a.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{a.client.email || a.client.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.client.telegramUsername ? `@${a.client.telegramUsername}` : a.client.telegramId || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.client.remnawaveUuid?.slice(0, 12) || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(a.createdAt).toLocaleString("ru-RU")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
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
            <Link2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Промо-ссылки
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Создавайте промо-ссылки для раздачи бесплатных подписок через бота.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Создать
        </Button>
      </motion.div>

      {groups.length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-12 shadow-xl">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <Link2 className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">Нет промо-групп</h3>
            <p className="text-sm text-muted-foreground mt-1">Создайте первую промо-ссылку для раздачи подписок.</p>
            <Button onClick={openCreate} className="gap-1.5 rounded-xl mt-4">
              <Plus className="h-4 w-4" />
              Создать промо-группу
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groups.map((g, idx) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              whileHover={{ y: -2 }}
            >
              <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-base tracking-tight">{g.name}</h3>
                      {g.isActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                          Активна
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                          Неактивна
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <code className="font-mono text-xs bg-foreground/[0.04] dark:bg-white/[0.03] border border-white/5 px-2 py-0.5 rounded-md">{g.code}</code>
                      <span className="text-muted-foreground/40">•</span>
                      <span>{g.durationDays} дн.</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span>{formatTraffic(g.trafficLimitBytes)}</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span>{g.deviceLimit ?? "∞"} устр.</span>
                      <span className="text-muted-foreground/40">•</span>
                      <span>{getSquadName(g.squadUuid)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium tabular-nums">{g.activationsCount}</span>
                      {g.maxActivations > 0 && <span className="text-muted-foreground tabular-nums">/ {g.maxActivations}</span>}
                      <span className="text-muted-foreground">активаций</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Копировать ссылку" onClick={() => copyLink(g.code)}>
                      {copiedCode === g.code ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Подробнее" onClick={() => openDetail(g.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title={g.isActive ? "Деактивировать" : "Активировать"} onClick={() => handleToggleActive(g)}>
                      {g.isActive ? <ToggleRight className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать" onClick={() => openEdit(g)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить" onClick={() => handleDelete(g.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                {editingId ? <Pencil className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <DialogTitle className="text-base font-bold tracking-tight">{editingId ? "Редактировать" : "Создать"} промо-группу</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Параметры подписки и лимиты активаций</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Промо для блогера X"
                className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Сквад</Label>
              <select
                className="flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                value={form.squadUuid}
                onChange={(e) => setForm((f) => ({ ...f, squadUuid: e.target.value }))}
              >
                <option value="">Выберите сквад</option>
                {squads.map((s) => (
                  <option key={s.uuid} value={s.uuid}>{s.name || s.uuid}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Дней подписки</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(e) => setForm((f) => ({ ...f, durationDays: Number(e.target.value) || 1 }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Макс. активаций (0 = ∞)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.maxActivations}
                  onChange={(e) => setForm((f) => ({ ...f, maxActivations: Number(e.target.value) || 0 }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Трафик (ГБ, 0 = без лимита)</Label>
                <Input
                  type="number"
                  min={0}
                  value={Number(form.trafficLimitBytes) / (1024 * 1024 * 1024) || 0}
                  onChange={(e) => setForm((f) => ({ ...f, trafficLimitBytes: String(Math.round((Number(e.target.value) || 0) * 1024 * 1024 * 1024)) }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Лимит устройств (пусто = ∞)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.deviceLimit ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, deviceLimit: e.target.value === "" ? null : Number(e.target.value) || 0 }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            </div>
            <label htmlFor="promo-active" className={cn(
              "flex items-center gap-2 cursor-pointer rounded-xl border px-3 py-2.5 transition-colors",
              form.isActive
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02]"
            )}>
              <input
                type="checkbox"
                checked={form.isActive ?? true}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded accent-emerald-500"
                id="promo-active"
              />
              <span className="text-sm font-medium">Активна</span>
            </label>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.squadUuid} className="gap-2 rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
