/**
 * Редактор лендинга — Phase 3 (MVP):
 * - список блоков (видимость, реордер кнопками, выбор для редактирования)
 * - drawer с raw-JSON редактированием props и i18n
 * - Publish-all / Discard-all-drafts
 * - Создание блока (выбор type)
 * - Список снапшотов с restore (в модальном окне)
 *
 * Live-preview iframe и автогенерация формы по schema — Phase 4/5.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Eye,
  Save,
  Trash2,
  RotateCcw,
  Camera,
  History,
  CheckCircle2,
  AlertCircle,
  Globe,
  Loader2,
  Palette,
  Code,
  FormInput,
  Sparkles,
  Star,
  Award,
  BarChart3,
  Tag,
  Monitor,
  HelpCircle,
  Megaphone,
  Layers,
  ImageIcon,
  MessageSquare,
  Video,
  Minus,
  GripVertical,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  landingEditorApi,
  type AdminLandingBlock,
  type AdminLandingSnapshot,
  type DraftsStatus,
} from "@/lib/landing-editor-api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SchemaForm } from "@/components/landing-editor/schema-form";
import { getBlockSchema, BLOCK_SCHEMAS, VARIANT_DESCRIPTIONS } from "@/components/landing-editor/block-schemas";
import { ThemeDialog } from "@/components/landing-editor/theme-dialog";

/** Маппинг имени иконки в schema.icon → компонент. */
const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles, Star, Award, BarChart3, Tag, Monitor, HelpCircle, Megaphone, Layers,
  ImageIcon, MessageSquare, Video, Minus,
};

function blockIcon(type: string): LucideIcon {
  const name = BLOCK_SCHEMAS[type]?.icon;
  return (name && ICON_MAP[name]) || Layers;
}

/** Все доступные блоки для добавления — из BLOCK_SCHEMAS, по одному на вариант. */
const ADDABLE_BLOCKS: { type: string; variant: string; label: string; description: string; iconName: string }[] = (() => {
  const out: { type: string; variant: string; label: string; description: string; iconName: string }[] = [];
  for (const [type, schema] of Object.entries(BLOCK_SCHEMAS)) {
    for (const v of schema.variants) {
      const description =
        type === "custom"
          ? VARIANT_DESCRIPTIONS[`${type}/${v.value}`] ?? schema.description ?? ""
          : schema.description ?? "";
      out.push({
        type,
        variant: v.value,
        label: type === "custom" ? v.label : `${schema.label} — ${v.label}`,
        description,
        iconName: schema.icon,
      });
    }
  }
  return out;
})();

/** Возвращает русское «человеческое» имя блока: «Главный экран — Две колонки». */
function blockLabel(b: AdminLandingBlock): string {
  const schema = BLOCK_SCHEMAS[b.type];
  if (!schema) return `${b.type}/${b.variant}`;
  const v = schema.variants.find((x) => x.value === b.variant);
  const variantLabel = v?.label ?? b.variant;
  if (b.type === "custom") return variantLabel;
  // Если у блока всего один вариант — не показываем подпись варианта (избыточно).
  if (schema.variants.length === 1) return schema.label;
  return `${schema.label} — ${variantLabel}`;
}

function blockTechName(b: AdminLandingBlock): string {
  return `${b.type}/${b.variant}`;
}

function hasDraft(b: AdminLandingBlock): boolean {
  return b.propsDraft !== null || b.i18nDraft !== null;
}

export function LandingEditorPage() {
  const { state } = useAuth();
  const token = state.accessToken;

  const [blocks, setBlocks] = useState<AdminLandingBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftsStatus>({ hasBlockDrafts: false, hasThemeDraft: false });
  const [landingEnabled, setLandingEnabled] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [list, status, landingStatus] = await Promise.all([
        landingEditorApi.listBlocks(token),
        landingEditorApi.draftsStatus(token),
        landingEditorApi.getStatus(token),
      ]);
      setBlocks(list);
      setDrafts(status);
      setLandingEnabled(landingStatus.enabled);
      setError(null);
      // Триггерим перезагрузку iframe-превью.
      setPreviewKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleToggleLanding = async (next: boolean) => {
    if (!token) return;
    if (!next && !confirm("Выключить лендинг? Корень сайта будет редиректить в /cabinet.")) return;
    try {
      const result = await landingEditorApi.setStatus(token, next);
      setLandingEnabled(result.enabled);
      showToast("ok", result.enabled ? "Лендинг включён" : "Лендинг выключен");
    } catch (e) {
      showToast("err", String(e));
    }
  };

  useEffect(() => {
    reload();
  }, [reload]);

  // Click-to-edit: iframe-превью посылает {type: 'stealthnet-landing:edit-block', id}.
  // Селектим соответствующий блок в редакторе.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as { type?: string; id?: string };
      if (msg?.type === "stealthnet-landing:edit-block" && typeof msg.id === "string") {
        setSelectedId(msg.id);
        // Открываем форму если превью занимает весь правый край (иначе пользователь не увидит).
        if (!previewVisible) setPreviewVisible(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewVisible]);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? null, [blocks, selectedId]);

  const handleToggleVisible = async (id: string, visible: boolean) => {
    if (!token) return;
    try {
      await landingEditorApi.updateBlock(token, id, { visible });
      await reload();
    } catch (e) {
      showToast("err", String(e));
    }
  };

  const handleReorder = async (id: string, direction: "up" | "down") => {
    if (!token) return;
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= blocks.length) return;

    // Свопаем order у двух блоков
    const a = blocks[idx];
    const b = blocks[target];
    try {
      await landingEditorApi.reorderBlocks(token, [
        { id: a.id, order: b.order },
        { id: b.id, order: a.order },
      ]);
      await reload();
    } catch (e) {
      showToast("err", String(e));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!token) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(blocks, oldIndex, newIndex);
    // Оптимистично обновляем UI.
    setBlocks(next);
    try {
      // Назначаем новые order'ы сериями по 10 для удобства будущих вставок.
      await landingEditorApi.reorderBlocks(
        token,
        next.map((b, i) => ({ id: b.id, order: (i + 1) * 10 })),
      );
      await reload();
    } catch (e) {
      showToast("err", String(e));
      await reload();
    }
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDelete = async (id: string) => {
    if (!token) return;
    if (!confirm("Удалить блок? Будет создан авто-снапшот при следующем Publish.")) return;
    try {
      await landingEditorApi.deleteBlock(token, id);
      if (selectedId === id) setSelectedId(null);
      await reload();
      showToast("ok", "Блок удалён");
    } catch (e) {
      showToast("err", String(e));
    }
  };

  const handleAddBlock = async (type: string, variant: string) => {
    if (!token) return;
    try {
      const created = await landingEditorApi.createBlock(token, { type, variant, props: {}, i18n: { ru: {} } });
      await reload();
      setSelectedId(created.id);
      setAddOpen(false);
      showToast("ok", `Блок ${type}/${variant} добавлен`);
    } catch (e) {
      showToast("err", String(e));
    }
  };

  const handlePublishAll = async () => {
    if (!token) return;
    if (!confirm("Опубликовать все черновики? Будет создан авто-снапшот.")) return;
    setBusy(true);
    try {
      const result = await landingEditorApi.publishAll(token);
      await reload();
      showToast("ok", `Опубликовано: ${result.publishedBlocks} блоков, тема: ${result.themePublished ? "да" : "нет"}`);
    } catch (e) {
      showToast("err", String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscardAll = async () => {
    if (!token) return;
    if (!confirm("Отбросить все черновики? Действие необратимо.")) return;
    setBusy(true);
    try {
      await landingEditorApi.discardAllDrafts(token);
      await reload();
      showToast("ok", "Черновики отброшены");
    } catch (e) {
      showToast("err", String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleManualSnapshot = async () => {
    if (!token) return;
    const label = prompt("Название снапшота (можно пустое):", "manual");
    if (label === null) return;
    setBusy(true);
    try {
      await landingEditorApi.createSnapshot(token, label || undefined);
      showToast("ok", "Снапшот создан");
    } catch (e) {
      showToast("err", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Toast */}
      {toast ? (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
              : "border-red-500/30 bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-100"
          }`}
        >
          {toast.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.text}
        </div>
      ) : null}

      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-md">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/settings" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Настройки
              </Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <Globe className="h-5 w-5 text-emerald-500" />
            <h1 className="text-xl font-bold">Редактор лендинга</h1>
            <div className="ml-2 flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1">
              <Switch checked={landingEnabled} onCheckedChange={handleToggleLanding} />
              <span className={`text-xs font-medium ${landingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {landingEnabled ? "Лендинг включён" : "Лендинг выключен"}
              </span>
            </div>
            {(drafts.hasBlockDrafts || drafts.hasThemeDraft) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <AlertCircle className="h-3 w-3" />
                Есть черновики
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setPreviewVisible((v) => !v)} variant={previewVisible ? "default" : "outline"} size="sm" className="gap-1.5">
              <Eye className="h-4 w-4" />
              {previewVisible ? "Скрыть превью" : "Превью"}
            </Button>
            <Button onClick={() => setThemeOpen(true)} variant="outline" size="sm" className="gap-1.5">
              <Palette className="h-4 w-4" />
              Тема
            </Button>
            <Button onClick={handleManualSnapshot} variant="outline" size="sm" className="gap-1.5" disabled={busy}>
              <Camera className="h-4 w-4" />
              Снапшот
            </Button>
            <Button onClick={() => setSnapshotsOpen(true)} variant="outline" size="sm" className="gap-1.5">
              <History className="h-4 w-4" />
              История
            </Button>
            <div className="h-6 w-px bg-border" />
            <Button
              onClick={handleDiscardAll}
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy || !drafts.hasBlockDrafts}
            >
              <RotateCcw className="h-4 w-4" />
              Отбросить
            </Button>
            <Button
              onClick={handlePublishAll}
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy || (!drafts.hasBlockDrafts && !drafts.hasThemeDraft)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Опубликовать
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-50 p-6 text-sm text-red-900 dark:bg-red-950/50 dark:text-red-100">
            Ошибка загрузки: {error}
          </div>
        ) : (
          <div className={`grid gap-6 ${previewVisible ? "lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,1.1fr)]" : "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"}`}>
            {/* Block list */}
            <Card>
              <CardContent className="p-3">
                <div className="mb-3 flex items-center justify-between px-2">
                  <Label className="text-sm font-semibold">Блоки лендинга ({blocks.length})</Label>
                  <Button onClick={() => setAddOpen(true)} size="sm" variant="ghost" className="h-8 gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </Button>
                </div>
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5">
                      {blocks.map((b, idx) => (
                        <SortableBlockRow
                          key={b.id}
                          block={b}
                          isFirst={idx === 0}
                          isLast={idx === blocks.length - 1}
                          isSelected={selectedId === b.id}
                          onSelect={() => setSelectedId(b.id)}
                          onMoveUp={() => handleReorder(b.id, "up")}
                          onMoveDown={() => handleReorder(b.id, "down")}
                          onToggleVisible={(v) => handleToggleVisible(b.id, v)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>

            {/* Editor */}
            <Card className="min-w-0">
              <CardContent className="p-6">
                {!selected ? (
                  <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
                    <Eye className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <h3 className="text-lg font-semibold">Выберите блок слева</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Каждый блок редактируется как JSON. После Publish — изменения видны на лендинге.
                      </p>
                    </div>
                  </div>
                ) : (
                  <BlockEditor
                    key={selected.id}
                    block={selected}
                    token={token!}
                    onSaved={async () => {
                      await reload();
                      showToast("ok", "Сохранено в черновик");
                    }}
                    onError={(e) => showToast("err", e)}
                    onDelete={() => handleDelete(selected.id)}
                    onPublishOne={async () => {
                      try {
                        await landingEditorApi.publishBlock(token!, selected.id);
                        await reload();
                        showToast("ok", "Блок опубликован");
                      } catch (e) {
                        showToast("err", String(e));
                      }
                    }}
                    onDiscardOne={async () => {
                      try {
                        await landingEditorApi.discardBlockDraft(token!, selected.id);
                        await reload();
                        showToast("ok", "Черновик отброшен");
                      } catch (e) {
                        showToast("err", String(e));
                      }
                    }}
                    onApplyDefaults={async (mode) => {
                      try {
                        await landingEditorApi.applyBlockDefaults(token!, selected.id, mode);
                        await reload();
                        showToast("ok", "Дефолты применены в черновик. Жми «Опубликовать», чтобы сохранить.");
                      } catch (e) {
                        showToast("err", String(e));
                      }
                    }}
                  />
                )}
              </CardContent>
            </Card>

            {/* Live preview iframe */}
            {previewVisible ? (
              <Card className="min-w-0 overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5" />
                      <span className="font-medium">Превью лендинга (с черновиками)</span>
                    </div>
                    <Button
                      onClick={() => setPreviewKey((k) => k + 1)}
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      title="Обновить"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Обновить
                    </Button>
                  </div>
                  <iframe
                    key={previewKey}
                    src="/admin/landing-preview"
                    title="Landing preview"
                    className="block h-[calc(100vh-200px)] w-full bg-background"
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>

      {/* Add Block dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить блок</DialogTitle>
            <DialogDescription>Выберите тип. Блок будет создан в конце списка с пустыми полями.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 max-h-[60vh] overflow-y-auto py-1">
            {ADDABLE_BLOCKS.map((bt) => {
              const Icon = ICON_MAP[bt.iconName] ?? Layers;
              return (
                <button
                  key={`${bt.type}/${bt.variant}`}
                  onClick={() => handleAddBlock(bt.type, bt.variant)}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{bt.label}</div>
                    {bt.description ? <div className="mt-0.5 text-xs text-muted-foreground">{bt.description}</div> : null}
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{bt.type}/{bt.variant}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <SnapshotsDialog
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        token={token}
        onRestored={async () => {
          setSnapshotsOpen(false);
          await reload();
          showToast("ok", "Снапшот восстановлен");
        }}
        onError={(e) => showToast("err", e)}
      />

      <ThemeDialog
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        token={token}
        onChanged={async () => {
          await reload();
        }}
        onError={(e) => showToast("err", e)}
        onSuccess={(m) => showToast("ok", m)}
      />
    </div>
  );
}

// ─── SortableBlockRow (drag-drop через @dnd-kit) ─────────────────────────────

interface SortableBlockRowProps {
  block: AdminLandingBlock;
  isFirst: boolean;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisible: (v: boolean) => void;
}

function SortableBlockRow({ block, isFirst, isLast, isSelected, onSelect, onMoveUp, onMoveDown, onToggleVisible }: SortableBlockRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const Icon = blockIcon(block.type);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors cursor-pointer ${
        isSelected ? "border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/30" : "border-border hover:bg-accent"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="-ml-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
        title="Перетащить"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex flex-col gap-0.5">
        <Button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={isFirst}>
          <ArrowUp className="h-3 w-3" />
        </Button>
        <Button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={isLast}>
          <ArrowDown className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{blockLabel(block)}</span>
          {hasDraft(block) ? (
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Есть несохранённые изменения" />
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">{blockTechName(block)}</div>
      </div>
      <Switch
        checked={block.visible}
        onCheckedChange={onToggleVisible}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── BlockEditor (правый сайд) ───────────────────────────────────────────────

interface BlockEditorProps {
  block: AdminLandingBlock;
  token: string;
  onSaved: () => Promise<void> | void;
  onError: (msg: string) => void;
  onDelete: () => void;
  onPublishOne: () => Promise<void> | void;
  onDiscardOne: () => Promise<void> | void;
  onApplyDefaults: (mode: "merge" | "overwrite") => Promise<void> | void;
}

function BlockEditor({ block, token, onSaved, onError, onDelete, onPublishOne, onDiscardOne, onApplyDefaults }: BlockEditorProps) {
  const draftedProps = (block.propsDraft ?? block.props) as Record<string, unknown>;
  const draftedI18n = (block.i18nDraft ?? block.i18n) as Record<string, unknown>;

  const schema = getBlockSchema(block.type, block.variant);

  // Form state — структурный.
  const [variant, setVariant] = useState(block.variant);
  const [propsObj, setPropsObj] = useState<Record<string, unknown>>(draftedProps);
  const [i18nRu, setI18nRu] = useState<Record<string, unknown>>(
    typeof draftedI18n.ru === "object" && draftedI18n.ru !== null ? (draftedI18n.ru as Record<string, unknown>) : {},
  );

  // Raw-JSON fallback state (синхронизируется при переключении).
  const [propsText, setPropsText] = useState(() => JSON.stringify(draftedProps, null, 2));
  const [i18nText, setI18nText] = useState(() => JSON.stringify(draftedI18n, null, 2));
  const [propsError, setPropsError] = useState<string | null>(null);
  const [i18nError, setI18nError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "json">(schema ? "form" : "json");

  const [saving, setSaving] = useState(false);

  const drafted = block.propsDraft !== null || block.i18nDraft !== null;

  const handleSave = async () => {
    let finalProps: Record<string, unknown>;
    let finalI18n: Record<string, unknown>;

    if (mode === "form") {
      finalProps = stripUndefined(propsObj);
      finalI18n = { ru: stripUndefined(i18nRu) };
    } else {
      try {
        finalProps = JSON.parse(propsText);
        setPropsError(null);
      } catch (e) {
        setPropsError(String(e));
        return;
      }
      try {
        finalI18n = JSON.parse(i18nText);
        setI18nError(null);
      } catch (e) {
        setI18nError(String(e));
        return;
      }
    }

    setSaving(true);
    try {
      await landingEditorApi.updateBlock(token, block.id, {
        propsDraft: finalProps,
        i18nDraft: finalI18n,
        variant: variant !== block.variant ? variant : undefined,
      });
      await onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {(() => {
            const Icon = ICON_MAP[BLOCK_SCHEMAS[block.type]?.icon ?? ""] ?? Layers;
            return (
              <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Icon className="h-5 w-5" />
              </div>
            );
          })()}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Блок</div>
            <h2 className="mt-1 text-2xl font-bold">
              {schema?.label ?? block.type}
              {schema && schema.variants.length > 1 ? (
                <span className="text-muted-foreground"> · {schema.variants.find((v) => v.value === variant)?.label ?? variant}</span>
              ) : null}
            </h2>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{block.type}/{variant} · id {block.id.slice(0, 8)}…</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onApplyDefaults("merge")}
            variant="outline"
            size="sm"
            className="gap-1.5"
            title="Заполнить пустые поля стандартными значениями (то, что показывает live-превью). Уже заполненные поля не трогаем."
          >
            <Wand2 className="h-3.5 w-3.5" />
            Стандарт
          </Button>
          {drafted ? (
            <>
              <Button onClick={onDiscardOne} variant="outline" size="sm" className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Отбросить
              </Button>
              <Button onClick={onPublishOne} size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Опубликовать
              </Button>
            </>
          ) : null}
          <Button onClick={onDelete} variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700">
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </Button>
        </div>
      </div>

      {/* Variant select / input */}
      <div>
        <Label htmlFor="variant-input" className="text-sm font-semibold">Variant</Label>
        {schema && schema.variants.length > 1 ? (
          <select
            id="variant-input"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="mt-1.5 flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {schema.variants.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        ) : (
          <Input
            id="variant-input"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="mt-1.5 max-w-xs"
          />
        )}
      </div>

      {/* Mode toggle */}
      <Tabs value={mode} onValueChange={(v) => {
        if (v === "json") {
          // При переключении в JSON синхронизируем тексты.
          setPropsText(JSON.stringify(stripUndefined(propsObj), null, 2));
          setI18nText(JSON.stringify({ ru: stripUndefined(i18nRu) }, null, 2));
        } else {
          // При переключении в форму — парсим JSON если он валидный.
          try {
            const parsed = JSON.parse(propsText);
            setPropsObj(parsed);
            setPropsError(null);
          } catch { /* keep old form state */ }
          try {
            const parsed = JSON.parse(i18nText);
            if (parsed.ru && typeof parsed.ru === "object") setI18nRu(parsed.ru);
            setI18nError(null);
          } catch { /* keep old form state */ }
        }
        setMode(v as "form" | "json");
      }}>
        <TabsList>
          <TabsTrigger value="form" className="gap-1.5">
            <FormInput className="h-3.5 w-3.5" />
            Форма
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <Code className="h-3.5 w-3.5" />
            Raw JSON
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form" className="mt-5 space-y-6">
          {schema ? (
            <>
              <section>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Контент (RU)</h3>
                <SchemaForm fields={schema.i18nFields} value={i18nRu} onChange={setI18nRu} />
              </section>
              <section className="border-t pt-5">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Структура</h3>
                <SchemaForm fields={schema.propsFields} value={propsObj} onChange={setPropsObj} />
              </section>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Schema не найдена для блока {block.type}/{variant}. Используйте Raw JSON.
            </div>
          )}
        </TabsContent>

        <TabsContent value="json" className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">props</Label>
              {propsError ? <span className="text-xs text-red-500">{propsError}</span> : null}
            </div>
            <Textarea value={propsText} onChange={(e) => setPropsText(e.target.value)} rows={10} className="mt-1.5 font-mono text-xs" placeholder="{}" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">i18n</Label>
              {i18nError ? <span className="text-xs text-red-500">{i18nError}</span> : null}
            </div>
            <Textarea value={i18nText} onChange={(e) => setI18nText(e.target.value)} rows={14} className="mt-1.5 font-mono text-xs" placeholder={'{ "ru": { "title": "..." } }'} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить в черновик
        </Button>
      </div>
    </div>
  );
}

/** Убирает undefined и пустые строки чтобы payload был чище. */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ─── Snapshots Dialog ────────────────────────────────────────────────────────

interface SnapshotsDialogProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  onRestored: () => Promise<void> | void;
  onError: (msg: string) => void;
}

function SnapshotsDialog({ open, onClose, token, onRestored, onError }: SnapshotsDialogProps) {
  const [snapshots, setSnapshots] = useState<AdminLandingSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    landingEditorApi
      .listSnapshots(token)
      .then(setSnapshots)
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [open, token, onError]);

  const handleRestore = async (id: string) => {
    if (!token) return;
    if (!confirm("Восстановить лендинг из этого снапшота? Текущее состояние сохранится как auto-snapshot.")) return;
    try {
      await landingEditorApi.restoreSnapshot(token, id);
      await onRestored();
    } catch (e) {
      onError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    if (!confirm("Удалить снапшот безвозвратно?")) return;
    try {
      await landingEditorApi.deleteSnapshot(token, id);
      setSnapshots((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>История снапшотов</DialogTitle>
          <DialogDescription>
            Авто-снапшоты создаются перед каждой публикацией и восстановлением.
            Можно создать ручной снапшот через кнопку «Снапшот» сверху.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Снапшотов пока нет</div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.label ?? "(без названия)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString("ru-RU")}{s.createdBy ? ` · ${s.createdBy}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button onClick={() => handleRestore(s.id)} size="sm" variant="outline" className="gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Восстановить
                  </Button>
                  <Button onClick={() => handleDelete(s.id)} size="sm" variant="outline" className="gap-1.5 text-red-600 hover:text-red-700">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

