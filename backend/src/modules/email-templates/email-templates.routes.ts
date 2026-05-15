/**
 * Редактор системных email-шаблонов.
 *
 * Хранение: каждый шаблон = пара ключей в system_settings:
 *   email_template_<key>_subject — тема
 *   email_template_<key>_body    — HTML тело (поддерживает {{переменные}})
 *
 * Известные шаблоны (defaults жёстко закодированы — если нет в БД, отдаём их):
 *   - welcome              — после регистрации (vars: {{email}}, {{loginUrl}})
 *   - email_verification   — verify code (vars: {{code}}, {{minutes}})
 *   - password_reset       — сброс пароля (vars: {{resetUrl}}, {{minutes}})
 *   - payment_confirmed    — успешная оплата (vars: {{amount}}, {{currency}}, {{tariffName}}, {{expiresAt}})
 *   - subscription_expiring — за 3 дня до истечения (vars: {{tariffName}}, {{daysLeft}}, {{renewUrl}})
 *   - subscription_expired — после истечения (vars: {{tariffName}})
 *
 * Endpoints:
 *   GET    /api/admin/email-templates/list           — все шаблоны (с defaults)
 *   GET    /api/admin/email-templates/:key            — один шаблон
 *   PUT    /api/admin/email-templates/:key            — обновить (subject + body)
 *   POST   /api/admin/email-templates/:key/preview    — отрендерить с тестовыми переменными
 *   POST   /api/admin/email-templates/:key/send-test  — отправить тестовое письмо
 */

import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

interface TemplateDef {
  key: string;
  label: string;
  description: string;
  variables: { name: string; example: string; required?: boolean }[];
  defaultSubject: string;
  defaultBody: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    key: "welcome",
    label: "Приветственное письмо",
    description: "Отправляется после регистрации нового клиента (если включён email-канал)",
    variables: [
      { name: "email", example: "user@example.com", required: true },
      { name: "loginUrl", example: "https://stealthnet.app/login", required: true },
    ],
    defaultSubject: "Добро пожаловать в STEALTHNET!",
    defaultBody: `<h2>Добро пожаловать!</h2>
<p>Спасибо, что зарегистрировались в STEALTHNET. Ваш email: <b>{{email}}</b>.</p>
<p>Войти в личный кабинет: <a href="{{loginUrl}}">{{loginUrl}}</a></p>
<p>Если у вас есть вопросы — пишите в Telegram-бот.</p>`,
  },
  {
    key: "email_verification",
    label: "Верификация email",
    description: "Код подтверждения email при регистрации/смене",
    variables: [
      { name: "code", example: "ABC123", required: true },
      { name: "minutes", example: "10", required: true },
    ],
    defaultSubject: "Код подтверждения: {{code}}",
    defaultBody: `<h2>Подтверждение email</h2>
<p>Ваш код: <code style="font-size:24px;font-weight:bold;letter-spacing:4px">{{code}}</code></p>
<p>Код действителен <b>{{minutes}}</b> минут.</p>
<p>Если вы не запрашивали код — игнорируйте письмо.</p>`,
  },
  {
    key: "password_reset",
    label: "Сброс пароля",
    description: "Ссылка для сброса пароля",
    variables: [
      { name: "resetUrl", example: "https://stealthnet.app/reset?token=...", required: true },
      { name: "minutes", example: "30", required: true },
    ],
    defaultSubject: "Сброс пароля STEALTHNET",
    defaultBody: `<h2>Сброс пароля</h2>
<p>Чтобы установить новый пароль, перейдите по ссылке:</p>
<p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
<p>Ссылка действительна <b>{{minutes}}</b> минут.</p>`,
  },
  {
    key: "payment_confirmed",
    label: "Успешная оплата",
    description: "После PAID платежа",
    variables: [
      { name: "amount", example: "9.99", required: true },
      { name: "currency", example: "USD", required: true },
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "expiresAt", example: "2026-06-05", required: true },
    ],
    defaultSubject: "Оплата подтверждена",
    defaultBody: `<h2>Спасибо за оплату!</h2>
<p>Тариф: <b>{{tariffName}}</b></p>
<p>Сумма: <b>{{amount}} {{currency}}</b></p>
<p>Подписка активна до: <b>{{expiresAt}}</b></p>`,
  },
  {
    key: "subscription_expiring",
    label: "Скоро истекает подписка",
    description: "За N дней до истечения",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
      { name: "daysLeft", example: "3", required: true },
      { name: "renewUrl", example: "https://stealthnet.app/renew", required: true },
    ],
    defaultSubject: "Подписка истекает через {{daysLeft}} дн.",
    defaultBody: `<h2>Подписка скоро закончится</h2>
<p>Ваша подписка <b>{{tariffName}}</b> истекает через <b>{{daysLeft}}</b> дн.</p>
<p>Продлить: <a href="{{renewUrl}}">{{renewUrl}}</a></p>`,
  },
  {
    key: "subscription_expired",
    label: "Подписка истекла",
    description: "В день истечения",
    variables: [
      { name: "tariffName", example: "1 месяц", required: true },
    ],
    defaultSubject: "Подписка истекла",
    defaultBody: `<h2>Подписка закончилась</h2>
<p>Ваша подписка <b>{{tariffName}}</b> истекла. Продлите её, чтобы продолжить пользоваться сервисом.</p>`,
  },
];

function subjectKey(k: string) { return `email_template_${k}_subject`; }
function bodyKey(k: string) { return `email_template_${k}_body`; }

async function getStored(key: string) {
  const def = TEMPLATES.find((t) => t.key === key);
  if (!def) return null;

  const [s, b] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: subjectKey(key) } }),
    prisma.systemSetting.findUnique({ where: { key: bodyKey(key) } }),
  ]);
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    variables: def.variables,
    subject: s?.value ?? def.defaultSubject,
    body: b?.value ?? def.defaultBody,
    isDefault: !s && !b,
  };
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? `{{${name}}}`);
}

export const emailTemplatesRouter = Router();
emailTemplatesRouter.use(requireAuth);
emailTemplatesRouter.use(requireAdminSection);

emailTemplatesRouter.get(
  "/list",
  asyncRoute(async (_req, res) => {
    const items = await Promise.all(TEMPLATES.map((t) => getStored(t.key)));
    return res.json({ items: items.filter(Boolean) });
  }),
);

emailTemplatesRouter.get(
  "/:key",
  asyncRoute(async (req, res) => {
    const item = await getStored(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    return res.json(item);
  }),
);

const putSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
});

emailTemplatesRouter.put(
  "/:key",
  asyncRoute(async (req, res) => {
    const def = TEMPLATES.find((t) => t.key === req.params.key);
    if (!def) return res.status(404).json({ message: "Template not found" });
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    await prisma.systemSetting.upsert({
      where: { key: subjectKey(def.key) },
      create: { key: subjectKey(def.key), value: parsed.data.subject },
      update: { value: parsed.data.subject },
    });
    await prisma.systemSetting.upsert({
      where: { key: bodyKey(def.key) },
      create: { key: bodyKey(def.key), value: parsed.data.body },
      update: { value: parsed.data.body },
    });

    await logAdmin(req, "email_template.update", { type: "system", id: def.key }, {
      key: def.key,
      subjectLength: parsed.data.subject.length,
      bodyLength: parsed.data.body.length,
    });

    return res.json({ ok: true, ...(await getStored(def.key))! });
  }),
);

const previewSchema = z.object({
  vars: z.record(z.string()).optional(),
});

emailTemplatesRouter.post(
  "/:key/preview",
  asyncRoute(async (req, res) => {
    const item = await getStored(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    const exampleVars: Record<string, string> = {};
    for (const v of item.variables) exampleVars[v.name] = v.example;
    const vars = { ...exampleVars, ...(parsed.data.vars ?? {}) };

    return res.json({
      subject: renderTemplate(item.subject, vars),
      body: renderTemplate(item.body, vars),
      vars,
    });
  }),
);

const sendTestSchema = z.object({
  toEmail: z.string().email(),
  vars: z.record(z.string()).optional(),
});

emailTemplatesRouter.post(
  "/:key/send-test",
  asyncRoute(async (req, res) => {
    const item = await getStored(req.params.key);
    if (!item) return res.status(404).json({ message: "Template not found" });
    const parsed = sendTestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

    const exampleVars: Record<string, string> = {};
    for (const v of item.variables) exampleVars[v.name] = v.example;
    const vars = { ...exampleVars, ...(parsed.data.vars ?? {}) };

    const subject = renderTemplate(item.subject, vars);
    const body = renderTemplate(item.body, vars);

    try {
      const { sendEmail } = await import("../mail/mail.service.js");
      const { getSystemConfig } = await import("../client/client.service.js");
      const config = await getSystemConfig() as Record<string, unknown>;
      const smtpConfig = {
        host: (config.smtpHost as string) || "",
        port: (config.smtpPort as number) ?? 587,
        secure: (config.smtpSecure as boolean) ?? false,
        user: (config.smtpUser as string) ?? null,
        password: (config.smtpPassword as string) ?? null,
        fromEmail: (config.smtpFromEmail as string) ?? null,
        fromName: (config.smtpFromName as string) ?? null,
      };
      const result = await sendEmail(smtpConfig, parsed.data.toEmail, subject, body);
      if (!result.ok) {
        return res.status(500).json({ message: result.error ?? "Failed to send" });
      }
    } catch (e) {
      return res.status(500).json({ message: e instanceof Error ? e.message : "Failed to send" });
    }

    await logAdmin(req, "email_template.send_test", { type: "system", id: item.key }, {
      key: item.key,
      to: parsed.data.toEmail,
    });

    return res.json({ ok: true });
  }),
);
