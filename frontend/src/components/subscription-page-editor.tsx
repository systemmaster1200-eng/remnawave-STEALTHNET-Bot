/**
 * Визуальный редактор страницы подписки: включение/выключение приложений по платформам и изменение порядка (drag-and-drop).
 * За основу берётся базовый конфиг (subpage-00000000-0000-0000-0000-000000000000.json).
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Download, Smartphone } from "lucide-react";
import type { SubscriptionPageConfig } from "@/lib/api";

const PLATFORM_ORDER = ["ios", "android", "macos", "windows", "linux", "other"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  other: "Другое",
};

type SubscriptionPageApp = NonNullable<
  NonNullable<SubscriptionPageConfig>["platforms"]
>[string]["apps"] extends (infer A)[] | undefined
  ? A
  : never;

export type EditorApp = { id: string; enabled: boolean; app: SubscriptionPageApp };

function parseConfigJson(json: string | null): Record<string, { apps: EditorApp[] }> {
  if (!json?.trim()) return {};
  try {
    const data = JSON.parse(json) as SubscriptionPageConfig;
    const platforms = data?.platforms ?? {};
    const out: Record<string, { apps: EditorApp[] }> = {};
    for (const key of PLATFORM_ORDER) {
      const plat = platforms[key];
      const apps = plat?.apps ?? [];
      out[key] = {
        apps: apps.map((a, i) => ({
          id: `sub-${key}-${i}-${(a as { name?: string }).name ?? "app"}`,
          enabled: true,
          app: a as SubscriptionPageApp,
        })),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function configToJson(editorState: Record<string, { apps: EditorApp[] }>, baseMeta?: SubscriptionPageConfig): string {
  const platforms: NonNullable<SubscriptionPageConfig>["platforms"] = {};
  for (const key of PLATFORM_ORDER) {
    const entry = editorState[key];
    if (!entry) continue;
    const enabledApps = entry.apps.filter((a) => a.enabled).map((a) => a.app);
    if (enabledApps.length === 0) continue;
    const basePlatform = baseMeta?.platforms?.[key];
    platforms[key] = {
      ...(basePlatform ?? {}),
      apps: enabledApps,
    };
  }
  const result: SubscriptionPageConfig = {
    ...(baseMeta ?? {}),
    platforms,
  };
  return JSON.stringify(result, null, 2);
}

function mergeWithDefault(
  current: Record<string, { apps: EditorApp[] }>,
  defaultConfig: SubscriptionPageConfig | null
): Record<string, { apps: EditorApp[] }> {
  const def = defaultConfig?.platforms ?? {};
  const out: Record<string, { apps: EditorApp[] }> = {};
  for (const key of PLATFORM_ORDER) {
    const defaultApps = def[key]?.apps ?? [];
    const currentPlatform = current[key];
    const currentById = new Map(
      currentPlatform?.apps?.map((a) => [(a.app as { name?: string }).name ?? "", a]) ?? []
    );
    const merged: EditorApp[] = defaultApps.map((app, i) => {
      const name = (app as { name?: string }).name ?? `app-${i}`;
      const existing = currentById.get(name);
      return existing ?? { id: `sub-${key}-${i}-${name}`, enabled: true, app: app as SubscriptionPageApp };
    });
    out[key] = { apps: merged };
  }
  return out;
}

function SortableAppRow({
  item,
  onToggle,
}: {
  item: EditorApp;
  onToggle: (enabled: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const name = (item.app as { name?: string }).name ?? "—";
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 ${isDragging ? "opacity-80 shadow-md z-10" : ""}`}
    >
      <span
        className="flex h-8 w-8 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-lg bg-muted/80 text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
        title="Перетащите для изменения порядка"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <Checkbox
        id={item.id}
        checked={item.enabled}
        onCheckedChange={(v) => onToggle(v === true)}
        className="shrink-0"
      />
      <Label htmlFor={item.id} className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">{name}</span>
      </Label>
    </li>
  );
}

export function SubscriptionPageEditor({
  currentConfigJson,
  defaultConfig,
  onFetchDefault,
  onSave,
  saving,
}: {
  currentConfigJson: string | null;
  defaultConfig: SubscriptionPageConfig | null;
  /** Вызывается по клику «Загрузить базовый конфиг», если конфиг ещё не загружен */
  onFetchDefault?: () => Promise<SubscriptionPageConfig | null>;
  onSave: (configJson: string) => void;
  saving: boolean;
}) {
  const [editorState, setEditorState] = useState<Record<string, { apps: EditorApp[] }>>(() =>
    parseConfigJson(currentConfigJson)
  );
  const [loadDefaultLoading, setLoadDefaultLoading] = useState(false);
  const [loadDefaultError, setLoadDefaultError] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseConfigJson(currentConfigJson);
    const hasAny = Object.keys(parsed).some((k) => (parsed[k]?.apps?.length ?? 0) > 0);
    if (hasAny) setEditorState(parsed);
    else if (defaultConfig) setEditorState(mergeWithDefault({}, defaultConfig));
  }, [currentConfigJson, defaultConfig]);

  const loadDefault = useCallback(async () => {
    setLoadDefaultError(null);
    setLoadDefaultLoading(true);
    try {
      let config = defaultConfig;
      if (!config && onFetchDefault) {
        config = await onFetchDefault() ?? null;
      }
      if (!config) {
        setLoadDefaultError("Не удалось загрузить базовый конфиг. Проверьте, что файл subpage-00000000-0000-0000-0000-000000000000.json есть в корне проекта на сервере.");
        return;
      }
      const merged = mergeWithDefault(parseConfigJson(currentConfigJson ?? null), config);
      setEditorState(merged);
    } catch (e) {
      setLoadDefaultError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoadDefaultLoading(false);
    }
  }, [defaultConfig, currentConfigJson, onFetchDefault]);

  const setPlatformApps = useCallback((platform: string, apps: EditorApp[]) => {
    setEditorState((s) => ({ ...s, [platform]: { apps } }));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent, platform: string) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const plat = editorState[platform];
      if (!plat) return;
      const ids = plat.apps.map((a) => a.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      setPlatformApps(platform, arrayMove(plat.apps, oldIndex, newIndex));
    },
    [editorState, setPlatformApps]
  );

  const handleToggle = useCallback(
    (platform: string, appId: string, enabled: boolean) => {
      const plat = editorState[platform];
      if (!plat) return;
      setPlatformApps(
        platform,
        plat.apps.map((a) => (a.id === appId ? { ...a, enabled } : a))
      );
    },
    [editorState, setPlatformApps]
  );

  const handleSubmit = useCallback(() => {
    onSave(configToJson(editorState, defaultConfig ?? undefined));
  }, [editorState, defaultConfig, onSave]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={loadDefault}
          disabled={loadDefaultLoading}
        >
          {loadDefaultLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Загрузить базовый конфиг (subpage)
        </Button>
        {loadDefaultError && (
          <p className="text-sm text-destructive">{loadDefaultError}</p>
        )}
        <Button type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Включите или отключите приложения для каждой платформы и измените порядок перетаскиванием. В кабинете клиента будут показаны только включённые приложения в указанном порядке.
      </p>
      <div className="space-y-6">
        {PLATFORM_ORDER.map((platformKey) => {
          const plat = editorState[platformKey] ?? { apps: [] };
          const apps = plat.apps;
          if (apps.length === 0) return null;
          return (
            <Card key={platformKey}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {PLATFORM_LABELS[platformKey] ?? platformKey}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleDragEnd(e, platformKey)}
                >
                  <SortableContext
                    items={apps.map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-2">
                      {apps.map((item) => (
                        <SortableAppRow
                          key={item.id}
                          item={item}
                          onToggle={(enabled) => handleToggle(platformKey, item.id, enabled)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
