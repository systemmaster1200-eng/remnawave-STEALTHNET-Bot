/**
 * Тема лендинга: цвета (primary/accent/background/text), шрифт из пресетов,
 * border-radius и кастомный CSS. Все изменения уходят в `theme.draft` —
 * на лендинге не видны до публикации.
 */

import { useEffect, useState, useCallback } from "react";
import { Loader2, Save, RotateCcw, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { landingEditorApi, type AdminLandingTheme } from "@/lib/landing-editor-api";

interface ThemeDialogProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  onChanged: () => Promise<void> | void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface ThemeDraft {
  primaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  fontFamily?: string | null;
  borderRadius?: string | null;
  containerWidth?: string | null;
  customCss?: string | null;
}

export function ThemeDialog({ open, onClose, token, onChanged, onError, onSuccess }: ThemeDialogProps) {
  const [theme, setTheme] = useState<AdminLandingTheme | null>(null);
  const [draft, setDraft] = useState<ThemeDraft>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const t = await landingEditorApi.getTheme(token);
      setTheme(t);
      // Если есть draft — берём из него; иначе — из основных полей.
      if (t.draft) {
        setDraft(t.draft as ThemeDraft);
      } else {
        setDraft({
          primaryColor: t.primaryColor,
          accentColor: t.accentColor,
          backgroundColor: t.backgroundColor,
          textColor: t.textColor,
          fontFamily: t.fontFamily,
          borderRadius: t.borderRadius,
          containerWidth: t.containerWidth,
          customCss: t.customCss,
        });
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const setField = (key: keyof ThemeDraft, value: string | null | undefined) => {
    setDraft((d) => ({ ...d, [key]: value === "" ? null : value }));
  };

  const handleSave = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await landingEditorApi.updateThemeDraft(token, draft as Record<string, unknown>);
      await onChanged();
      onSuccess("Тема сохранена в черновик");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!token) return;
    if (!confirm("Опубликовать черновик темы?")) return;
    setBusy(true);
    try {
      await landingEditorApi.publishTheme(token);
      await reload();
      await onChanged();
      onSuccess("Тема опубликована");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!token) return;
    if (!confirm("Отбросить черновик темы?")) return;
    setBusy(true);
    try {
      await landingEditorApi.discardThemeDraft(token);
      await reload();
      await onChanged();
      onSuccess("Черновик темы отброшен");
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const fontPresets = theme?.fontPresets ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Тема лендинга</DialogTitle>
          <DialogDescription>
            Цвета, шрифт, радиусы и custom CSS. Изменения уходят в черновик —
            на лендинге не видны до публикации.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Шрифт */}
            <div>
              <Label className="text-sm font-medium">Шрифт</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {fontPresets.map((preset) => {
                  const active = draft.fontFamily === preset.name;
                  return (
                    <button
                      key={preset.name}
                      onClick={() => setField("fontFamily", preset.name)}
                      className={`rounded-lg border p-2 text-center text-sm transition-colors ${
                        active
                          ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                          : "border-border hover:bg-accent"
                      }`}
                      style={{ fontFamily: `"${preset.name}", sans-serif` }}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Шрифт подгружается с Google Fonts. Список вшит в backend (`fontPresets`).
              </p>
            </div>

            {/* Цвета */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ColorField label="Primary (главный акцент)" value={draft.primaryColor ?? ""} onChange={(v) => setField("primaryColor", v)} placeholder="#7c3aed" />
              <ColorField label="Accent (вторичный)" value={draft.accentColor ?? ""} onChange={(v) => setField("accentColor", v)} placeholder="#a78bfa" />
              <ColorField label="Background (фон)" value={draft.backgroundColor ?? ""} onChange={(v) => setField("backgroundColor", v)} placeholder="#ffffff" />
              <ColorField label="Text (основной текст)" value={draft.textColor ?? ""} onChange={(v) => setField("textColor", v)} placeholder="#0f172a" />
            </div>

            {/* Геометрия */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-sm font-medium">Border radius</Label>
                <Input
                  className="mt-1.5"
                  value={draft.borderRadius ?? ""}
                  onChange={(e) => setField("borderRadius", e.target.value)}
                  placeholder="16px"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Container width</Label>
                <Input
                  className="mt-1.5"
                  value={draft.containerWidth ?? ""}
                  onChange={(e) => setField("containerWidth", e.target.value)}
                  placeholder="1280px"
                />
              </div>
            </div>

            {/* Custom CSS */}
            <div>
              <Label className="text-sm font-medium">Custom CSS</Label>
              <Textarea
                className="mt-1.5 font-mono text-xs"
                rows={6}
                value={draft.customCss ?? ""}
                onChange={(e) => setField("customCss", e.target.value)}
                placeholder=":root { --landing-radius: 16px; }"
              />
              <p className="mt-1 text-xs text-muted-foreground">Подключается на лендинг через {`<style>`}.</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              {theme?.draft ? (
                <>
                  <Button onClick={handleDiscard} variant="outline" size="sm" className="gap-1.5" disabled={busy}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Отбросить черновик
                  </Button>
                  <Button onClick={handlePublish} size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Опубликовать
                  </Button>
                </>
              ) : null}
              <Button onClick={handleSave} className="gap-1.5" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить в черновик
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ColorField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <Input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-16 cursor-pointer p-1"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
      </div>
    </div>
  );
}
