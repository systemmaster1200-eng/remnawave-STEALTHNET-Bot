/**
 * Cmd+K (Ctrl+K) глобальный поиск-палитра. Открывается на любой странице.
 * Ввёл email/telegram/payment-id → попал в нужный раздел одним Enter'ом.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { Search, Loader2, Users, Receipt, Tag, Trophy, Gift, Ticket } from "lucide-react";
import { quickSearchApi, type QuickSearchResult } from "@/lib/admin-extras-api";

const GROUP_META: Record<string, { label: string; icon: typeof Users; cls: string }> = {
  clients: { label: "Клиенты", icon: Users, cls: "text-emerald-600 dark:text-emerald-400" },
  payments: { label: "Платежи", icon: Receipt, cls: "text-blue-600 dark:text-blue-400" },
  tariffs: { label: "Тарифы", icon: Tag, cls: "text-amber-600 dark:text-amber-400" },
  contests: { label: "Конкурсы", icon: Trophy, cls: "text-violet-600 dark:text-violet-400" },
  promo_groups: { label: "Промо-группы", icon: Gift, cls: "text-pink-600 dark:text-pink-400" },
  promo_codes: { label: "Промокоды", icon: Ticket, cls: "text-cyan-600 dark:text-cyan-400" },
};

export function CmdKPalette() {
  const { state } = useAuth();
  const token = state.accessToken;
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<QuickSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Глобальный keybinding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform);
      const ctrl = isMac ? e.metaKey : e.ctrlKey;
      if (ctrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setItems([]);
        setActiveIndex(0);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Auto-focus при открытии.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open || !token) return;
    if (!query.trim()) { setItems([]); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await quickSearchApi.search(token, query.trim());
        setItems(r.items);
        setActiveIndex(0);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open, token]);

  const navigateTo = (item: QuickSearchResult) => {
    setOpen(false);
    navigate(item.url);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); navigateTo(items[activeIndex]); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[10vh]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-2xl mx-4 rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Поиск: email, telegram, payment-id, тариф, промокод…"
            className="flex-1 bg-transparent outline-none text-base"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd>
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? loading ? "Поиск…" : "Ничего не найдено"
              : "Введите email клиента, ID платежа, название тарифа или код промо."}
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {items.map((item, idx) => {
              const meta = GROUP_META[item.group] ?? { label: item.group, icon: Search, cls: "text-foreground" };
              const Icon = meta.icon;
              return (
                <li
                  key={`${item.group}-${item.id}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => navigateTo(item)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${idx === activeIndex ? "bg-accent" : ""}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${meta.cls}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.title}</div>
                    {item.subtitle ? <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div> : null}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{meta.label}</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> навигация · <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↵</kbd> открыть</span>
          <span><kbd className="rounded border bg-muted px-1 py-0.5 font-mono">⌘K</kbd> открыть/закрыть</span>
        </div>
      </div>
    </div>
  );
}
