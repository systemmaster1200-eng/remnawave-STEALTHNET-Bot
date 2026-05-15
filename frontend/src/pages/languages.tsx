import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { LanguageInfo } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import {
  Languages,
  Plus,
  Trash2,
  Download,
  Upload,
  Search,
  Save,
  X,
  Check,
  ChevronLeft,
  Globe,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  en: "English",
  uk: "Українська",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  pl: "Polski",
  tr: "Türkçe",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  hi: "हिन्दी",
  fa: "فارسی",
  kk: "Қазақша",
  uz: "O'zbekcha",
};

function flattenObj(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") result[key] = v;
    else if (v && typeof v === "object") Object.assign(result, flattenObj(v as Record<string, unknown>, key));
  }
  return result;
}

function nestObj(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}

type FilterMode = "all" | "untranslated" | "translated";

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "Все",
  untranslated: "Без перевода",
  translated: "Переведено",
};

function LanguageEditor({
  code,
  onBack,
  token,
}: {
  code: string;
  onBack: () => void;
  token: string;
}) {
  const [masterKeys, setMasterKeys] = useState<Record<string, string>>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveOk, setSaveOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, packRes] = await Promise.all([
        api.getLanguageKeys(token),
        api.getLanguagePack(token, code),
      ]);
      if (keysRes.ok) setMasterKeys(keysRes.keys);
      if (packRes.ok) setTranslations(flattenObj(packRes.data));
    } finally {
      setLoading(false);
    }
  }, [token, code]);

  useEffect(() => {
    load();
  }, [load]);

  const allKeys = useMemo(() => Object.keys(masterKeys).sort(), [masterKeys]);

  const groups = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const key of allKeys) {
      const group = key.split(".")[0];
      if (!g[group]) g[group] = [];
      g[group].push(key);
    }
    return g;
  }, [allKeys]);

  const filteredGroups = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const result: Record<string, string[]> = {};
    for (const [group, keys] of Object.entries(groups)) {
      const filtered = keys.filter((key) => {
        if (filter === "untranslated" && translations[key]) return false;
        if (filter === "translated" && !translations[key]) return false;
        if (search) {
          return (
            key.toLowerCase().includes(lowerSearch) ||
            (masterKeys[key] || "").toLowerCase().includes(lowerSearch) ||
            (translations[key] || "").toLowerCase().includes(lowerSearch)
          );
        }
        return true;
      });
      if (filtered.length > 0) result[group] = filtered;
    }
    return result;
  }, [groups, search, filter, translations, masterKeys]);

  const handleSave = async () => {
    setSaving(true);
    setSaveOk(false);
    try {
      const nested = nestObj(translations);
      await api.saveLanguagePack(token, code, nested);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importLanguagePack(token, code, data);
      await load();
    } catch {
      /* ignore parse errors */
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleExport = async () => {
    try {
      const text = await api.exportLanguagePack(token, code);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lang-${code}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  const setTranslation = (key: string, value: string) => {
    setTranslations((prev) => ({ ...prev, [key]: value }));
  };

  const translatedCount = allKeys.filter((k) => !!translations[k]).length;
  const totalCount = allKeys.length;
  const pct = totalCount > 0 ? Math.round((translatedCount / totalCount) * 100) : 0;

  if (loading) {
    return (
      <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
        <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-12 shadow-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем переводы…</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
      <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
      <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl"
      >
        <div className="flex items-center gap-4 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0 rounded-full hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shadow-inner border border-white/10 shrink-0">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60 flex items-center gap-2 flex-wrap">
              {LANG_NAMES[code] || code}
              <span className="text-sm font-medium text-muted-foreground uppercase rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2.5 py-0.5">
                {code}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Переведено{" "}
              <span className="text-foreground font-medium">
                {translatedCount} / {totalCount}
              </span>{" "}
              <span
                className={cn(
                  "ml-1 font-semibold",
                  pct >= 90
                    ? "text-emerald-500 dark:text-emerald-400"
                    : pct >= 50
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-orange-500 dark:text-orange-400"
                )}
              >
                ({pct}%)
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5 rounded-xl">
            <Upload className="h-3.5 w-3.5" />
            Импорт
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 rounded-xl">
            <Download className="h-3.5 w-3.5" />
            Экспорт
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 rounded-xl">
            {saveOk ? (
              <Check className="h-3.5 w-3.5" />
            ) : saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saveOk ? "Сохранено" : saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </motion.div>

      {/* Search + Filters + Progress */}
      <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по ключам или значениям…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-foreground/[0.03] dark:bg-white/[0.02] p-1 rounded-xl border border-white/5">
            {(["all", "untranslated", "translated"] as FilterMode[]).map((f) => {
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {FILTER_LABELS[f]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
            <span>Прогресс перевода</span>
            <span className="font-medium text-foreground">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/5 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                pct >= 90
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : pct >= 50
                    ? "bg-gradient-to-r from-amber-500 to-amber-400"
                    : "bg-gradient-to-r from-orange-500 to-orange-400"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Card>

      {/* Grouped keys */}
      {Object.keys(filteredGroups).length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Нет ключей по фильтру</p>
        </Card>
      ) : (
        Object.entries(filteredGroups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([group, keys], idx) => (
            <motion.div
              key={group}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.2) }}
            >
              <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/5 bg-foreground/[0.04] dark:bg-white/[0.03]">
                  <h3 className="text-sm font-bold tracking-tight">
                    {group}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">({keys.length})</span>
                  </h3>
                </div>
                <div className="divide-y divide-white/5">
                  {keys.map((key) => (
                    <div
                      key={key}
                      className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-2 px-4 py-3 items-start hover:bg-foreground/[0.03] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="text-xs text-muted-foreground break-all pt-2 font-mono">{key}</div>
                      <div className="text-sm text-foreground/80 rounded-xl border border-white/5 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 break-words min-h-[2.5rem]">
                        {masterKeys[key] || "—"}
                      </div>
                      <Input
                        value={translations[key] || ""}
                        onChange={(e) => setTranslation(key, e.target.value)}
                        placeholder="Перевод…"
                        className={cn(
                          "rounded-xl focus-visible:ring-primary/50",
                          translations[key]
                            ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/[0.05]"
                            : "border-orange-500/30 bg-orange-500/5 dark:bg-orange-500/[0.05]"
                        )}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          ))
      )}

      {/* Floating save */}
      <div className="sticky bottom-4 flex justify-end">
        <Button
          size="lg"
          onClick={handleSave}
          disabled={saving}
          className="gap-2 rounded-2xl shadow-2xl backdrop-blur-md"
        >
          {saveOk ? (
            <Check className="h-5 w-5" />
          ) : saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" />
          )}
          {saveOk ? "Сохранено!" : saving ? "Сохранение…" : "Сохранить все изменения"}
        </Button>
      </div>
    </div>
  );
}

export default function LanguagesPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const token = state.accessToken!;

  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  const [totalKeys, setTotalKeys] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadLanguages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getLanguages(token);
      if (res.ok) {
        setLanguages(res.languages);
        setTotalKeys(res.totalKeys);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadLanguages();
  }, [loadLanguages]);

  const handleAdd = async () => {
    const code = addCode.trim().toLowerCase();
    if (!code || code.length < 2) return;
    setAddLoading(true);
    try {
      await api.saveLanguagePack(token, code, {});
      setAddOpen(false);
      setAddCode("");
      await loadLanguages();
      setEditing(code);
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteLanguage(token, deleteTarget);
      setDeleteTarget(null);
      await loadLanguages();
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleExport = async (code: string) => {
    try {
      const text = await api.exportLanguagePack(token, code);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lang-${code}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  if (editing) {
    return (
      <LanguageEditor
        code={editing}
        token={token}
        onBack={() => {
          setEditing(null);
          loadLanguages();
        }}
      />
    );
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
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
            <Languages className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              {t("admin.nav.languages", "Языки")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="text-foreground font-medium">{languages.length}</span>{" "}
              {languages.length === 1 ? "язык" : "языков"} ·{" "}
              <span className="text-foreground font-medium">{totalKeys}</span> ключей
            </p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-1.5 rounded-xl">
          <Plus className="h-4 w-4" />
          Добавить язык
        </Button>
      </motion.div>

      {/* Loading / Empty / List */}
      {loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-12 shadow-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем языки…</p>
        </Card>
      ) : languages.length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
            <Globe className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Языковых пакетов пока нет</p>
          <Button variant="outline" onClick={() => setAddOpen(true)} className="mt-4 gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Добавить первый язык
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {languages.map((lang, idx) => {
            const pct = Math.round(lang.completeness * 100);
            const accent =
              pct >= 90
                ? "emerald"
                : pct >= 50
                  ? "amber"
                  : "orange";
            const accentText =
              pct >= 90
                ? "text-emerald-500 dark:text-emerald-400"
                : pct >= 50
                  ? "text-amber-500 dark:text-amber-400"
                  : "text-orange-500 dark:text-orange-400";
            const accentGradient =
              pct >= 90
                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                : pct >= 50
                  ? "bg-gradient-to-r from-amber-500 to-amber-400"
                  : "bg-gradient-to-r from-orange-500 to-orange-400";
            return (
              <motion.div
                key={lang.code}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.3) }}
                whileHover={{ y: -2 }}
              >
                <Card
                  className={cn(
                    "bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] p-5 shadow-xl group transition-all hover:border-white/20 hover:shadow-2xl",
                    "flex flex-col gap-4"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "h-12 w-12 rounded-2xl border border-white/10 flex items-center justify-center shadow-inner shrink-0",
                          accent === "emerald"
                            ? "bg-gradient-to-br from-emerald-500/25 to-emerald-500/5"
                            : accent === "amber"
                              ? "bg-gradient-to-br from-amber-500/25 to-amber-500/5"
                              : "bg-gradient-to-br from-orange-500/25 to-orange-500/5"
                        )}
                      >
                        <span className={cn("text-xl font-bold uppercase", accentText)}>{lang.code}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{LANG_NAMES[lang.code] || lang.code}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {lang.translatedKeys} / {lang.totalKeys} ключей
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur-md",
                        accent === "emerald"
                          ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20"
                          : accent === "amber"
                            ? "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20"
                            : "bg-orange-500/10 text-orange-500 dark:text-orange-400 border-orange-500/20"
                      )}
                    >
                      {pct}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/5 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", accentGradient)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 rounded-xl"
                      onClick={() => setEditing(lang.code)}
                    >
                      <Languages className="h-3.5 w-3.5" />
                      Редактировать
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => handleExport(lang.code)}
                      title="Экспорт JSON"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10"
                      onClick={() => setDeleteTarget(lang.code)}
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add Language Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center shadow-inner">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              Добавить язык
            </DialogTitle>
            <DialogDescription className="sr-only">Создать новый языковой пакет</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="lang-code" className="text-xs text-muted-foreground">
                Код языка
              </Label>
              <Input
                id="lang-code"
                placeholder="например: en, uk, fr, de"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 5))}
                maxLength={5}
                className="rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50"
              />
              {LANG_NAMES[addCode.toLowerCase()] && (
                <p className="text-xs text-muted-foreground">
                  Будет создан:{" "}
                  <span className="text-foreground font-medium">{LANG_NAMES[addCode.toLowerCase()]}</span>
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} className="rounded-xl">
              Отмена
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addLoading || addCode.trim().length < 2}
              className="gap-2 rounded-xl"
            >
              {addLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {addLoading ? "Создание…" : "Создать и редактировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-500/5 border border-white/10 flex items-center justify-center shadow-inner">
                <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" />
              </div>
              Удалить языковой пакет
            </DialogTitle>
            <DialogDescription className="sr-only">Подтвердите удаление пакета</DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 backdrop-blur-md px-4 py-3 text-sm">
            <p className="text-foreground/80">
              Вы уверены, что хотите удалить пакет{" "}
              <strong className="text-foreground">
                {deleteTarget && (LANG_NAMES[deleteTarget] || deleteTarget)}
              </strong>{" "}
              <span className="text-muted-foreground">({deleteTarget})</span>?
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-2">Это действие нельзя отменить.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="rounded-xl">
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="gap-2 rounded-xl"
            >
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleteLoading ? "Удаление…" : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
