/**
 * Email template editor.
 *
 * Слева — список шаблонов. Справа — редактор subject + body, превью с
 * подстановкой переменных, кнопка Send test.
 */

import { useEffect, useState } from "react";
import { Mail, Loader2, RefreshCw, Save, Eye, Send, AlertCircle, Check } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { emailTemplatesApi, type EmailTemplate } from "@/lib/admin-extras-api";

export function AdminEmailTemplatesPage() {
  const { state } = useAuth();
  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewBody, setPreviewBody] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "preview" | "send" | null>(null);
  const [saved, setSaved] = useState(false);

  const [testEmail, setTestEmail] = useState("");

  async function load() {
    if (!state.accessToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await emailTemplatesApi.list(state.accessToken);
      const list = Array.isArray(r?.items) ? r.items : [];
      setItems(list);
      if (list.length > 0 && !activeKey) selectTemplate(list[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [state.accessToken]);

  function selectTemplate(t: EmailTemplate) {
    setActiveKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
    const initial: Record<string, string> = {};
    for (const v of t.variables) initial[v.name] = v.example;
    setVars(initial);
    setShowPreview(false);
    setSaved(false);
  }

  const active = items.find((t) => t.key === activeKey);

  async function save() {
    if (!state.accessToken || !active) return;
    setBusy("save");
    setErr(null);
    try {
      await emailTemplatesApi.update(state.accessToken, active.key, subject, body);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // refresh list to update isDefault flag
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save error");
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!state.accessToken || !active) return;
    setBusy("preview");
    setErr(null);
    try {
      // используем текущие subject/body, а не сохранённые — для live-preview сначала сохраняем, потом превьюим
      // Здесь делаем offline-preview: сами подставляем vars
      const render = (tpl: string) => tpl.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? `{{${name}}}`);
      setPreviewSubject(render(subject));
      setPreviewBody(render(body));
      setShowPreview(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "preview error");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!state.accessToken || !active || !testEmail) return;
    setBusy("send");
    setErr(null);
    try {
      // сохраняем перед отправкой если что-то изменено
      await emailTemplatesApi.update(state.accessToken, active.key, subject, body);
      await emailTemplatesApi.sendTest(state.accessToken, active.key, testEmail, vars);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "send error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full space-y-4 px-4 sm:px-6 md:px-8 pt-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between bg-background/40 backdrop-blur-3xl border border-white/10 p-6 rounded-[2rem] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center shadow-inner border border-white/10">
            <Mail className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Email-шаблоны</h1>
            <p className="text-sm text-muted-foreground mt-1">Системные транзакционные письма (приветствие, оплата, истечение и т.п.)</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {err && (
        <Card className="p-3 bg-rose-500/10 border-rose-500/30 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-xs text-rose-500">{err}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* LEFT: list */}
        <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-2 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-1">
              {items.map((t) => (
                <button
                  key={t.key}
                  onClick={() => selectTemplate(t)}
                  className={cn(
                    "w-full text-left rounded-xl px-3 py-2 text-sm transition",
                    t.key === activeKey
                      ? "bg-primary/15 text-foreground font-medium border border-primary/30"
                      : "hover:bg-foreground/[0.04] text-muted-foreground border border-transparent",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate">{t.label}</span>
                    {t.isDefault && <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 ml-auto">default</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT: editor */}
        {active ? (
          <div className="space-y-4">
            <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-5 space-y-3">
              <div>
                <Label className="text-xs">Тема (subject)</Label>
                <Input value={subject} onChange={(e) => { setSubject(e.target.value); setSaved(false); }} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Тело (HTML)</Label>
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setSaved(false); }}
                  className="w-full min-h-[280px] mt-1 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 p-3 font-mono text-xs"
                  spellCheck={false}
                />
              </div>

              {active.variables.length > 0 && (
                <div>
                  <Label className="text-xs">Переменные (для preview/test)</Label>
                  <div className="mt-1.5 grid sm:grid-cols-2 gap-2">
                    {active.variables.map((v) => (
                      <div key={v.name}>
                        <span className="text-[10px] font-mono text-muted-foreground">{`{{${v.name}}}`}</span>
                        <Input
                          value={vars[v.name] ?? ""}
                          onChange={(e) => setVars((p) => ({ ...p, [v.name]: e.target.value }))}
                          placeholder={v.example}
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                <Button onClick={save} disabled={busy !== null} className="gap-2">
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saved ? "Сохранено" : "Сохранить"}
                </Button>
                <Button onClick={preview} variant="outline" disabled={busy !== null} className="gap-2">
                  <Eye className="h-4 w-4" />
                  Превью
                </Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@example.com"
                    className="h-9 w-[220px] text-xs"
                  />
                  <Button onClick={sendTest} variant="outline" disabled={busy !== null || !testEmail.includes("@")} className="gap-2">
                    {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send test
                  </Button>
                </div>
              </div>
            </Card>

            {showPreview && (
              <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-5">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Subject preview</div>
                <div className="rounded-lg bg-foreground/[0.03] dark:bg-white/[0.02] border border-white/10 p-3 font-medium mb-4">{previewSubject}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Body preview (rendered)</div>
                <div
                  className="rounded-lg bg-white text-black border border-white/10 p-4 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewBody }}
                />
              </Card>
            )}
          </div>
        ) : (
          <Card className="bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl p-8 text-center text-sm text-muted-foreground">
            Выберите шаблон слева
          </Card>
        )}
      </div>
    </div>
  );
}
