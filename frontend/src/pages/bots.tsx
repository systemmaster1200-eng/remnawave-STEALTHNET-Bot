import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Crown,
  Users,
  Percent,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminBotListItem, type BotPayoutDto } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function fmtCur(amount: number, cur: string): string {
  return `${amount.toFixed(2)} ${cur.toUpperCase()}`;
}

function earningsLine(e: AdminBotListItem["earnings"]): string {
  const parts = Object.keys(e.balanceByCurrency);
  if (!parts.length) return `${(e.balance ?? 0).toFixed(2)}`;
  return parts.map((c) => fmtCur(e.balanceByCurrency[c] ?? 0, c)).join(" · ");
}

export function BotsPage() {
  const token = useAuth().state.accessToken!;
  const [items, setItems] = useState<AdminBotListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTab, setEditTab] = useState<"params" | "payouts">("params");
  const [selected, setSelected] = useState<AdminBotListItem | null>(null);

  const [payouts, setPayouts] = useState<BotPayoutDto[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const [cToken, setCToken] = useState("");
  const [cUsername, setCUsername] = useState("");
  const [cMarkup, setCMarkup] = useState("0");
  const [cOwnerTg, setCOwnerTg] = useState("");
  const [cOwnerName, setCOwnerName] = useState("");
  const [cNotes, setCNotes] = useState("");

  const [eToken, setEToken] = useState("");
  const [eUsername, setEUsername] = useState("");
  const [eMarkup, setEMarkup] = useState("0");
  const [eOwnerTg, setEOwnerTg] = useState("");
  const [eOwnerName, setEOwnerName] = useState("");
  const [eNotes, setENotes] = useState("");
  const [eActive, setEActive] = useState(true);

  const [pAmount, setPAmount] = useState("");
  const [pCurrency, setPCurrency] = useState("rub");
  const [pComment, setPComment] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { items: rows } = await api.getAdminBots(token);
      setItems(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const loadPayouts = async (botId: string) => {
    try {
      setPayoutsLoading(true);
      const { items: p } = await api.getAdminBotPayouts(token, botId);
      setPayouts(p);
    } catch {
      setPayouts([]);
    } finally {
      setPayoutsLoading(false);
    }
  };

  function openCreate() {
    setError(null);
    setCToken("");
    setCUsername("");
    setCMarkup("0");
    setCOwnerTg("");
    setCOwnerName("");
    setCNotes("");
    setCreateOpen(true);
  }

  function openEdit(bot: AdminBotListItem) {
    setError(null);
    setSelected(bot);
    setEditTab("params");
    setEToken("");
    setEUsername(bot.username ?? "");
    setEMarkup(String(bot.markupPercent));
    setEOwnerTg(bot.ownerTelegramId ?? "");
    setEOwnerName(bot.ownerName ?? "");
    setENotes(bot.notes ?? "");
    setEActive(bot.isActive);
    setPAmount("");
    setPCurrency("rub");
    setPComment("");
    setEditOpen(true);
    void loadPayouts(bot.id);
  }

  async function handleCreate() {
    const tok = cToken.trim();
    if (tok.length < 20) {
      setError("Токен бота слишком короткий (мин. 20 символов)");
      return;
    }
    const markup = Number(cMarkup);
    if (Number.isNaN(markup) || markup < 0 || markup > 1000) {
      setError("Наценка: число от 0 до 1000");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createAdminBot(token, {
        token: tok,
        username: cUsername.trim() || undefined,
        markupPercent: markup,
        ownerTelegramId: cOwnerTg.trim() || undefined,
        ownerName: cOwnerName.trim() || undefined,
        notes: cNotes.trim() || undefined,
      });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать бота");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!selected) return;
    const markup = Number(eMarkup);
    if (Number.isNaN(markup) || markup < 0 || markup > 1000) {
      setError("Наценка: число от 0 до 1000");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.updateAdminBot>[2] = {
        markupPercent: markup,
        isActive: eActive,
        ownerTelegramId: eOwnerTg.trim() || null,
        ownerName: eOwnerName.trim() || null,
        notes: eNotes.trim() || null,
      };
      const u = eUsername.trim();
      patch.username = u.length ? u : null;
      const nt = eToken.trim();
      if (nt.length >= 20) patch.token = nt;

      await api.updateAdminBot(token, selected.id, patch);
      setEditOpen(false);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(bot: AdminBotListItem) {
    if (!window.confirm(`Удалить бота ${bot.username ?? bot.id}? Только если нет клиентов.`)) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteAdminBot(token, bot.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Удаление невозможно");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPayout() {
    if (!selected) return;
    const amt = Number(pAmount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Укажите положительную сумму выплаты");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createAdminBotPayout(token, selected.id, {
        amount: amt,
        currency: pCurrency.trim().toLowerCase() || "rub",
        comment: pComment.trim() || undefined,
      });
      setPAmount("");
      setPComment("");
      await loadPayouts(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка записи выплаты");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePayout(p: BotPayoutDto) {
    if (!selected) return;
    if (!window.confirm("Удалить запись о выплате?")) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteAdminBotPayout(token, selected.id, p.id);
      await loadPayouts(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-cyan-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-cyan-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Боты-клоны
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Отдельные Telegram-боты с наценкой; рефералка от суммы без наценки. Основной бот нельзя удалить.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить клона
        </Button>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400 flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </motion.div>
      )}

      {loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </Card>
      ) : !items.length ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 text-center text-muted-foreground">
          Нет записей ботов
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((b, i) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card
                className={cn(
                  "relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-4 sm:p-5 shadow-lg",
                  !b.isActive && "opacity-75",
                )}
              >
                <div
                  className={cn(
                    "absolute left-0 top-0 bottom-0 w-1 rounded-r-full",
                    b.isPrimary ? "bg-amber-500/80" : "bg-primary/50",
                  )}
                />
                <div className="pl-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {b.isPrimary && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-lg">
                          <Crown className="h-3 w-3" />
                          Основной
                        </span>
                      )}
                      <span className="font-mono text-sm text-muted-foreground truncate">{b.token}</span>
                      {b.username && (
                        <span className="text-sm font-medium">@{b.username}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Percent className="h-3.5 w-3.5" />
                        Наценка {b.markupPercent}%
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        Клиентов: {b.clientsCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Wallet className="h-3.5 w-3.5" />
                        К выплате: {earningsLine(b.earnings)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={() => openEdit(b)}>
                      <Pencil className="h-4 w-4" />
                      Изменить
                    </Button>
                    {!b.isPrimary && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-1 text-destructive hover:text-destructive"
                        disabled={b.clientsCount > 0 || saving}
                        onClick={() => handleDelete(b)}
                        title={b.clientsCount > 0 ? "Сначала перенесите или удалите клиентов" : undefined}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>Новый бот-клон</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Токен Telegram</Label>
              <Input
                className="rounded-xl mt-1 font-mono text-xs"
                value={cToken}
                onChange={(e) => setCToken(e.target.value)}
                placeholder="1234567890:ABC..."
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Username (без @), опционально</Label>
              <Input
                className="rounded-xl mt-1"
                value={cUsername}
                onChange={(e) => setCUsername(e.target.value.replace(/^@/, ""))}
                placeholder="my_clone_bot"
              />
            </div>
            <div>
              <Label>Наценка, %</Label>
              <Input
                type="number"
                min={0}
                max={1000}
                className="rounded-xl mt-1"
                value={cMarkup}
                onChange={(e) => setCMarkup(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Telegram ID владельца</Label>
                <Input className="rounded-xl mt-1" value={cOwnerTg} onChange={(e) => setCOwnerTg(e.target.value)} placeholder="опционально" />
              </div>
              <div>
                <Label>Имя владельца</Label>
                <Input className="rounded-xl mt-1" value={cOwnerName} onChange={(e) => setCOwnerName(e.target.value)} placeholder="опционально" />
              </div>
            </div>
            <div>
              <Label>Заметки</Label>
              <Textarea className="rounded-xl mt-1 min-h-[72px]" value={cNotes} onChange={(e) => setCNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="rounded-xl">
              Отмена
            </Button>
            <Button onClick={handleCreate} disabled={saving} className="rounded-xl gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>
              {selected?.isPrimary ? "Основной бот" : "Клон"}
              {selected?.username ? ` @${selected.username}` : ""}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <Tabs value={editTab} onValueChange={(v) => setEditTab(v as "params" | "payouts")}>
              <TabsList className="w-full">
                <TabsTrigger value="params" className="flex-1">
                  Параметры
                </TabsTrigger>
                <TabsTrigger value="payouts" className="flex-1">
                  Выплаты
                </TabsTrigger>
              </TabsList>
              <TabsContent value="params" className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-muted/20 p-3 text-xs space-y-1">
                  <div className="text-muted-foreground">Маскированный токен в списке: {selected.token}</div>
                  <div className="text-muted-foreground">Клиентов: {selected.clientsCount}</div>
                  <div>К выплате (агрегат): {earningsLine(selected.earnings)}</div>
                </div>
                <div>
                  <Label>Новый токен (оставьте пустым, чтобы не менять)</Label>
                  <Input
                    className="rounded-xl mt-1 font-mono text-xs"
                    value={eToken}
                    onChange={(e) => setEToken(e.target.value)}
                    placeholder="не менять"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label>Username</Label>
                  <Input
                    className="rounded-xl mt-1"
                    value={eUsername}
                    onChange={(e) => setEUsername(e.target.value.replace(/^@/, ""))}
                  />
                </div>
                <div>
                  <Label>Наценка, %</Label>
                  <Input type="number" min={0} max={1000} className="rounded-xl mt-1" value={eMarkup} onChange={(e) => setEMarkup(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Telegram ID владельца</Label>
                    <Input className="rounded-xl mt-1" value={eOwnerTg} onChange={(e) => setEOwnerTg(e.target.value)} />
                  </div>
                  <div>
                    <Label>Имя владельца</Label>
                    <Input className="rounded-xl mt-1" value={eOwnerName} onChange={(e) => setEOwnerName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Заметки</Label>
                  <Textarea className="rounded-xl mt-1 min-h-[72px]" value={eNotes} onChange={(e) => setENotes(e.target.value)} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
                  <Label htmlFor="bot-active" className="cursor-pointer">
                    Активен
                  </Label>
                  <Switch id="bot-active" checked={eActive} onCheckedChange={setEActive} />
                </div>
              </TabsContent>
              <TabsContent value="payouts" className="space-y-4">
                <div className="rounded-xl border border-white/10 p-3 space-y-2">
                  <div className="text-sm font-medium">Записать выплату владельцу</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Сумма</Label>
                      <Input className="rounded-xl mt-1" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <Label>Валюта</Label>
                      <Input className="rounded-xl mt-1" value={pCurrency} onChange={(e) => setPCurrency(e.target.value)} placeholder="rub" />
                    </div>
                  </div>
                  <div>
                    <Label>Комментарий</Label>
                    <Input className="rounded-xl mt-1" value={pComment} onChange={(e) => setPComment(e.target.value)} />
                  </div>
                  <Button size="sm" className="rounded-xl" onClick={handleAddPayout} disabled={saving}>
                    Добавить выплату
                  </Button>
                </div>
                <div className="text-sm font-medium">История</div>
                {payoutsLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : !payouts.length ? (
                  <p className="text-sm text-muted-foreground">Пока нет записей</p>
                ) : (
                  <ul className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {payouts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-start justify-between gap-2 rounded-xl border border-white/10 bg-foreground/[0.02] px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium">
                            {fmtCur(p.amount, p.currency)} · {new Date(p.paidAt).toLocaleString()}
                          </div>
                          {p.comment && <div className="text-muted-foreground mt-0.5">{p.comment}</div>}
                          <div className="text-muted-foreground mt-0.5">{p.createdBy}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          onClick={() => handleDeletePayout(p)}
                          disabled={saving}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            {editTab === "params" && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-xl">
                  Закрыть
                </Button>
                <Button onClick={handleSaveEdit} disabled={saving} className="rounded-xl gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
              </>
            )}
            {editTab === "payouts" && (
              <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-xl">
                Закрыть
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
