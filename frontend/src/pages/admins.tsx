import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth";
import { api, type AdminListItem, MANAGER_SECTIONS, MANAGER_SECTION_CATEGORIES } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { UserCog, Plus, Pencil, Trash2, Loader2, Crown, X, Shield, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminPermissionsDialog } from "@/components/admin-permissions-dialog";

export function AdminsPage() {
  const { state } = useAuth();
  const token = state.accessToken;
  const [list, setList] = useState<AdminListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [allowedSections, setAllowedSections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [permsDialog, setPermsDialog] = useState<{ id: string; email: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getAdmins(token).then(setList).catch(() => setError("Нет доступа")).finally(() => setLoading(false));
  }, [token]);

  function openCreate() {
    setModal("create");
    setEditingId(null);
    setDeleteConfirm(null);
    setEmail("");
    setPassword("");
    setAllowedSections([]);
  }

  function openEdit(item: AdminListItem) {
    if (item.role === "ADMIN") return;
    setModal("edit");
    setEditingId(item.id);
    setDeleteConfirm(null);
    setEmail(item.email);
    setPassword("");
    setAllowedSections(item.allowedSections ?? []);
  }

  function toggleSection(key: string) {
    setAllowedSections((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  async function handleCreate() {
    if (!token || !email.trim() || !password) {
      setError("Укажите email и пароль (мин. 8 символов)");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await api.createManager(token, {
        email: email.trim(),
        password,
        allowedSections,
      });
      setList((prev) => [created, ...prev]);
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!token || !editingId) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateManager(token, editingId, {
        allowedSections,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      setList((prev) => prev.map((a) => (a.id === editingId ? { ...a, ...updated } : a)));
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteManager(token, id);
      setList((prev) => prev.filter((a) => a.id !== id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загружаем менеджеров…</p>
      </div>
    );
  }

  if (error && list.length === 0) {
    return (
      <div className="px-4 sm:px-6 md:px-8 pt-6 pb-10">
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 text-center shadow-xl">
          <p className="text-muted-foreground">{error}</p>
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
            <UserCog className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Менеджеры
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Создавайте менеджеров и назначайте им доступ только к нужным разделам.
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить менеджера
        </Button>
      </motion.div>

      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-bold tracking-tight">Пользователи админки</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Админ имеет полный доступ. Менеджеру доступны только выбранные разделы.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-foreground/[0.04] dark:bg-white/[0.03] border-b border-white/5">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Роль</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Разделы доступа</th>
                <th className="w-32 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} className="border-b border-white/5 last:border-0 hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 font-medium">{item.email}</td>
                  <td className="px-4 py-3">
                    {item.role === "ADMIN" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                        <Crown className="h-3 w-3" />
                        Админ
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-md">
                        <Shield className="h-3 w-3" />
                        Менеджер
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {item.role === "ADMIN" ? (
                      <span className="text-amber-500 dark:text-amber-400">Все разделы</span>
                    ) : item.allowedSections?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {item.allowedSections.map((k) => (
                          <span key={k} className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2 py-0.5 text-[10px] font-medium">
                            {MANAGER_SECTIONS.find((s) => s.key === k)?.label ?? k}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">Нет доступа</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.role === "MANAGER" && (
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setPermsDialog({ id: item.id, email: item.email })} title="Granular permissions">
                          <Lock className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => openEdit(item)} title="Изменить">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {deleteConfirm === item.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-8 rounded-lg"
                              onClick={() => handleDelete(item.id)}
                              disabled={saving}
                            >
                              Да
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => setDeleteConfirm(null)}>
                              Нет
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10"
                            onClick={() => setDeleteConfirm(item.id)}
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error && modal && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
      )}

      {(modal === "create" || (modal === "edit" && editingId)) && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
                  {modal === "create" ? <Plus className="h-5 w-5 text-primary" /> : <Pencil className="h-5 w-5 text-primary" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold tracking-tight">{modal === "create" ? "Новый менеджер" : "Редактировать менеджера"}</h3>
                  <p className="text-xs text-muted-foreground">{modal === "create" ? "Email + пароль + доступы" : "Изменить пароль и/или доступы"}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setModal(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  value={email}
                  disabled={modal === "edit"}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="manager@example.com"
                  className={cn("rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50", modal === "edit" && "opacity-60")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">{modal === "create" ? "Пароль (мин. 8 символов)" : "Новый пароль (пусто — не менять)"}</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">Доступ к разделам</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      onClick={() => setAllowedSections(MANAGER_SECTIONS.map((s) => s.key))}
                    >
                      Выбрать все
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-lg text-xs"
                      onClick={() => setAllowedSections([])}
                    >
                      Снять все
                    </Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-4">
                  {MANAGER_SECTION_CATEGORIES.map((cat) => {
                    const items = MANAGER_SECTIONS.filter((s) => s.category === cat.key);
                    if (items.length === 0) return null;
                    const allChecked = items.every((s) => allowedSections.includes(s.key));
                    const someChecked = items.some((s) => allowedSections.includes(s.key));
                    return (
                      <div key={cat.key} className="space-y-2">
                        <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-[2px] h-[12px] bg-primary" />
                            <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                              {cat.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {items.filter((s) => allowedSections.includes(s.key)).length}/{items.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="text-[11px] text-primary/80 hover:text-primary transition-colors"
                            onClick={() => {
                              const keys = items.map((s) => s.key);
                              setAllowedSections((prev) =>
                                allChecked
                                  ? prev.filter((k) => !keys.includes(k))
                                  : Array.from(new Set([...prev, ...keys]))
                              );
                            }}
                          >
                            {allChecked ? "Снять группу" : someChecked ? "Дозаполнить" : "Выбрать группу"}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pl-3">
                          {items.map((s) => (
                            <label key={s.key} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={allowedSections.includes(s.key)}
                                onCheckedChange={() => toggleSection(s.key)}
                              />
                              <span className="text-sm">{s.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setModal(null)} className="rounded-xl">Отмена</Button>
                <Button
                  onClick={modal === "create" ? handleCreate : handleUpdate}
                  disabled={saving}
                  className="gap-2 rounded-xl"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {modal === "create" ? "Создать" : "Сохранить"}
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <AdminPermissionsDialog
        open={permsDialog !== null}
        adminId={permsDialog?.id ?? null}
        adminEmail={permsDialog?.email}
        onClose={() => setPermsDialog(null)}
      />
    </div>
  );
}
