import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  Video, Plus, Trash2, Save, RefreshCw, ArrowUp, ArrowDown,
  Pencil, X, Check, Info, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Instruction {
  id: string;
  title: string;
  telegramFileId: string;
  sortOrder: number;
}

export function VideoInstructionsPage() {
  const { state } = useAuth();
  const token = state.accessToken!;

  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newFileId, setNewFileId] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFileId, setEditFileId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getVideoInstructions(token);
      setEnabled(res.enabled);
      setItems(res.items.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      setMessage("Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    setSaving(true);
    try {
      await api.toggleVideoInstructions(token, !enabled);
      setEnabled(!enabled);
      flash(!enabled ? "Видео-инструкции включены" : "Видео-инструкции выключены");
    } catch {
      flash("Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (!newTitle.trim() || !newFileId.trim()) return;
    setAdding(true);
    try {
      const res = await api.addVideoInstruction(token, newTitle.trim(), newFileId.trim());
      setItems(res.items.sort((a: Instruction, b: Instruction) => a.sortOrder - b.sortOrder));
      setNewTitle("");
      setNewFileId("");
      setShowForm(false);
      flash("Инструкция добавлена");
    } catch {
      flash("Ошибка добавления");
    } finally {
      setAdding(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Удалить эту инструкцию?")) return;
    try {
      const res = await api.deleteVideoInstruction(token, id);
      setItems(res.items.sort((a: Instruction, b: Instruction) => a.sortOrder - b.sortOrder));
      flash("Удалено");
    } catch {
      flash("Ошибка удаления");
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await api.updateVideoInstruction(token, editingId, {
        title: editTitle.trim(),
        telegramFileId: editFileId.trim(),
      });
      setItems(res.items.sort((a: Instruction, b: Instruction) => a.sortOrder - b.sortOrder));
      setEditingId(null);
      flash("Сохранено");
    } catch {
      flash("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function move(id: string, direction: "up" | "down") {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const newItems = [...items];
    [newItems[idx], newItems[swapIdx]] = [newItems[swapIdx], newItems[idx]];
    setItems(newItems);
    try {
      const res = await api.reorderVideoInstructions(token, newItems.map((i) => i.id));
      setItems(res.items.sort((a: Instruction, b: Instruction) => a.sortOrder - b.sortOrder));
    } catch {
      flash("Ошибка сортировки");
    }
  }

  function flash(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function startEdit(item: Instruction) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditFileId(item.telegramFileId);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загружаем инструкции…</p>
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
            <Video className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Видео-инструкции
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Кнопки с видео в разделе «Поддержка» бота</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {message && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-3 py-1 text-xs font-medium"
            >
              <Check className="h-3 w-3" />
              {message}
            </motion.span>
          )}
          <Button variant="ghost" size="icon" onClick={load} disabled={loading} className="rounded-full hover:bg-white/10">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin text-primary")} />
          </Button>
        </div>
      </motion.div>

      {/* Toggle card */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center shadow-inner border border-white/10 transition-colors",
              enabled
                ? "bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-500 dark:text-emerald-400"
                : "bg-gradient-to-br from-muted/40 to-muted/10 text-muted-foreground"
            )}>
              <Video className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-sm tracking-tight flex items-center gap-2">
                Видео-инструкции в боте
                {enabled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_4px_currentColor]" />
                    Активно
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabled ? "Кнопка «Инструкции» отображается в разделе «Поддержка»" : "Раздел скрыт от пользователей"}
              </p>
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
              enabled ? "translate-x-5" : "translate-x-0"
            )} />
          </button>
        </div>
      </Card>

      {/* Hint */}
      <div className="flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 backdrop-blur-md p-4 text-sm">
        <Info className="h-5 w-5 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-blue-600 dark:text-blue-400">Как получить file_id видео?</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Отправьте видео в бот — он ответит file_id. Можно переслать видео из любого чата — бот вернёт file_id.
          </p>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {items.length === 0 && !showForm && (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
              <Video className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">Инструкции ещё не добавлены</p>
          </Card>
        )}

        {items.map((item, idx) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
            whileHover={{ y: -1 }}
          >
            <Card className="group flex items-center gap-3 bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-3 shadow-lg hover:shadow-xl hover:border-white/20 transition-all">
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => move(item.id, "up")}
                  disabled={idx === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(item.id, "down")}
                  disabled={idx === items.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center">
                <Video className="h-5 w-5 text-primary" />
              </div>

              {editingId === item.id ? (
                <div className="flex-1 min-w-0 space-y-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Название кнопки"
                    className="h-8 text-sm rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                  />
                  <Input
                    value={editFileId}
                    onChange={(e) => setEditFileId(e.target.value)}
                    placeholder="Telegram file_id"
                    className="h-8 text-sm font-mono rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                  />
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 gap-1 text-xs rounded-lg" onClick={saveEdit} disabled={saving}>
                      <Check className="h-3 w-3" /> Сохранить
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs rounded-lg" onClick={() => setEditingId(null)}>
                      <X className="h-3 w-3" /> Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate mt-0.5" title={item.telegramFileId}>
                    {item.telegramFileId}
                  </p>
                </div>
              )}

              {editingId !== item.id && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => startEdit(item)} title="Редактировать">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10" onClick={() => deleteItem(item.id)} title="Удалить">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Add new */}
      {showForm ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight">Новая инструкция</p>
                <p className="text-xs text-muted-foreground">Название + Telegram file_id</p>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-xs text-muted-foreground">Название кнопки</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Инструкция по подключению"
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Telegram file_id видео</Label>
                <Input
                  value={newFileId}
                  onChange={(e) => setNewFileId(e.target.value)}
                  placeholder="BAACAgIAAxkBAAI..."
                  className="font-mono text-sm rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addItem} disabled={adding || !newTitle.trim() || !newFileId.trim()} className="gap-1.5 rounded-xl">
                <Save className="h-3.5 w-3.5" />
                {adding ? "Добавление…" : "Добавить"}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => { setShowForm(false); setNewTitle(""); setNewFileId(""); }}>
                Отмена
              </Button>
            </div>
          </Card>
        </motion.div>
      ) : (
        <Button variant="outline" onClick={() => setShowForm(true)} className="gap-2 rounded-xl">
          <Plus className="h-4 w-4" /> Добавить инструкцию
        </Button>
      )}
    </div>
  );
}
