import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, Copy, Key, Loader2, Plus, Power, Trash2, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/auth";
import { api, type ApiKeyListItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ApiKeysPage() {
  const token = useAuth().state.accessToken!;
  const [items, setItems] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getApiKeys(token);
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки ключей");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const createKey = async () => {
    if (!name.trim()) return;
    try {
      setCreating(true);
      const data = await api.createApiKey(token, { name: name.trim(), description: description.trim() || undefined });
      setNewKey(data.rawKey);
      setName("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания ключа");
    } finally {
      setCreating(false);
    }
  };

  const copyNewKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
            <Key className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              API ключи
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Управление ключами для внешней интеграции</p>
          </div>
        </div>
        <Link to="/admin/api-docs">
          <Button variant="outline" size="sm" className="gap-1.5 rounded-xl">
            <BookOpen className="h-4 w-4" />
            Документация
          </Button>
        </Link>
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

      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">Создать ключ</h3>
            <p className="text-xs text-muted-foreground">Используйте имя для идентификации интеграции</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Название (mobile-app)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
          />
          <Input
            placeholder="Описание (опционально)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
          />
          <Button onClick={createKey} disabled={creating || !name.trim()} className="gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Создать
          </Button>
        </div>
      </Card>

      {newKey && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-emerald-500/[0.04] backdrop-blur-3xl border border-emerald-500/30 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                <Check className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight">Новый ключ создан</h3>
                <p className="text-xs text-muted-foreground">Показывается один раз — скопируйте сейчас</p>
              </div>
            </div>
            <code className="block rounded-xl border border-white/10 bg-foreground/[0.05] dark:bg-black/40 px-4 py-3 break-all font-mono text-xs">
              {newKey}
            </code>
            <Button variant="outline" size="sm" onClick={copyNewKey} className="mt-3 gap-1.5 rounded-xl">
              {copied ? <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
          </Card>
        </motion.div>
      )}

      {loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </Card>
      ) : !items.length ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
            <Key className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Пока нет ключей</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((k, i) => (
            <motion.div
              key={k.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileHover={{ y: -1 }}
            >
              <Card className="relative overflow-hidden bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-4 shadow-lg hover:shadow-xl hover:border-white/20 transition-all duration-300">
                <div className={cn(
                  "absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-gradient-to-b",
                  k.isActive ? "from-emerald-500 to-emerald-500/30" : "from-muted-foreground/40 to-transparent"
                )} />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn(
                      "h-9 w-9 rounded-xl border flex items-center justify-center shrink-0",
                      k.isActive
                        ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10"
                    )}>
                      <Key className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{k.name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span className="font-mono">{k.prefix}…</span>
                        <span>·</span>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          k.isActive
                            ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-foreground/[0.05] dark:bg-white/[0.05] text-muted-foreground border-white/10"
                        )}>
                          {k.isActive ? "Активен" : "Отключён"}
                        </span>
                        <span>·</span>
                        <span>{new Date(k.createdAt).toLocaleString("ru-RU")}</span>
                      </div>
                      {k.description && <div className="text-xs text-muted-foreground mt-0.5">{k.description}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl"
                      onClick={async () => {
                        await api.toggleApiKey(token, k.id, !k.isActive);
                        await load();
                      }}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {k.isActive ? "Отключить" : "Включить"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                      onClick={async () => {
                        await api.deleteApiKey(token, k.id);
                        await load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
