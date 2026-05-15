/**
 * Универсальный рендерер формы по `FieldSchema[]`. Принимает текущее значение объекта
 * и onChange колбэк — вызывается на любое изменение.
 *
 * Для list-pair добавляет/удаляет элементы массива через кнопки.
 */

import { useCallback, useRef, useState } from "react";
import { Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth";
import { landingEditorApi } from "@/lib/landing-editor-api";
import type { FieldSchema } from "./block-schemas";

interface SchemaFormProps {
  fields: FieldSchema[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ fields, value, onChange }: SchemaFormProps) {
  const setField = useCallback(
    (key: string, fieldValue: unknown) => {
      onChange({ ...value, [key]: fieldValue });
    },
    [onChange, value],
  );

  if (fields.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">У этого блока нет настраиваемых полей в этой секции.</div>;
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <FieldInput key={field.key} field={field} value={value[field.key]} onChange={(v) => setField(field.key, v)} />
      ))}
    </div>
  );
}

interface FieldInputProps {
  field: FieldSchema;
  value: unknown;
  onChange: (next: unknown) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  switch (field.type) {
    case "text":
    case "url":
      return (
        <FieldWrapper field={field}>
          <Input
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder={field.placeholder}
          />
        </FieldWrapper>
      );

    case "number":
      return (
        <FieldWrapper field={field}>
          <Input
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder={field.placeholder}
          />
        </FieldWrapper>
      );

    case "textarea":
      return (
        <FieldWrapper field={field}>
          <Textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            rows={field.rows ?? 3}
            placeholder={field.placeholder}
          />
        </FieldWrapper>
      );

    case "bool":
      return (
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="min-w-0 flex-1">
            <Label className="text-sm font-medium">{field.label}</Label>
            {field.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{field.hint}</p> : null}
          </div>
          <Switch checked={!!value} onCheckedChange={(v) => onChange(v || undefined)} />
        </div>
      );

    case "color":
      return (
        <FieldWrapper field={field}>
          <div className="flex gap-2">
            <Input
              type="color"
              value={typeof value === "string" ? value : "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="h-10 w-16 cursor-pointer p-1"
            />
            <Input
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value || undefined)}
              placeholder="#7c3aed"
              className="font-mono"
            />
          </div>
        </FieldWrapper>
      );

    case "image":
      return (
        <FieldWrapper field={field}>
          <ImageField value={typeof value === "string" ? value : ""} onChange={(v) => onChange(v || undefined)} />
        </FieldWrapper>
      );

    case "select":
      return (
        <FieldWrapper field={field}>
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— не выбрано —</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FieldWrapper>
      );

    case "list-text":
      return <ListTextField field={field} value={Array.isArray(value) ? (value as unknown[]) : []} onChange={onChange} />;

    case "list-pair":
      return <ListPairField field={field} value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} onChange={onChange} />;
  }
}

function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { state } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!state.accessToken) {
      setError("Нет токена авторизации");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await landingEditorApi.uploadImage(state.accessToken, file);
      onChange(result.url);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… или /api/uploads/landing/…"
          className="font-mono text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="shrink-0 gap-1.5"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Загрузить
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
      {value ? (
        <img src={value} alt="" className="mt-2 max-h-32 rounded-lg border border-border object-contain" />
      ) : null}
    </div>
  );
}

function FieldWrapper({ field, children }: { field: FieldSchema; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-medium">{field.label}</Label>
      <div className="mt-1.5">{children}</div>
      {field.hint ? <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p> : null}
    </div>
  );
}

function ListTextField({ field, value, onChange }: { field: FieldSchema; value: unknown[]; onChange: (next: unknown) => void }) {
  const items = value.map((v) => (typeof v === "string" ? v : ""));
  const max = field.maxItems ?? 99;

  return (
    <div>
      <Label className="text-sm font-medium">{field.label}</Label>
      {field.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{field.hint}</p> : null}
      <div className="mt-2 space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[idx] = e.target.value;
                onChange(next.filter((x) => x.length > 0).length === 0 ? undefined : next);
              }}
              placeholder={field.placeholder}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const next = items.filter((_, i) => i !== idx);
                onChange(next.length === 0 ? undefined : next);
              }}
              className="shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length < max ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...items, ""])}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Добавить
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ListPairField({
  field,
  value,
  onChange,
}: {
  field: FieldSchema;
  value: Record<string, unknown>[];
  onChange: (next: unknown) => void;
}) {
  const max = field.maxItems ?? 99;
  const itemFields = field.itemFields ?? [];

  return (
    <div>
      <Label className="text-sm font-medium">{field.label}</Label>
      {field.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{field.hint}</p> : null}
      <div className="mt-2 space-y-3">
        {value.map((item, idx) => (
          <div key={idx} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">#{idx + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = value.filter((_, i) => i !== idx);
                  onChange(next.length === 0 ? undefined : next);
                }}
                className="h-7 gap-1 text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" /> Удалить
              </Button>
            </div>
            <div className="space-y-2">
              {itemFields.map((subField) => (
                <FieldInput
                  key={subField.key}
                  field={subField}
                  value={item[subField.key]}
                  onChange={(v) => {
                    const next = value.map((it, i) => (i === idx ? { ...it, [subField.key]: v } : it));
                    onChange(next);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {value.length < max ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const blank: Record<string, unknown> = {};
              for (const sf of itemFields) blank[sf.key] = "";
              onChange([...value, blank]);
            }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Добавить
          </Button>
        ) : null}
      </div>
    </div>
  );
}
