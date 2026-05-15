import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import {
  Download, Upload, AlertTriangle, Loader2, RotateCcw, HardDrive, Clock, Send, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BackupItem = { path: string; filename: string; date: string; size: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 3) return parts.slice(0, 3).join(".");
  return path;
}

export function BackupPage() {
  const { state } = useAuth();
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreFromPath, setRestoreFromPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [list, setList] = useState<BackupItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupCron, setAutoBackupCron] = useState("0 7 * * *");
  const [autoBackupSaving, setAutoBackupSaving] = useState(false);
  const [autoBackupSending, setAutoBackupSending] = useState(false);
  const [autoBackupMsg, setAutoBackupMsg] = useState<string | null>(null);

  const token = state.accessToken;
  if (!token) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function loadAutoBackupSettings() {
    const t = state.accessToken;
    if (!t) return;
    try {
      const s = await api.getSettings(t);
      setAutoBackupEnabled((s as any).autoBackupEnabled ?? false);
      setAutoBackupCron((s as any).autoBackupCron || "0 7 * * *");
    } catch { /* ignore */ }
  }

  async function saveAutoBackup() {
    const t = state.accessToken;
    if (!t) return;
    setAutoBackupSaving(true);
    try {
      await api.updateSettings(t, {
        autoBackupEnabled,
        autoBackupCron: autoBackupCron.trim() || "0 7 * * *",
      } as any);
      flashAutoBackup(autoBackupEnabled ? "Авто-бэкапы включены" : "Авто-бэкапы выключены");
    } catch {
      flashAutoBackup("Ошибка сохранения");
    } finally {
      setAutoBackupSaving(false);
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  async function sendBackupNow() {
    const t = state.accessToken;
    if (!t) return;
    setAutoBackupSending(true);
    try {
      const res = await api.sendBackupToTelegram(t);
      flashAutoBackup(res.message || "Бэкап отправлен");
      await loadList();
    } catch (e) {
      flashAutoBackup(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setAutoBackupSending(false);
    }
  }

  function flashAutoBackup(msg: string) {
    setAutoBackupMsg(msg);
    setTimeout(() => setAutoBackupMsg(null), 4000);
  }

  async function loadList() {
    const t = state.accessToken;
    if (!t) return;
    setListLoading(true);
    try {
      const res = await api.getBackupList(t);
      setList(res.items);
    } catch {
      setList([]);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadList();
    loadAutoBackupSettings();
  }, [state.accessToken]);

  async function handleCreateBackup() {
    const t = state.accessToken;
    if (!t) return;
    setError(null);
    setSuccess(null);
    setCreating(true);
    try {
      const { blob, filename } = await api.createBackup(t);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("Бэкап создан, сохранён на сервере и загружен.");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания бэкапа");
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(path: string) {
    const t = state.accessToken;
    if (!t) return;
    setError(null);
    try {
      const { blob, filename } = await api.downloadBackup(t, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка скачивания");
    }
  }

  function handleRestoreFromServer(path: string) {
    setRestoreFromPath(path);
    setError(null);
  }

  async function handleRestoreFromServerConfirm() {
    const t = state.accessToken;
    if (!restoreFromPath || !t) return;
    setError(null);
    setSuccess(null);
    setRestoring(true);
    setRestoreFromPath(null);
    try {
      const result = await api.restoreBackupFromServer(t, restoreFromPath);
      setSuccess(result.message);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

  function handleRestoreSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setSuccess(null);
    if (file) {
      if (!file.name.toLowerCase().endsWith(".sql")) {
        setError("Выберите файл бэкапа с расширением .sql");
        setRestoreFile(null);
        return;
      }
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    }
  }

  async function handleRestoreConfirm() {
    const t = state.accessToken;
    if (!restoreFile || !t) return;
    setError(null);
    setSuccess(null);
    setRestoring(true);
    setShowRestoreConfirm(false);
    try {
      const result = await api.restoreBackup(t, restoreFile);
      setSuccess(result.message);
      setRestoreFile(null);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      {/* Ambient orbs */}
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Бэкапы
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Создание и восстановление БД. Бэкапы хранятся на сервере по дням.</p>
          </div>
        </div>
      </motion.div>

      {/* Status messages */}
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
      {success && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-md px-4 py-3 text-sm text-emerald-500 dark:text-emerald-400"
        >
          {success}
        </motion.div>
      )}

      {/* Action cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <Download className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-tight">Создать бэкап</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Дамп БД сохранится на сервере и скачается файлом.
                </p>
              </div>
            </div>
            <Button onClick={handleCreateBackup} disabled={creating} className="mt-4 w-full gap-2">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создание…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Создать и скачать
                </>
              )}
            </Button>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl h-full">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <Upload className="h-6 w-6 text-amber-500 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-tight">Восстановить из файла</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Загрузите .sql — текущие данные будут заменены.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <input
                type="file"
                accept=".sql"
                onChange={handleRestoreSelect}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-amber-500/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-amber-600 dark:file:text-amber-400 file:cursor-pointer hover:file:bg-amber-500/20 file:transition-colors"
                disabled={restoring}
              />
              {restoring && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Восстановление…
                </p>
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Auto-backup card */}
      <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 sm:p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className={cn(
            "h-12 w-12 rounded-2xl flex items-center justify-center shadow-inner border border-white/10 shrink-0 transition-colors",
            autoBackupEnabled
              ? "bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-500 dark:text-emerald-400"
              : "bg-gradient-to-br from-muted/40 to-muted/10 text-muted-foreground"
          )}>
            <Clock className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold tracking-tight flex items-center gap-2">
              Авто-бэкап в Telegram
              {autoBackupEnabled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_4px_currentColor]" />
                  Активно
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              SQL-бэкап в Telegram-группу по cron. Топик «Авто-бэкапы» в Настройки → Уведомления.
            </p>
          </div>
          <button
            onClick={() => setAutoBackupEnabled((v) => !v)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              autoBackupEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
              autoBackupEnabled ? "translate-x-5" : "translate-x-0"
            )} />
          </button>
        </div>

        <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Расписание (cron)</Label>
            <Input
              value={autoBackupCron}
              onChange={(e) => setAutoBackupCron(e.target.value)}
              placeholder="0 7 * * *"
              className="max-w-xs font-mono text-sm h-9 rounded-xl bg-background/60 border-white/10 focus-visible:ring-primary/50"
            />
            <p className="text-[11px] text-muted-foreground">
              По умолчанию: <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">0 7 * * *</code> — каждый день в 7:00 UTC
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={saveAutoBackup} disabled={autoBackupSaving}>
              {autoBackupSaving ? "Сохранение…" : "Сохранить"}
            </Button>
            <Button variant="outline" size="sm" onClick={sendBackupNow} disabled={autoBackupSending} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              {autoBackupSending ? "Отправка…" : "Отправить сейчас"}
            </Button>
            {autoBackupMsg && (
              <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">{autoBackupMsg}</span>
            )}
          </div>
        </div>
      </Card>

      {/* Saved backups list */}
      <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 sm:p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <HardDrive className="h-6 w-6 text-cyan-500 dark:text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Сохранённые на сервере</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Бэкапы по дням — скачать или восстановить.</p>
          </div>
        </div>

        {listLoading ? (
          <div className="py-12 flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Загрузка списка…</p>
          </div>
        ) : list.length === 0 ? (
          <div className="py-12 text-center">
            <HardDrive className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Нет сохранённых бэкапов. Создайте первый.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs">Дата</th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs">Файл</th>
                    <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs">Размер</th>
                    <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((item) => (
                    <tr key={item.path} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-mono text-muted-foreground text-xs">{formatDate(item.date)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{item.filename}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium border border-white/10">
                          {formatSize(item.size)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(item.path)} className="gap-1 h-8 rounded-lg">
                          <Download className="h-3.5 w-3.5" />
                          Скачать
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-8 rounded-lg border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                          onClick={() => handleRestoreFromServer(item.path)}
                          disabled={restoring}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Восстановить
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Confirm dialogs */}
      <Dialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>Восстановить из загруженного файла?</DialogTitle>
            <DialogDescription>
              Текущие данные в базе будут заменены содержимым выбранного файла. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRestoreConfirm(false)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreConfirm}>Восстановить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreFromPath} onOpenChange={(open) => !open && setRestoreFromPath(null)}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>Восстановить из бэкапа на сервере?</DialogTitle>
            <DialogDescription>
              База будет заменена выбранным бэкапом. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreFromPath(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleRestoreFromServerConfirm} disabled={restoring}>
              Восстановить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
