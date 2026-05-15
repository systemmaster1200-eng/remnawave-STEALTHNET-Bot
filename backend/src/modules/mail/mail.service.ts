/**
 * Отправка писем через SMTP (подтверждение регистрации по email)
 */

import nodemailer from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  fromEmail: string | null;
  fromName: string | null;
};

export function isSmtpConfigured(config: SmtpConfig): boolean {
  return Boolean(
    config.host &&
    config.port &&
    config.fromEmail
  );
}

/**
 * Отправить письмо с ссылкой для подтверждения регистрации
 */
export async function sendVerificationEmail(
  config: SmtpConfig,
  to: string,
  verificationLink: string,
  serviceName: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured(config)) {
    return { ok: false, error: "SMTP not configured" };
  }

  const auth = config.user && config.password ? { user: config.user, pass: config.password } : undefined;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  const from = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail!;

  const subject = `Подтверждение регистрации — ${serviceName}`;
  const html = `
    <p>Здравствуйте!</p>
    <p>Для завершения регистрации в ${serviceName} перейдите по ссылке:</p>
    <p><a href="${verificationLink}">${verificationLink}</a></p>
    <p>Ссылка действительна 24 часа.</p>
    <p>Если вы не регистрировались, проигнорируйте это письмо.</p>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Письмо для привязки email к существующему аккаунту (клиент уже залогинен по Telegram)
 */
export async function sendLinkEmailVerification(
  config: SmtpConfig,
  to: string,
  verificationLink: string,
  serviceName: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured(config)) {
    return { ok: false, error: "SMTP not configured" };
  }

  const auth = config.user && config.password ? { user: config.user, pass: config.password } : undefined;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  const from = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail!;

  const subject = `Привязка почты к аккаунту — ${serviceName}`;
  const html = `
    <p>Здравствуйте!</p>
    <p>Для привязки этой почты к вашему аккаунту в ${serviceName} перейдите по ссылке:</p>
    <p><a href="${verificationLink}">${verificationLink}</a></p>
    <p>Ссылка действительна 24 часа.</p>
    <p>Если вы не запрашивали привязку, проигнорируйте это письмо.</p>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export type EmailAttachment = { filename: string; content: Buffer };

/**
 * Отправить произвольное письмо (для рассылки). Опционально — вложения.
 */
export async function sendEmail(
  config: SmtpConfig,
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[]
): Promise<{ ok: boolean; error?: string }> {
  if (!isSmtpConfigured(config)) {
    return { ok: false, error: "SMTP not configured" };
  }

  const auth = config.user && config.password ? { user: config.user, pass: config.password } : undefined;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  const from = config.fromName
    ? `"${config.fromName}" <${config.fromEmail}>`
    : config.fromEmail!;

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
