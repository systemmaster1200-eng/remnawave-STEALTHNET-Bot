import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type {
  TariffCategoryWithTariffs,
  TariffRecord,
  CreateTariffPayload,
  UpdateTariffPayload,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  CreditCard,
  Loader2,
  ChevronDown,
  Check,
  GripVertical,
  Layers,
  AlertTriangle,
  Sparkles,
  Tag,
  X,
  TrendingDown,
  FileSpreadsheet,
} from "lucide-react";
import { TariffCsvDialog } from "@/components/tariff-csv-dialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const BYTES_PER_GB = 1024 * 1024 * 1024;

const CURRENCIES = [
  { value: "usd", label: "USD" },
  { value: "rub", label: "RUB" },
];

function formatTraffic(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(1)} ГБ`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

type SquadOption = { uuid: string; name?: string };

type PriceOptionDraft = {
  uid: string;
  days: number;
  price: string;
};

type DiscountTierDraft = {
  uid: string;
  minExtraDevices: number;
  discountPercent: string;
};

const PRICE_OPTION_PRESETS = [7, 30, 90, 365];
const MAX_PRICE_OPTIONS = 10;
const MAX_DISCOUNT_TIERS = 10;

const DISCOUNT_PRESETS: { name: string; tiers: { minExtraDevices: number; discountPercent: number }[] }[] = [
  { name: "Мягкая", tiers: [{ minExtraDevices: 2, discountPercent: 5 }, { minExtraDevices: 4, discountPercent: 10 }] },
  { name: "Стандарт", tiers: [{ minExtraDevices: 2, discountPercent: 10 }, { minExtraDevices: 4, discountPercent: 20 }, { minExtraDevices: 6, discountPercent: 30 }] },
  { name: "Агрессив", tiers: [{ minExtraDevices: 1, discountPercent: 10 }, { minExtraDevices: 3, discountPercent: 25 }, { minExtraDevices: 5, discountPercent: 40 }] },
];

function buildInitialTiers(t: TariffRecord | null): DiscountTierDraft[] {
  const arr = t?.deviceDiscountTiers ?? [];
  return arr.map((x) => ({ uid: makeDraftUid(), minExtraDevices: x.minExtraDevices, discountPercent: String(x.discountPercent) }));
}

let __priceOptionDraftCounter = 0;
function makeDraftUid(): string {
  __priceOptionDraftCounter += 1;
  return `draft-${Date.now().toString(36)}-${__priceOptionDraftCounter.toString(36)}`;
}

function parsePriceNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const v = parseFloat(trimmed);
  return Number.isFinite(v) ? v : null;
}

const inputCls = "rounded-xl bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 focus-visible:ring-primary/50";
const selectCls = "flex h-10 w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

function SortableCategoryCard({
  cat,
  onEditCategory,
  onDeleteCategory,
  onAddTariff,
  onEditTariff,
  onDeleteTariff,
  onTariffDragEnd,
  formatPrice,
  formatTraffic,
}: {
  cat: TariffCategoryWithTariffs;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  onAddTariff: () => void;
  onEditTariff: (t: TariffRecord) => void;
  onDeleteTariff: (id: string) => void;
  onTariffDragEnd: (event: DragEndEvent) => void;
  formatPrice: (amount: number, currency: string) => string;
  formatTraffic: (bytes: number | null) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  });
  const tariffSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] shadow-xl overflow-hidden transition-shadow",
        isDragging && "opacity-90 shadow-2xl z-10"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/5 bg-foreground/[0.02] dark:bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="h-9 w-9 shrink-0 cursor-grab active:cursor-grabbing rounded-xl bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/10 text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors"
            {...attributes}
            {...listeners}
            title="Перетащите для изменения порядка"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-white/10 flex items-center justify-center shadow-inner shrink-0">
            <FolderOpen className="h-4 w-4 text-violet-500 dark:text-violet-400" />
          </div>
          <h3 className="text-base font-bold tracking-tight truncate">{cat.name}</h3>
          <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {cat.tariffs.length} тарифов
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button variant="outline" size="sm" onClick={onEditCategory} title="Редактировать категорию" className="gap-1.5 rounded-xl">
            <Pencil className="h-3.5 w-3.5" />
            Изменить
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDeleteCategory}
            title="Удалить категорию"
            className="gap-1.5 rounded-xl border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </Button>
          <Button size="sm" onClick={onAddTariff} className="gap-1.5 rounded-xl">
            <Plus className="h-3.5 w-3.5" />
            Тариф
          </Button>
        </div>
      </div>
      <div className="p-4">
        {cat.tariffs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-foreground/[0.02] dark:bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Нет тарифов. Нажмите «Тариф», чтобы добавить (название, срок, сквады, лимиты).
            </p>
          </div>
        ) : (
          <DndContext
            sensors={tariffSensors}
            collisionDetection={closestCenter}
            onDragEnd={onTariffDragEnd}
          >
            <SortableContext
              items={cat.tariffs.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {cat.tariffs.map((t) => (
                  <SortableTariffRow
                    key={t.id}
                    tariff={t}
                    onEdit={() => onEditTariff(t)}
                    onDelete={() => onDeleteTariff(t.id)}
                    formatPrice={formatPrice}
                    formatTraffic={formatTraffic}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </Card>
  );
}

function SortableTariffRow({
  tariff: t,
  onEdit,
  onDelete,
  formatPrice,
  formatTraffic,
}: {
  tariff: TariffRecord;
  onEdit: () => void;
  onDelete: () => void;
  formatPrice: (amount: number, currency: string) => string;
  formatTraffic: (bytes: number | null) => string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] backdrop-blur-md px-4 py-3 hover:border-white/20 hover:-translate-y-px transition-[border-color,transform]",
        isDragging && "opacity-90 shadow-lg z-10"
      )}
    >
      <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
        <button
          type="button"
          className="h-8 w-8 shrink-0 cursor-grab active:cursor-grabbing rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/10 text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors"
          {...attributes}
          {...listeners}
          title="Перетащите для изменения порядка"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-white/10 flex items-center justify-center shrink-0">
          <CreditCard className="h-4 w-4 text-primary" />
        </div>
        <span className="font-semibold truncate">{t.name}</span>
        {t.description?.trim() ? (
          <span className="text-muted-foreground text-xs max-w-[200px] truncate" title={t.description}>
            {t.description}
          </span>
        ) : null}
        <span className="inline-flex items-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.05] border border-white/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t.durationDays} дн.
        </span>
        <span className="text-sm font-bold text-emerald-500 dark:text-emerald-400">
          {formatPrice(t.price ?? 0, t.currency ?? "usd")}
        </span>
        <span className="inline-flex items-center rounded-full bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-medium">
          сквадов: {t.internalSquadUuids.length}
        </span>
        <span className="inline-flex items-center rounded-full bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 text-[10px] font-medium">
          {formatTraffic(t.trafficLimitBytes)}
        </span>
        {t.trafficResetMode && t.trafficResetMode !== "no_reset" && (
          <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium">
            {t.trafficResetMode === "on_purchase" ? "сброс при покупке" : t.trafficResetMode === "monthly" ? "сброс ежемесячно" : t.trafficResetMode === "monthly_rolling" ? "скользящий месяц" : ""}
          </span>
        )}
        {t.deviceLimit != null && (
          <span className="inline-flex items-center rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 text-[10px] font-medium">
            устройств: {t.deviceLimit}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onEdit} title="Редактировать">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10"
          onClick={onDelete}
          title="Удалить"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

// ─────────────── Секция устройств (новая модель) ───────────────
// Поля:
//   includedDevices — сколько входит в базовую цену тарифа
//   pricePerExtraDevice — цена доп. устройства
//   maxExtraDevices — макс. число доп. устройств которое клиент сможет докупить
//   tiers — лесенка скидок применяется ТОЛЬКО к extras
function DeviceSection({
  includedDevices,
  setIncludedDevices,
  pricePerExtraDevice,
  setPricePerExtraDevice,
  maxExtraDevices,
  setMaxExtraDevices,
  extraDevicesEnabled,
  setExtraDevicesEnabled,
  discountsEnabled,
  setDiscountsEnabled,
  tiers,
  updateTier,
  removeTier,
  addTier,
  applyPreset,
  basePrice,
  currency,
}: {
  includedDevices: number;
  setIncludedDevices: (v: number) => void;
  pricePerExtraDevice: string;
  setPricePerExtraDevice: (v: string) => void;
  maxExtraDevices: number;
  setMaxExtraDevices: (v: number) => void;
  extraDevicesEnabled: boolean;
  setExtraDevicesEnabled: (v: boolean) => void;
  discountsEnabled: boolean;
  setDiscountsEnabled: (v: boolean) => void;
  tiers: DiscountTierDraft[];
  updateTier: (uid: string, patch: Partial<Pick<DiscountTierDraft, "minExtraDevices" | "discountPercent">>) => void;
  removeTier: (uid: string) => void;
  addTier: () => void;
  applyPreset: (idx: number) => void;
  basePrice: number;
  currency: string;
}) {
  const pricePerExtraNum = parseFloat(pricePerExtraDevice) || 0;
  // Превью: для каждого extras от 0 до maxExtras считаем базу + extras × pricePerExtra × (100−pct)/100.
  const previewMaxExtras = extraDevicesEnabled ? Math.max(0, maxExtraDevices) : 0;
  const preview = Array.from({ length: previewMaxExtras + 1 }, (_, i) => {
    const extras = i;
    const sortedTiers = [...tiers]
      .map((t) => ({ minExtraDevices: t.minExtraDevices, pct: parseFloat(t.discountPercent) || 0 }))
      .sort((a, b) => b.minExtraDevices - a.minExtraDevices);
    const tier = discountsEnabled && extras > 0 ? sortedTiers.find((t) => extras >= t.minExtraDevices) : undefined;
    const pct = tier?.pct ?? 0;
    const extrasTotal = Math.round(pricePerExtraNum * extras * (100 - pct)) / 100;
    const total = basePrice + extrasTotal;
    return { extras, pct, total, isTier: !!tier, totalDevices: includedDevices + extras };
  });
  const bestExtra = preview.slice(1).reduce((best, cur) => {
    const perDev = cur.totalDevices > 0 ? cur.total / cur.totalDevices : Infinity;
    if (best == null || perDev < best.perDev) return { extras: cur.extras, perDev };
    return best;
  }, null as { extras: number; perDev: number } | null);

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-fuchsia-500/[0.04] via-purple-500/[0.03] to-primary/[0.04] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl bg-fuchsia-500/15 text-fuchsia-500 dark:text-fuchsia-400 flex items-center justify-center">
          <Layers className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Устройства</p>
          <p className="text-[11px] text-muted-foreground">Сколько устройств в комплекте + продажа доп. устройств клиенту</p>
        </div>
      </div>

      {/* Включено в тариф */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Устройств в комплекте (базовая цена)</Label>
        <Input
          type="number"
          min={1}
          max={100}
          value={includedDevices}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v >= 1 && v <= 100) setIncludedDevices(v);
          }}
          className={inputCls}
        />
        <p className="text-[10px] text-muted-foreground/70">Сколько устройств клиент получает за базовую цену тарифа</p>
      </div>

      {/* Toggle: продажа доп. устройств */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Продажа доп. устройств</Label>
        <button
          type="button"
          onClick={() => setExtraDevicesEnabled(!extraDevicesEnabled)}
          className={cn(
            "h-10 w-full rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-2",
            extraDevicesEnabled
              ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-emerald-500/40 text-emerald-500 dark:text-emerald-400"
              : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 text-muted-foreground hover:border-white/20"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          {extraDevicesEnabled ? "ВКЛЮЧЕНА — клиент видит picker" : "Выключена — клиент не видит picker"}
        </button>
      </div>

      {extraDevicesEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Цена доп. устройства <span className="text-fuchsia-500 dark:text-fuchsia-400">(за 30 дней)</span></Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={pricePerExtraDevice}
                onChange={(e) => setPricePerExtraDevice(e.target.value)}
                className={inputCls}
                placeholder="100"
              />
              <p className="text-[10px] text-muted-foreground/70">База за 30 дней. Для других опций цена масштабируется (90 дн = ×3).</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Макс. доп. устройств</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={maxExtraDevices}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v >= 0 && v <= 100) setMaxExtraDevices(v);
                }}
                className={inputCls}
              />
              <p className="text-[10px] text-muted-foreground/70">Сколько максимум клиент может докупить</p>
            </div>
          </div>

          {/* Toggle: скидки за объём */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Скидки за объём доп. устройств</Label>
            <button
              type="button"
              onClick={() => setDiscountsEnabled(!discountsEnabled)}
              className={cn(
                "h-10 w-full rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-2",
                discountsEnabled
                  ? "bg-gradient-to-r from-fuchsia-500/20 to-primary/20 border-fuchsia-500/40 text-fuchsia-500 dark:text-fuchsia-400"
                  : "bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 text-muted-foreground hover:border-white/20"
              )}
            >
              <TrendingDown className="h-3.5 w-3.5" />
              {discountsEnabled ? "ВКЛЮЧЕНЫ" : "Выключено"}
            </button>
          </div>

          {discountsEnabled && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-muted-foreground">Лесенка порогов (по числу доп. устройств)</Label>
                <div className="flex gap-1.5">
                  {DISCOUNT_PRESETS.map((p, i) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(i)}
                      className="text-[10px] px-2 py-1 rounded-md bg-foreground/[0.04] dark:bg-white/[0.03] hover:bg-foreground/[0.07] dark:hover:bg-white/[0.06] border border-white/10 text-foreground/80 transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              {tiers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/15 p-4 text-center">
                  <p className="text-xs text-muted-foreground">Нет порогов. Добавь первый или выбери пресет.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {tiers.map((t) => (
                    <li
                      key={t.uid}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 hover:-translate-y-px transition-transform"
                    >
                      <span className="text-xs text-muted-foreground shrink-0">от</span>
                      <Input
                        type="number"
                        min={1}
                        max={Math.max(1, maxExtraDevices)}
                        value={t.minExtraDevices}
                        onChange={(e) => updateTier(t.uid, { minExtraDevices: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        className={cn(inputCls, "h-8 w-16 text-center text-sm")}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">доп. →</span>
                      <span className="text-xs text-muted-foreground shrink-0">скидка</span>
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        step={1}
                        value={t.discountPercent}
                        onChange={(e) => updateTier(t.uid, { discountPercent: e.target.value })}
                        className={cn(inputCls, "h-8 w-16 text-center text-sm")}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">%</span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => removeTier(t.uid)}
                        className="h-7 w-7 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center justify-center shrink-0 transition-colors"
                        title="Удалить порог"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTier}
                disabled={tiers.length >= MAX_DISCOUNT_TIERS}
                className="mt-2 gap-1 rounded-lg h-7 px-2.5 text-[11px] border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-500 dark:text-fuchsia-400"
              >
                <Plus className="h-3 w-3" />
                Порог
              </Button>
            </div>
          )}
        </>
      )}

      {/* Live preview */}
      {basePrice > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">Превью</Label>
            <span className="text-[10px] text-muted-foreground/70 truncate">База {formatPrice(basePrice, currency)} ({includedDevices} устр) + extras{extraDevicesEnabled ? ` × ${pricePerExtraNum}` : ""}</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {preview.map((p) => (
              <div
                key={p.extras}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-center transition-colors",
                  p.extras === 0
                    ? "border-primary/30 bg-primary/10"
                    : p.isTier
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02]",
                  bestExtra?.extras === p.extras && p.extras > 0 && "ring-2 ring-fuchsia-500/40"
                )}
              >
                <p className="text-[10px] text-muted-foreground">
                  {p.extras === 0 ? "Без доп." : `+${p.extras} доп.`}
                </p>
                <p className="text-xs font-bold mt-0.5">{formatPrice(p.total, currency)}</p>
                <p className="text-[9px] text-muted-foreground/70 mt-0.5">{p.totalDevices} устр</p>
                {p.pct > 0 && (
                  <p className="text-[10px] font-semibold text-emerald-500 dark:text-emerald-400 mt-0.5">−{p.pct}%</p>
                )}
              </div>
            ))}
          </div>
          {bestExtra && bestExtra.extras > 0 && (
            <p className="text-[10px] text-fuchsia-500 dark:text-fuchsia-400 mt-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Лучшая цена за устройство: <strong>+{bestExtra.extras} доп.</strong> ({formatPrice(bestExtra.perDev, currency)}/устр)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SortablePriceOptionRow({
  option,
  isOnly,
  isBest,
  isDuplicate,
  currency,
  onChangeDays,
  onChangePrice,
  onRemove,
}: {
  option: PriceOptionDraft;
  isOnly: boolean;
  isBest: boolean;
  isDuplicate: boolean;
  currency: string;
  onChangeDays: (v: number) => void;
  onChangePrice: (v: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.uid,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const priceNum = parsePriceNumber(option.price);
  const ppd = priceNum != null && option.days > 0 ? priceNum / option.days : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex items-center gap-2 rounded-xl border bg-foreground/[0.03] dark:bg-white/[0.02] backdrop-blur-md px-2.5 py-2",
        isBest
          ? "border-amber-500/40 ring-1 ring-amber-500/20 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
          : isDuplicate
            ? "border-amber-500/40"
            : "border-white/10 hover:border-white/20 hover:-translate-y-px transition-[border-color,transform]",
        isDragging && "opacity-90 shadow-lg z-10"
      )}
    >
      <button
        type="button"
        className="h-8 w-7 shrink-0 cursor-grab active:cursor-grabbing rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/10 text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] flex items-center justify-center transition-colors"
        {...attributes}
        {...listeners}
        title="Перетащите для изменения порядка"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 flex-1 items-center min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Input
            type="number"
            min={1}
            max={3650}
            step={1}
            value={option.days}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onChangeDays(Number.isFinite(v) && v > 0 ? v : 1);
            }}
            className={cn(inputCls, "h-8 text-sm px-2.5")}
            aria-label="Длительность (дней)"
          />
          <span className="text-[11px] text-muted-foreground shrink-0">дн.</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <Input
            type="number"
            min={0}
            step={0.01}
            value={option.price}
            onChange={(e) => onChangePrice(e.target.value)}
            placeholder="0.00"
            className={cn(inputCls, "h-8 text-sm px-2.5")}
            aria-label="Цена"
          />
          <span className="text-[11px] text-muted-foreground shrink-0 uppercase">{currency}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isBest && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold">
              <Sparkles className="h-3 w-3" />
              Best deal
            </span>
          )}
          <span className="hidden sm:inline-flex items-center text-[11px] text-muted-foreground tabular-nums min-w-[60px] justify-end">
            {ppd != null ? `${ppd.toFixed(2)}/день` : "—"}
          </span>
        </div>
      </div>

      {!isOnly && (
        <button
          type="button"
          onClick={onRemove}
          className="h-8 w-8 shrink-0 rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-white/10 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 flex items-center justify-center transition-colors"
          title="Удалить опцию"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

export function TariffsPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? null;

  const [categories, setCategories] = useState<TariffCategoryWithTariffs[]>([]);
  const [squads, setSquads] = useState<SquadOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [remnaConfigured, setRemnaConfigured] = useState<boolean | null>(null);

  const [categoryModal, setCategoryModal] = useState<"add" | { edit: TariffCategoryWithTariffs } | null>(null);
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [tariffModal, setTariffModal] = useState<
    | { kind: "add"; categoryId: string }
    | { kind: "edit"; category: TariffCategoryWithTariffs; tariff: TariffRecord }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [status, cats, squadsRes] = await Promise.all([
        api.getRemnaStatus(token),
        api.getTariffCategories(token),
        api.getRemnaSquadsInternal(token).catch(() => ({ response: { internalSquads: [] } })),
      ]);
      setRemnaConfigured(status.configured);
      setCategories(cats.items);
      const res = squadsRes as { response?: { internalSquads?: { uuid?: string; name?: string }[] } };
      const list = res?.response?.internalSquads ?? (Array.isArray(res?.response) ? res.response : []);
      setSquads(Array.isArray(list) ? list.map((s) => ({ uuid: s.uuid ?? "", name: s.name })) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  const handleDeleteCategory = async (id: string) => {
    if (!token || !confirm("Удалить категорию и все тарифы в ней?")) return;
    try {
      await api.deleteTariffCategory(token, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const handleDeleteTariff = async (id: string) => {
    if (!token || !confirm("Удалить тариф?")) return;
    try {
      await api.deleteTariff(token, id);
      await load();
      setTariffModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleCategoryDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setCategories(reordered);
    if (!token) return;
    try {
      await Promise.all(
        reordered.map((cat, index) =>
          api.updateTariffCategory(token, cat.id, { sortOrder: index })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения порядка");
      load();
    }
  };

  const handleTariffDragEnd = async (
    event: DragEndEvent,
    category: TariffCategoryWithTariffs
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const tariffs = category.tariffs;
    const oldIndex = tariffs.findIndex((t) => t.id === active.id);
    const newIndex = tariffs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tariffs, oldIndex, newIndex);
    setCategories((prev) =>
      prev.map((c) =>
        c.id === category.id ? { ...c, tariffs: reordered } : c
      )
    );
    if (!token) return;
    try {
      await Promise.all(
        reordered.map((t, index) =>
          api.updateTariff(token, t.id, { sortOrder: index })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения порядка");
      load();
    }
  };

  if (loading && categories.length === 0) {
    return (
      <div className="space-y-5 px-4 sm:px-6 md:px-8 pt-6 pb-10 relative">
        <div className="fixed -z-10 bg-primary/15 blur-[120px] top-[-50px] left-[-50px] w-[300px] h-[300px] rounded-full pointer-events-none" />
        <div className="fixed -z-10 bg-purple-500/10 blur-[100px] top-[20%] right-[-50px] w-[250px] h-[250px] rounded-full pointer-events-none" />
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-16 shadow-xl flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Загружаем тарифы…</p>
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
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
              Тарифы
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Категории тарифов и тарифы — срок (1–360 дней), сквады, лимиты трафика и устройств
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCsvDialog(true)} variant="outline" className="gap-1.5 rounded-xl">
            <FileSpreadsheet className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={() => setCategoryModal("add")} className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Добавить категорию
          </Button>
        </div>
      </motion.div>

      <TariffCsvDialog
        open={showCsvDialog}
        onClose={() => setShowCsvDialog(false)}
        onApplied={() => load()}
      />


      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-md px-4 py-3 text-sm text-red-500 dark:text-red-400"
        >
          {error}
        </motion.div>
      )}

      {remnaConfigured === false && (
        <Card className="bg-amber-500/5 backdrop-blur-3xl border-amber-500/30 rounded-[2rem] p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-amber-500/20 flex items-center justify-center shadow-inner shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-500 dark:text-amber-400">Remna API не настроен</p>
              <p className="text-xs text-muted-foreground mt-1">
                Сквады для тарифов подтягиваются из Remna — настройте <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono text-xs">REMNA_API_URL</code> и <code className="bg-foreground/[0.06] dark:bg-white/[0.06] px-1.5 py-0.5 rounded font-mono text-xs">REMNA_ADMIN_TOKEN</code> в бэкенде.
              </p>
            </div>
          </div>
        </Card>
      )}

      {categories.length === 0 && !loading ? (
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-[2rem] py-12 shadow-xl flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/10">
            <Layers className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground mb-4 max-w-md px-6">
            Нет категорий. Создайте категорию тарифов, затем добавьте в неё тарифы (1–360 дней, сквады, лимиты).
          </p>
          <Button onClick={() => setCategoryModal("add")} className="gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" />
            Создать категорию
          </Button>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleCategoryDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {categories.map((cat, idx) => (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <SortableCategoryCard
                    cat={cat}
                    onEditCategory={() => setCategoryModal({ edit: cat })}
                    onDeleteCategory={() => handleDeleteCategory(cat.id)}
                    onAddTariff={() => setTariffModal({ kind: "add", categoryId: cat.id })}
                    onEditTariff={(t) => setTariffModal({ kind: "edit", category: cat, tariff: t })}
                    onDeleteTariff={handleDeleteTariff}
                    onTariffDragEnd={(e) => handleTariffDragEnd(e, cat)}
                    formatPrice={formatPrice}
                    formatTraffic={formatTraffic}
                  />
                </motion.div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Модалка категории */}
      {categoryModal && (
        <CategoryModal
          token={token}
          modal={categoryModal}
          onClose={() => setCategoryModal(null)}
          onSaved={() => {
            setCategoryModal(null);
            load();
          }}
          saving={saving}
          setSaving={setSaving}
        />
      )}

      {/* Модалка тарифа */}
      {tariffModal && (
        <TariffModal
          token={token}
          squads={squads}
          modal={tariffModal}
          onClose={() => setTariffModal(null)}
          onSaved={() => {
            setTariffModal(null);
            load();
          }}
          saving={saving}
          setSaving={setSaving}
        />
      )}
    </div>
  );
}

function CategoryModal({
  token,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  modal: "add" | { edit: TariffCategoryWithTariffs };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal !== "add";
  const editCat = isEdit ? (modal as { edit: TariffCategoryWithTariffs }).edit : null;
  const [name, setName] = useState(editCat?.name ?? "");
  const [emojiKey, setEmojiKey] = useState<string>(editCat?.emojiKey ?? "");

  useEffect(() => {
    if (isEdit && editCat) {
      setName(editCat.name);
      setEmojiKey(editCat.emojiKey ?? "");
    } else {
      setName("");
      setEmojiKey("");
    }
  }, [modal, isEdit, editCat?.name, editCat?.emojiKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), emojiKey: emojiKey.trim() || null };
      if (isEdit) {
        await api.updateTariffCategory(token, (modal as { edit: TariffCategoryWithTariffs }).edit.id, payload);
      } else {
        await api.createTariffCategory(token, payload);
      }
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 border border-white/10 flex items-center justify-center shadow-inner">
              {isEdit ? <Pencil className="h-4 w-4 text-violet-500 dark:text-violet-400" /> : <Sparkles className="h-4 w-4 text-violet-500 dark:text-violet-400" />}
            </div>
            {isEdit ? "Редактировать категорию" : "Новая категория"}
          </DialogTitle>
          <DialogDescription className="sr-only">Форма категории</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cat-name" className="text-xs text-muted-foreground">Название категории</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Базовый"
              required
              className={inputCls}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cat-emoji" className="text-xs text-muted-foreground">Эмодзи (по коду)</Label>
            <select
              id="cat-emoji"
              value={emojiKey}
              onChange={(e) => setEmojiKey(e.target.value)}
              className={selectCls}
            >
              <option value="">— без эмодзи —</option>
              <option value="ordinary">ordinary — 📦</option>
              <option value="premium">premium — ⭐</option>
            </select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">Отмена</Button>
            <Button type="submit" disabled={saving} className="gap-2 rounded-xl">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TariffModal({
  token,
  squads,
  modal,
  onClose,
  onSaved,
  saving,
  setSaving,
}: {
  token: string | null;
  squads: SquadOption[];
  modal: { kind: "add"; categoryId: string } | { kind: "edit"; category: TariffCategoryWithTariffs; tariff: TariffRecord };
  onClose: () => void;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const isEdit = modal.kind === "edit";
  const tariff = isEdit ? modal.tariff : null;
  const categoryId = isEdit ? modal.category.id : modal.categoryId;

  const buildInitialPriceOptions = (t: TariffRecord | null): PriceOptionDraft[] => {
    if (t && Array.isArray(t.priceOptions) && t.priceOptions.length > 0) {
      return [...t.priceOptions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({
          uid: p.id,
          days: p.durationDays,
          price: String(p.price),
        }));
    }
    if (t) {
      return [
        {
          uid: makeDraftUid(),
          days: t.durationDays,
          price: String(t.price ?? 0),
        },
      ];
    }
    return [{ uid: makeDraftUid(), days: 30, price: "0" }];
  };

  const [name, setName] = useState(tariff?.name ?? "");
  const [description, setDescription] = useState(tariff?.description ?? "");
  const [priceOptions, setPriceOptions] = useState<PriceOptionDraft[]>(() => buildInitialPriceOptions(tariff));
  const [selectedSquadUuids, setSelectedSquadUuids] = useState<string[]>(tariff?.internalSquadUuids ?? []);
  const [trafficGb, setTrafficGb] = useState<string>(
    tariff?.trafficLimitBytes != null ? String((tariff.trafficLimitBytes / BYTES_PER_GB).toFixed(2)) : ""
  );
  const [trafficResetMode, setTrafficResetMode] = useState<string>(tariff?.trafficResetMode ?? "no_reset");
  const [deviceLimit, setDeviceLimit] = useState<string>(tariff?.deviceLimit != null ? String(tariff.deviceLimit) : "");
  // Новая модель устройств:
  //   includedDevices — сколько входит в базовую цену тарифа
  //   pricePerExtraDevice — цена доп. устройства
  //   maxExtraDevices — макс. доп. устройств клиент может докупить (0 = отключено)
  const [includedDevices, setIncludedDevices] = useState<number>(tariff?.includedDevices ?? 1);
  const [pricePerExtraDevice, setPricePerExtraDevice] = useState<string>(String(tariff?.pricePerExtraDevice ?? 0));
  const [maxExtraDevices, setMaxExtraDevices] = useState<number>(tariff?.maxExtraDevices ?? 0);
  const [extraDevicesEnabled, setExtraDevicesEnabled] = useState<boolean>(() => (tariff?.maxExtraDevices ?? 0) > 0);
  const [discountTiers, setDiscountTiers] = useState<DiscountTierDraft[]>(() => buildInitialTiers(tariff));
  const [discountsEnabled, setDiscountsEnabled] = useState<boolean>(() => (tariff?.deviceDiscountTiers?.length ?? 0) > 0);
  const [currency, setCurrency] = useState<string>((tariff?.currency ?? "usd").toLowerCase());
  const [lavatopOfferId, setLavatopOfferId] = useState<string>(tariff?.lavatopOfferId ?? "");

  useEffect(() => {
    if (isEdit && tariff) {
      setName(tariff.name);
      setDescription(tariff.description ?? "");
      setPriceOptions(buildInitialPriceOptions(tariff));
      setSelectedSquadUuids(tariff.internalSquadUuids);
      setTrafficGb(tariff.trafficLimitBytes != null ? String((tariff.trafficLimitBytes / BYTES_PER_GB).toFixed(2)) : "");
      setTrafficResetMode(tariff.trafficResetMode ?? "no_reset");
      setDeviceLimit(tariff.deviceLimit != null ? String(tariff.deviceLimit) : "");
      setIncludedDevices(tariff.includedDevices ?? 1);
      setPricePerExtraDevice(String(tariff.pricePerExtraDevice ?? 0));
      setMaxExtraDevices(tariff.maxExtraDevices ?? 0);
      setExtraDevicesEnabled((tariff.maxExtraDevices ?? 0) > 0);
      setDiscountTiers(buildInitialTiers(tariff));
      setDiscountsEnabled((tariff.deviceDiscountTiers?.length ?? 0) > 0);
      setCurrency((tariff.currency ?? "usd").toLowerCase());
      setLavatopOfferId(tariff.lavatopOfferId ?? "");
    } else {
      setName("");
      setDescription("");
      setPriceOptions([{ uid: makeDraftUid(), days: 30, price: "0" }]);
      setSelectedSquadUuids([]);
      setTrafficGb("");
      setTrafficResetMode("no_reset");
      setDeviceLimit("");
      setIncludedDevices(1);
      setPricePerExtraDevice("0");
      setMaxExtraDevices(0);
      setExtraDevicesEnabled(false);
      setDiscountTiers([]);
      setDiscountsEnabled(false);
      setCurrency("usd");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, isEdit, tariff]);

  const [squadsOpen, setSquadsOpen] = useState(false);
  const squadsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (squadsRef.current && !squadsRef.current.contains(e.target as Node)) {
        setSquadsOpen(false);
      }
    };
    if (squadsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [squadsOpen]);

  const toggleSquad = (uuid: string) => {
    setSelectedSquadUuids((prev) =>
      prev.includes(uuid) ? prev.filter((id) => id !== uuid) : [...prev, uuid]
    );
  };

  const selectedSquadsList = squads.filter((s) => selectedSquadUuids.includes(s.uuid));
  const squadsTriggerLabel =
    selectedSquadUuids.length === 0
      ? "Выберите сквады…"
      : selectedSquadUuids.length === 1
        ? selectedSquadsList[0]?.name || selectedSquadsList[0]?.uuid || "1 сквад"
        : `Выбрано: ${selectedSquadUuids.length}`;

  // ——— priceOptions helpers ———
  const updatePriceOption = (uid: string, patch: Partial<Pick<PriceOptionDraft, "days" | "price">>) => {
    setPriceOptions((prev) => prev.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  };

  const removePriceOption = (uid: string) => {
    setPriceOptions((prev) => (prev.length <= 1 ? prev : prev.filter((o) => o.uid !== uid)));
  };

  const addPriceOption = (days?: number) => {
    setPriceOptions((prev) => {
      if (prev.length >= MAX_PRICE_OPTIONS) return prev;
      return [...prev, { uid: makeDraftUid(), days: days ?? 1, price: "" }];
    });
  };

  const priceOptionsSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handlePriceOptionsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPriceOptions((prev) => {
      const oldIndex = prev.findIndex((o) => o.uid === active.id);
      const newIndex = prev.findIndex((o) => o.uid === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // ——— discount tiers helpers ———
  const updateTier = (uid: string, patch: Partial<Pick<DiscountTierDraft, "minExtraDevices" | "discountPercent">>) => {
    setDiscountTiers((prev) => prev.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  };
  const removeTier = (uid: string) => {
    setDiscountTiers((prev) => prev.filter((o) => o.uid !== uid));
  };
  const addTier = () => {
    setDiscountTiers((prev) => {
      if (prev.length >= MAX_DISCOUNT_TIERS) return prev;
      const maxMin = prev.reduce((m, t) => Math.max(m, t.minExtraDevices), 1);
      return [...prev, { uid: makeDraftUid(), minExtraDevices: Math.min(maxMin + 1, Math.max(1, maxExtraDevices)), discountPercent: "10" }];
    });
  };
  const applyDiscountPreset = (presetIdx: number) => {
    const preset = DISCOUNT_PRESETS[presetIdx];
    if (!preset) return;
    setDiscountTiers(preset.tiers.map((t) => ({ uid: makeDraftUid(), minExtraDevices: t.minExtraDevices, discountPercent: String(t.discountPercent) })));
    setDiscountsEnabled(true);
  };

  // ——— derived: лучший $/день и дубликаты дней ———
  const pricePerDayList = priceOptions.map((o) => {
    const p = parsePriceNumber(o.price);
    if (p == null || o.days <= 0) return null;
    return p / o.days;
  });
  const validPpd = pricePerDayList.filter((v): v is number => v != null && Number.isFinite(v));
  const minPpd = validPpd.length > 0 ? Math.min(...validPpd) : null;
  const bestUid =
    minPpd != null
      ? priceOptions[pricePerDayList.findIndex((v) => v != null && v === minPpd)]?.uid ?? null
      : null;

  const seenDays = new Set<number>();
  const duplicateUids = new Set<string>();
  for (const o of priceOptions) {
    if (seenDays.has(o.days)) duplicateUids.add(o.uid);
    else seenDays.add(o.days);
  }
  const hasDuplicates = duplicateUids.size > 0;

  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || selectedSquadUuids.length === 0) return;

    // Валидация priceOptions
    if (priceOptions.length === 0) {
      setValidationError("Добавьте хотя бы одну опцию цены");
      return;
    }
    if (priceOptions.length > MAX_PRICE_OPTIONS) {
      setValidationError(`Максимум ${MAX_PRICE_OPTIONS} опций`);
      return;
    }
    const normalized: { durationDays: number; price: number }[] = [];
    for (const o of priceOptions) {
      if (!Number.isInteger(o.days) || o.days < 1 || o.days > 3650) {
        setValidationError("Длительность опции должна быть целым числом от 1 до 3650 дней");
        return;
      }
      const p = parsePriceNumber(o.price);
      if (p == null || p < 0) {
        setValidationError("Цена опции должна быть числом ≥ 0");
        return;
      }
      normalized.push({ durationDays: o.days, price: p });
    }
    if (hasDuplicates) {
      setValidationError("Опции с одинаковой длительностью не допускаются");
      return;
    }
    setValidationError(null);

    const trafficLimitBytes =
      trafficGb.trim() !== "" ? Math.round(parseFloat(trafficGb) * BYTES_PER_GB) : null;
    const deviceLimitNum = deviceLimit.trim() !== "" ? parseInt(deviceLimit, 10) : null;
    if (deviceLimit.trim() !== "" && (isNaN(deviceLimitNum!) || deviceLimitNum! < 0)) return;

    // Нормализуем лесенку скидок: только если включены extras + tiers.
    const effectiveMaxExtras = extraDevicesEnabled ? Math.max(0, maxExtraDevices) : 0;
    let normalizedTiers: { minExtraDevices: number; discountPercent: number }[] = [];
    if (extraDevicesEnabled && discountsEnabled && discountTiers.length > 0) {
      const seen = new Set<number>();
      for (const t of discountTiers) {
        if (!Number.isInteger(t.minExtraDevices) || t.minExtraDevices < 1) {
          setValidationError("Порог скидки: минимум доп. устройств должен быть целым ≥ 1");
          return;
        }
        if (t.minExtraDevices > effectiveMaxExtras) {
          setValidationError(`Порог ${t.minExtraDevices} больше максимума доп. устройств (${effectiveMaxExtras})`);
          return;
        }
        if (seen.has(t.minExtraDevices)) {
          setValidationError(`Дублирующийся порог: ${t.minExtraDevices} доп. устройств`);
          return;
        }
        seen.add(t.minExtraDevices);
        const pct = parseFloat(t.discountPercent);
        if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
          setValidationError("Скидка: число от 0 до 90%");
          return;
        }
        normalizedTiers.push({ minExtraDevices: t.minExtraDevices, discountPercent: pct });
      }
      normalizedTiers.sort((a, b) => a.minExtraDevices - b.minExtraDevices);
    }
    const pricePerExtraNum = parseFloat(pricePerExtraDevice);
    const effectivePricePerExtra = extraDevicesEnabled && Number.isFinite(pricePerExtraNum) && pricePerExtraNum > 0 ? pricePerExtraNum : 0;

    setSaving(true);
    try {
      if (isEdit && tariff) {
        const payload: UpdateTariffPayload = {
          name: name.trim(),
          description: description.trim() || null,
          internalSquadUuids: selectedSquadUuids,
          trafficLimitBytes: trafficLimitBytes ?? null,
          trafficResetMode,
          deviceLimit: deviceLimitNum ?? null,
          includedDevices,
          pricePerExtraDevice: effectivePricePerExtra,
          maxExtraDevices: effectiveMaxExtras,
          deviceDiscountTiers: normalizedTiers,
          currency: currency || "usd",
          lavatopOfferId: lavatopOfferId.trim() || null,
          priceOptions: normalized,
        };
        await api.updateTariff(token, tariff.id, payload);
      } else {
        const payload: CreateTariffPayload = {
          categoryId,
          name: name.trim(),
          description: description.trim() || null,
          internalSquadUuids: selectedSquadUuids,
          trafficLimitBytes: trafficLimitBytes ?? null,
          trafficResetMode,
          deviceLimit: deviceLimitNum ?? null,
          includedDevices,
          pricePerExtraDevice: effectivePricePerExtra,
          maxExtraDevices: effectiveMaxExtras,
          deviceDiscountTiers: normalizedTiers,
          currency: currency || "usd",
          lavatopOfferId: lavatopOfferId.trim() || null,
          priceOptions: normalized,
        };
        await api.createTariff(token, payload);
      }
      onSaved();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background/80 backdrop-blur-3xl border-white/10 rounded-[2rem] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-inner">
              {isEdit ? <Pencil className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
            </div>
            {isEdit ? "Редактировать тариф" : "Новый тариф"}
          </DialogTitle>
          <DialogDescription className="sr-only">Форма тарифа</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="tariff-name" className="text-xs text-muted-foreground">Название</Label>
            <Input
              id="tariff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: 30 дней, 1 год"
              required
              className={inputCls}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tariff-desc" className="text-xs text-muted-foreground">Описание (необязательно)</Label>
            <textarea
              id="tariff-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание тарифа для клиентов"
              rows={3}
              maxLength={5000}
              className="flex min-h-[80px] w-full rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          {/* Опции цен — множественные варианты длительности */}
          <div className="rounded-2xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
                  <Tag className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold tracking-tight">Опции цен</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                    Можно добавить несколько вариантов длительности — клиент выберет при покупке
                  </p>
                </div>
              </div>
              {minPpd != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 px-2.5 py-1 text-[11px] font-bold shrink-0">
                  <TrendingDown className="h-3 w-3" />
                  Лучшая цена/день: {formatPrice(minPpd, currency)}
                </span>
              )}
            </div>

            {/* Селектор валюты — компактный, рядом с опциями */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="grid gap-1">
                <Label htmlFor="tariff-currency" className="text-[11px] text-muted-foreground">Валюта</Label>
                <select
                  id="tariff-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={selectCls}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Lava.top Offer ID — для подписки MONTHLY на этот тариф */}
            <div className="grid gap-1">
              <Label htmlFor="tariff-lavatop-offer" className="text-[11px] text-muted-foreground">
                Lava.top Offer ID <span className="text-[10px] opacity-60">(UUID оффера для MONTHLY-подписки)</span>
              </Label>
              <Input
                id="tariff-lavatop-offer"
                value={lavatopOfferId}
                onChange={(e) => setLavatopOfferId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Создайте оффер в Lava.top dashboard с ценой = цене тарифа. При оплате через Lava.top создастся <b>подписка</b> с авто-списанием раз в месяц. Если пусто — используется Default Offer ID из настроек.
              </p>
            </div>

            <DndContext
              sensors={priceOptionsSensors}
              collisionDetection={closestCenter}
              onDragEnd={handlePriceOptionsDragEnd}
            >
              <SortableContext
                items={priceOptions.map((o) => o.uid)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {priceOptions.map((opt) => (
                    <SortablePriceOptionRow
                      key={opt.uid}
                      option={opt}
                      isOnly={priceOptions.length === 1}
                      isBest={opt.uid === bestUid}
                      isDuplicate={duplicateUids.has(opt.uid)}
                      currency={currency}
                      onChangeDays={(v) => updatePriceOption(opt.uid, { days: v })}
                      onChangePrice={(v) => updatePriceOption(opt.uid, { price: v })}
                      onRemove={() => removePriceOption(opt.uid)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {hasDuplicates && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Найдены опции с одинаковой длительностью — оставьте только уникальные</span>
              </div>
            )}

            {/* Пресеты */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground/80 mr-1">Быстрое добавление:</span>
              {PRICE_OPTION_PRESETS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addPriceOption(days)}
                  disabled={priceOptions.length >= MAX_PRICE_OPTIONS}
                  className="gap-1 rounded-lg h-7 px-2.5 text-[11px] border-white/10 bg-foreground/[0.04] dark:bg-white/[0.03] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06]"
                >
                  <Plus className="h-3 w-3" />
                  {days} {days === 1 ? "день" : days < 5 ? "дня" : "дней"}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPriceOption(undefined)}
                disabled={priceOptions.length >= MAX_PRICE_OPTIONS}
                className="gap-1 rounded-lg h-7 px-2.5 text-[11px] border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary"
                title="Добавить пустую опцию для ручного заполнения"
              >
                <Plus className="h-3 w-3" />
                Опция
              </Button>
              {priceOptions.length >= MAX_PRICE_OPTIONS && (
                <span className="text-[10px] text-muted-foreground/70">Максимум {MAX_PRICE_OPTIONS} опций</span>
              )}
            </div>
          </div>
          <div ref={squadsRef} className="relative">
            <Label className="text-xs text-muted-foreground">Сквады (Remna)</Label>
            <p className="text-[11px] text-muted-foreground/80 mb-1.5 mt-1">Один или несколько внутренних сквадов</p>
            {squads.length === 0 ? (
              <div className="flex h-10 items-center rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 text-sm text-muted-foreground">
                Список сквадов пуст или Remna не настроен
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSquadsOpen((o) => !o)}
                  className="flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/[0.05] dark:hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={selectedSquadUuids.length === 0 ? "text-muted-foreground" : ""}>
                    {squadsTriggerLabel}
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", squadsOpen && "rotate-180")}
                  />
                </button>
                {squadsOpen && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border border-white/10 bg-background/95 backdrop-blur-3xl shadow-2xl">
                    <div className="max-h-48 overflow-y-auto p-1">
                      {squads.map((s) => {
                        const checked = selectedSquadUuids.includes(s.uuid);
                        return (
                          <button
                            key={s.uuid}
                            type="button"
                            onClick={() => toggleSquad(s.uuid)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-foreground/[0.05] dark:hover:bg-white/[0.05] focus:outline-none transition-colors"
                          >
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                checked ? "bg-primary border-primary text-primary-foreground" : "border-white/20"
                              )}
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="truncate">{s.name || s.uuid}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tariff-traffic" className="text-xs text-muted-foreground">Лимит трафика (ГБ)</Label>
            <Input
              id="tariff-traffic"
              type="number"
              min={0}
              step={0.1}
              value={trafficGb}
              onChange={(e) => setTrafficGb(e.target.value)}
              placeholder="Не ограничено"
              className={inputCls}
            />
            <p className="text-[11px] text-muted-foreground/80">1 ГБ = 1024³ байт (ГиБ). В Remna передаётся лимит в байтах.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tariff-reset-mode" className="text-xs text-muted-foreground">Сброс трафика</Label>
            <select
              id="tariff-reset-mode"
              value={trafficResetMode}
              onChange={(e) => setTrafficResetMode(e.target.value)}
              className={selectCls}
            >
              <option value="no_reset">Без сброса</option>
              <option value="on_purchase">Сброс при покупке тарифа</option>
              <option value="monthly">Ежемесячный сброс</option>
              <option value="monthly_rolling">Скользящий месяц</option>
            </select>
            <p className="text-[11px] text-muted-foreground/80">
              {trafficResetMode === "no_reset" && "Трафик не сбрасывается — лимит действует на весь срок тарифа."}
              {trafficResetMode === "on_purchase" && "Трафик обнуляется при каждой покупке/продлении тарифа."}
              {trafficResetMode === "monthly" && "Трафик обнуляется каждый месяц (Remna MONTH). Например: 10 ГБ/мес на 3 месяца."}
              {trafficResetMode === "monthly_rolling" && "Трафик сбрасывается через 30 дней от последнего сброса (Remna MONTH_ROLLING)."}
            </p>
          </div>
          <DeviceSection
            includedDevices={includedDevices}
            setIncludedDevices={setIncludedDevices}
            pricePerExtraDevice={pricePerExtraDevice}
            setPricePerExtraDevice={setPricePerExtraDevice}
            maxExtraDevices={maxExtraDevices}
            setMaxExtraDevices={setMaxExtraDevices}
            extraDevicesEnabled={extraDevicesEnabled}
            setExtraDevicesEnabled={setExtraDevicesEnabled}
            discountsEnabled={discountsEnabled}
            setDiscountsEnabled={setDiscountsEnabled}
            tiers={discountTiers}
            updateTier={updateTier}
            removeTier={removeTier}
            addTier={addTier}
            applyPreset={applyDiscountPreset}
            basePrice={parsePriceNumber(priceOptions[0]?.price ?? "0") ?? 0}
            currency={currency}
          />

          {/* Legacy lone deviceLimit — оставляем как опциональный override для совместимости */}
          <details className="group">
            <summary className="text-[11px] text-muted-foreground/70 cursor-pointer hover:text-muted-foreground select-none">
              Старое поле «Жёсткий лимит устройств» (legacy, скрыто) ▾
            </summary>
            <div className="grid gap-1.5 mt-2">
              <Label htmlFor="tariff-devices" className="text-xs text-muted-foreground">Лимит устройств (legacy)</Label>
              <Input
                id="tariff-devices"
                type="number"
                min={0}
                value={deviceLimit}
                onChange={(e) => setDeviceLimit(e.target.value)}
                placeholder="Не используется в новой модели"
                className={inputCls}
              />
              <p className="text-[10px] text-muted-foreground/60">Раньше устанавливал HWID лимит. В новой модели лимит = выбранное клиентом число устройств.</p>
            </div>
          </details>
          {validationError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">Отмена</Button>
            <Button
              type="submit"
              disabled={saving || selectedSquadUuids.length === 0 || hasDuplicates || priceOptions.length === 0}
              className="gap-2 rounded-xl"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
