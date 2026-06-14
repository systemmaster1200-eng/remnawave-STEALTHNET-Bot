/**
 * 19.05.2026 — поток получения чека ЮКассы (54-ФЗ).
 *
 * Поток:
 *   1) После того как клиент выбрал YooKassa как метод оплаты, вместо мгновенного
 *      создания платежа показываем prompt «Хотите чек? Нет / Да».
 *   2) «Нет» → создаём платёж как раньше (без receiptEmail).
 *   3) «Да» → запрашиваем email → создаём платёж с receipt.customer.email.
 *      Если у клиента уже сохранён email — предлагаем использовать его или ввести другой.
 *
 * Архитектура:
 *   - В каждом yookassa-handler'е в index.ts вместо прямого `api.createYookassaPayment(...)`
 *     вызывается `storePendingReceipt({ builder, finalize })`, который кладёт замыкания
 *     в in-memory store и возвращает короткий токен.
 *   - На callback `yk_recpt:no:<tok>` / `yk_recpt:saved:<tok>` / `yk_recpt:ask:<tok>` —
 *     общий обработчик в index.ts достаёт замыкания и продолжает.
 *   - TTL 1 час (если юзер не успел — придёт устаревший callback и попросим начать сначала).
 */

/**
 * Тип клавиатуры намеренно структурный (без grammy/InlineKeyboardMarkup):
 * чтобы быть совместимым с локальным `InlineMarkup` из keyboard.ts, который
 * `editMessageContent` принимает в качестве 3-го аргумента.
 */
type InlineKb = { inline_keyboard: { text: string; callback_data: string }[][] };
type ConfirmationPayment = { paymentId: string; confirmationUrl: string };

export interface PendingReceipt {
  /** Создаёт ЮКасса-платёж. email=undefined → без чека (placeholder). */
  builder: (receiptEmail: string | undefined) => Promise<ConfirmationPayment>;
  /** Финализирует UI: показывает ссылку оплаты, опционально с пометкой "чек на email". */
  finalize: (
    payment: ConfirmationPayment,
    opts: { receiptSentTo: string | null },
  ) => Promise<void>;
  /** Сохранённый email клиента на момент prompt — для кнопки «использовать сохранённый». */
  savedEmail: string | null;
  /** userId — для гарантии что callback пришёл от того же пользователя. */
  userId: number;
  createdAt: number;
}

const STORE = new Map<string, PendingReceipt>();
const TTL_MS = 60 * 60 * 1000; // 1 час

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of STORE) {
    if (now - v.createdAt > TTL_MS) STORE.delete(k);
  }
}, 10 * 60 * 1000);
cleanupTimer.unref?.();

function newToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function storePendingReceipt(
  data: Omit<PendingReceipt, "createdAt">,
): string {
  const tok = newToken();
  STORE.set(tok, { ...data, createdAt: Date.now() });
  return tok;
}

/** Достаёт без удаления — для проверки на ask-шаге. */
export function peekPendingReceipt(tok: string): PendingReceipt | undefined {
  return STORE.get(tok);
}

/** Достаёт и удаляет — для финальной операции (платёж создаётся 1 раз). */
export function takePendingReceipt(tok: string): PendingReceipt | undefined {
  const v = STORE.get(tok);
  if (v) STORE.delete(tok);
  return v;
}

// ─── State «жду email от юзера» ────────────────────────────────────────
const PENDING_EMAIL_INPUT = new Map<number, string>(); // userId → receipt-token

export function setPendingEmailInput(userId: number, token: string): void {
  PENDING_EMAIL_INPUT.set(userId, token);
}

export function takePendingEmailInput(userId: number): string | undefined {
  const v = PENDING_EMAIL_INPUT.get(userId);
  if (v) PENDING_EMAIL_INPUT.delete(userId);
  return v;
}

export function hasPendingEmailInput(userId: number): boolean {
  return PENDING_EMAIL_INPUT.has(userId);
}

// ─── UI helpers ────────────────────────────────────────────────────────
// editMessageContent в боте использует Telegram entities, а не parse_mode=HTML —
// поэтому HTML-теги типа <b> в текст НЕ передаём (они придут как сырой текст).
export function receiptPromptText(savedEmail: string | null): string {
  if (savedEmail) {
    return (
      "Хотите получить чек? 🧾\n\n" +
      `Сохранённый email: ${savedEmail}\n` +
      "Можем отправить чек туда или указать другой 📧"
    );
  }
  return (
    "Хотите получить чек? 🧾\n\n" +
    "Если вы выберете «Да», потребуется ввести электронную почту – мы отправим на неё чек 📧"
  );
}

export function receiptPromptKeyboard(
  token: string,
  savedEmail: string | null,
): InlineKb {
  const rows: { text: string; callback_data: string }[][] = [];
  rows.push([{ text: "➡️ Нет, продолжить", callback_data: `yk_recpt:no:${token}` }]);
  if (savedEmail) {
    const short = savedEmail.length > 22 ? savedEmail.slice(0, 19) + "…" : savedEmail;
    rows.push([{ text: `✔️ Отправить на ${short}`, callback_data: `yk_recpt:saved:${token}` }]);
    rows.push([{ text: "✏️ Другой email", callback_data: `yk_recpt:ask:${token}` }]);
  } else {
    rows.push([{ text: "✔️ Да, отправить чек", callback_data: `yk_recpt:ask:${token}` }]);
  }
  return { inline_keyboard: rows };
}

export const EMAIL_PROMPT_TEXT = "📩 Введите ваш Email – мы отправим чек после оплаты.";
export const RECEIPT_OK_LINE = (email: string): string =>
  `📬 Чек будет отправлен на <b>${escapeHtml(email)}</b>`;

export function isValidEmail(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
