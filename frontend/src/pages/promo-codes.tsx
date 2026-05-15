import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  PromoCodeRecord,
  PromoCodeDetail,
  CreatePromoCodePayload,
  UpdatePromoCodePayload,
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
  Eye,
  ChevronLeft,
  ToggleLeft,
  ToggleRight,
  Tag,
  Gift,
  Percent,
  Wand2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { MassPromoDialog } from "@/components/mass-promo-dialog";

interface Squad {
  uuid: string;
  name?: string;
}

function formatTraffic(bytes: string | number | null): string {
  if (!bytes) return "Без лимита";
  const b = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (!b || b <= 0) return "Без лимита";
  const gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} ГБ`;
  const mb = b / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

export function PromoCodesPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [codes, setCodes] = useState<PromoCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [squads, setSquads] = useState<Squad[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreatePromoCodePayload>({
    code: "",
    name: "",
    type: "DISCOUNT",
    discountPercent: null,
    discountFixed: null,
    squadUuid: null,
    trafficLimitBytes: "0",
    deviceLimit: null,
    durationDays: null,
    maxUses: 0,
    maxUsesPerClient: 1,
    isActive: true,
    expiresAt: null,
  });

  const [detail, setDetail] = useState<PromoCodeDetail | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showMassDialog, setShowMassDialog] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [codesRes, squadsRes] = await Promise.all([
        api.getPromoCodes(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
      ]);
      setCodes(codesRes);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s: { uuid?: string; name?: string }) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
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
      code: "",
      name: "",
      type: "DISCOUNT",
      discountPercent: null,
      discountFixed: null,
      squadUuid: squads[0]?.uuid ?? null,
      trafficLimitBytes: "0",
      deviceLimit: null,
      durationDays: 30,
      maxUses: 0,
      maxUsesPerClient: 1,
      isActive: true,
      expiresAt: null,
    });
    setShowForm(true);
  };

  const openEdit = (c: PromoCodeRecord) => {
    setEditingId(c.id);
    setForm({
      code: c.code,
      name: c.name,
      type: c.type,
      discountPercent: c.discountPercent,
      discountFixed: c.discountFixed,
      squadUuid: c.squadUuid,
      trafficLimitBytes: c.trafficLimitBytes,
      deviceLimit: c.deviceLimit,
      durationDays: c.durationDays,
      maxUses: c.maxUses,
      maxUsesPerClient: c.maxUsesPerClient,
      isActive: c.isActive,
      expiresAt: c.expiresAt,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        const { code: _code, ...rest } = form;
        await api.updatePromoCode(token, editingId, rest as UpdatePromoCodePayload);
      } else {
        await api.createPromoCode(token, form);
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
    if (!confirm("Удалить промокод? Все данные об использованиях будут удалены.")) return;
    try {
      await api.deletePromoCode(token, id);
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleToggleActive = async (c: PromoCodeRecord) => {
    try {
      await api.updatePromoCode(token, c.id, { isActive: !c.isActive });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await api.getPromoCode(token, id);
      setDetail(d);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getSquadName = (uuid: string | null) => {
    if (!uuid) return "—";
    const s = squads.find((sq) => sq.uuid === uuid);
    return s?.name || uuid.slice(0, 8) + "…";
  };

  function TypeBadge({ type }: { type: string }) {
    if (type === "DISCOUNT") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
          <Percent className="h-3 w-3" />
          Скидка
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
        <Gift className="h-3 w-3" />
        Бесплатные дни
      </span>
    );
  }

  function ActiveBadge({ isActive }: { isActive: boolean }) {
    return isActive ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
        Активен
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Неактивен
      </span>
    );
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем промокоды…</p>
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
              <Tag className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
                  {detail.name}
                </h1>
                <TypeBadge type={detail.type} />
                <ActiveBadge isActive={detail.isActive} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">Детали промокода и список использований</p>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Код</p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold truncate">{detail.code}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0" onClick={() => copyCode(detail.code)}>
                  {copiedCode === detail.code ? <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Использования</p>
              <p className="text-2xl font-bold tabular-nums">
                {detail.usagesCount}
                {detail.maxUses > 0 && <span className="text-base text-muted-foreground font-normal"> / {detail.maxUses}</span>}
              </p>
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Параметры</p>
              {detail.type === "DISCOUNT" ? (
                <p className="text-sm font-medium">
                  {detail.discountPercent ? `${detail.discountPercent}%` : ""}
                  {detail.discountPercent && detail.discountFixed ? " + " : ""}
                  {detail.discountFixed ? `${detail.discountFixed} фикс.` : ""}
                  {!detail.discountPercent && !detail.discountFixed ? "—" : ""}
                </p>
              ) : (
                <p className="text-sm font-medium">{detail.durationDays} дн. • {formatTraffic(detail.trafficLimitBytes)} • {detail.deviceLimit ?? "∞"} устр.</p>
              )}
            </Card>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300 }}>
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
              <p className="text-xs text-muted-foreground mb-2">Истекает</p>
              <p className="text-sm font-medium">{detail.expiresAt ? new Date(detail.expiresAt).toLocaleDateString("ru-RU") : "Бессрочно"}</p>
            </Card>
          </motion.div>
        </div>

        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
              <Users className="h-5 w-5 text-cyan-500 dark:text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Использования ({detail.usages.length})</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Список клиентов, которые использовали промокод</p>
            </div>
          </div>
          {detail.usages.length === 0 ? (
            <div className="px-5 py-12 flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                <Tag className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">Промокод ещё не использовался.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Клиент</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Telegram</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Remna UUID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.usages.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium">{u.client.email || u.client.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.client.telegramUsername ? `@${u.client.telegramUsername}` : u.client.telegramId || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.client.remnawaveUuid?.slice(0, 12) || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleString("ru-RU")}</td>
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
            <Tag className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Промокоды
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Промокоды на скидку при оплате или бесплатные дни подписки.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowMassDialog(true)} variant="outline" className="gap-1.5 rounded-xl">
            <Wand2 className="h-4 w-4" />
            Сгенерировать пачку
          </Button>
          <Button onClick={openCreate} className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Создать
          </Button>
        </div>
      </motion.div>

      <MassPromoDialog
        open={showMassDialog}
        onClose={() => setShowMassDialog(false)}
        onCreated={() => load()}
        squads={squads}
      />


      {codes.length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-12 shadow-xl">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <Tag className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight">Нет промокодов</h3>
            <p className="text-sm text-muted-foreground mt-1">Создайте первый промокод.</p>
            <Button onClick={openCreate} className="gap-1.5 rounded-xl mt-4">
              <Plus className="h-4 w-4" />
              Создать промокод
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {codes.map((c, idx) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              whileHover={{ y: -2 }}
            >
              <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-base tracking-tight">{c.name}</h3>
                      <TypeBadge type={c.type} />
                      <ActiveBadge isActive={c.isActive} />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <code className="font-mono text-xs bg-foreground/[0.04] dark:bg-white/[0.03] border border-white/5 px-2 py-0.5 rounded-md text-foreground">{c.code}</code>
                      <span className="text-muted-foreground/40">•</span>
                      {c.type === "DISCOUNT" ? (
                        <span className="inline-flex items-center gap-1">
                          {c.discountPercent ? <><Percent className="h-3 w-3" /> {c.discountPercent}%</> : null}
                          {c.discountFixed ? ` ${c.discountFixed} фикс.` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Gift className="h-3 w-3" /> {c.durationDays} дн. • {formatTraffic(c.trafficLimitBytes)} • {c.deviceLimit ?? "∞"} устр. • {getSquadName(c.squadUuid)}
                        </span>
                      )}
                      {c.expiresAt && (
                        <>
                          <span className="text-muted-foreground/40">•</span>
                          <span>до {new Date(c.expiresAt).toLocaleDateString("ru-RU")}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium tabular-nums">{c.usagesCount}</span>
                      {c.maxUses > 0 && <span className="text-muted-foreground tabular-nums">/ {c.maxUses}</span>}
                      <span className="text-muted-foreground">использований</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Копировать код" onClick={() => copyCode(c.code)}>
                      {copiedCode === c.code ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Подробнее" onClick={() => openDetail(c.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title={c.isActive ? "Деактивировать" : "Активировать"} onClick={() => handleToggleActive(c)}>
                      {c.isActive ? <ToggleRight className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" title="Редактировать" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" title="Удалить" onClick={() => handleDelete(c.id)}>
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
                <DialogTitle className="text-base font-bold tracking-tight">{editingId ? "Редактировать" : "Создать"} промокод</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">Тип, параметры и лимиты использования</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingId && (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Код промокода</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                  placeholder="SUMMER2026"
                  className="font-mono rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Название / описание</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Летняя акция -20%"
                className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Тип</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: "DISCOUNT" }))}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2",
                    form.type === "DISCOUNT"
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-500 dark:text-blue-400"
                      : "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Percent className="h-4 w-4" />
                  Скидка
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: "FREE_DAYS" }))}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2",
                    form.type === "FREE_DAYS"
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-500 dark:text-violet-400"
                      : "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Gift className="h-4 w-4" />
                  Бесплатные дни
                </button>
              </div>
            </div>

            {form.type === "DISCOUNT" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Скидка %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.discountPercent ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value === "" ? null : Number(e.target.value) }))}
                    placeholder="20"
                    className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Фикс. скидка (валюта)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.discountFixed ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, discountFixed: e.target.value === "" ? null : Number(e.target.value) }))}
                    placeholder="100"
                    className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                  />
                </div>
              </div>
            )}

            {form.type === "FREE_DAYS" && (
              <>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Сквад</Label>
                  <select
                    className="flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    value={form.squadUuid ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, squadUuid: e.target.value || null }))}
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
                      value={form.durationDays ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value === "" ? null : Number(e.target.value) || 1 }))}
                      className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">Трафик (ГБ, 0 = без лимита)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={Number(form.trafficLimitBytes ?? 0) / (1024 * 1024 * 1024) || 0}
                      onChange={(e) => setForm((f) => ({ ...f, trafficLimitBytes: String(Math.round((Number(e.target.value) || 0) * 1024 * 1024 * 1024)) }))}
                      className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Лимит устройств (пусто = без лимита)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.deviceLimit ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, deviceLimit: e.target.value === "" ? null : Number(e.target.value) || 0 }))}
                    className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Макс. использований (0 = ∞)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.maxUses}
                  onChange={(e) => setForm((f) => ({ ...f, maxUses: Number(e.target.value) || 0 }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Макс. на клиента</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.maxUsesPerClient}
                  onChange={(e) => setForm((f) => ({ ...f, maxUsesPerClient: Number(e.target.value) || 1 }))}
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Истекает (пусто = бессрочно)</Label>
              <Input
                type="date"
                value={form.expiresAt ? form.expiresAt.split("T")[0] : ""}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
            </div>

            <label htmlFor="code-active" className={cn(
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
                id="code-active"
              />
              <span className="text-sm font-medium">Активен</span>
            </label>

            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl">Отмена</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim() || (!editingId && !form.code.trim())} className="gap-2 rounded-xl">
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
