/**
 * Захардкоженный список заведомо «нелегитимных» email-доменов:
 *   1. RFC reserved TLDs / domains, которые не должны быть продакшен-почтой
 *      (.test, .invalid, .local, .example, example.com, example.net, ...).
 *   2. Самые популярные disposable / temporary mail-сервисы.
 *      Список не претендует на полноту — это база, чтобы остановить 95% ботов.
 *      Админ может расширить через настройку `email_domain_blocklist`.
 *
 * Сравнение в нижнем регистре, по точному совпадению домена и по subdomain
 * (any.example.com тоже блокируется, если в списке есть example.com).
 */
export const BUILTIN_EMAIL_BLOCKLIST: ReadonlyArray<string> = [
  // RFC 2606 / 6761 reserved
  "example.com",
  "example.net",
  "example.org",
  // RFC reserved TLDs (covered by suffix check, но для явности)
  // .test, .invalid, .local, .example — обрабатываются через TLD-check ниже

  // Top-tier disposable email providers
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.biz",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "tempmail.net",
  "tempmailaddress.com",
  "tempm.com",
  "throwawaymail.com",
  "throwaway.email",
  "trashmail.com",
  "trashmail.net",
  "trashmail.io",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "tempinbox.com",
  "spambox.us",
  "incognitomail.com",
  "mytemp.email",
  "mt2014.com",
  "mt2015.com",
  "mvrht.com",
  "spamavert.com",
  "spamgourmet.com",
  "discard.email",
  "gufum.com",
  "tmpmail.org",
  "tmpmail.net",
  "tmpeml.com",
  "moakt.cc",
  "moakt.com",
  "moakt.ws",
  "emltmp.com",
  "emaildrop.io",
  "harakirimail.com",
  "spam4.me",
  "anonbox.net",
  "deadaddress.com",
  "test.com",
  "test.org",
  "test.net",
];

/**
 * RFC reserved TLDs которые никогда не имеют живых MX:
 *   .test, .invalid, .localhost, .local, .example
 */
const RESERVED_TLDS: ReadonlyArray<string> = [
  ".test",
  ".invalid",
  ".localhost",
  ".local",
  ".example",
];

/**
 * Дефолтные подозрительные паттерны email-локалпарта.
 * Применяются перед маской из настроек.
 */
export const BUILTIN_EMAIL_PATTERN_BLOCKLIST: ReadonlyArray<RegExp> = [
  /^test_[a-f0-9]{6,}@/i, // test_3816d0b4@... — типичный ботнет-генератор
  /^test\d{6,}@/i,
  /^bot_?\d+@/i,
  /^[a-z]{1,3}\d{8,}@/i, // q12345678@..., abc12345678@...
];

export interface EmailValidationResult {
  ok: boolean;
  reason?: "domain_blocked" | "pattern_blocked" | "tld_reserved" | "invalid_format";
  domain?: string;
}

/**
 * Парсит дополнительный список доменов из настройки.
 * Принимает строку с разделителями: запятая, точка с запятой, перенос строки, пробел.
 */
export function parseDomainBlocklist(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("."));
}

/**
 * Парсит regex-список из настройки. Каждая строка = один паттерн.
 */
export function parsePatternBlocklist(raw: string | null | undefined): RegExp[] {
  if (!raw || !raw.trim()) return [];
  const patterns: RegExp[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      patterns.push(new RegExp(trimmed, "i"));
    } catch {
      // bad regex — skip
    }
  }
  return patterns;
}

function isDomainBlocked(domain: string, customList: string[]): boolean {
  const merged = [...BUILTIN_EMAIL_BLOCKLIST.map((d) => d.toLowerCase()), ...customList];
  // exact match
  if (merged.includes(domain)) return true;
  // suffix match (any.example.com → example.com)
  for (const blocked of merged) {
    if (domain.endsWith("." + blocked)) return true;
  }
  return false;
}

function isReservedTld(domain: string): boolean {
  return RESERVED_TLDS.some((tld) => domain.endsWith(tld));
}

/**
 * Проверка email перед регистрацией.
 * @param email — обычный email "user@host"
 * @param settings — кастомные blocklist'ы из админки
 */
export function validateEmailForSignup(
  email: string,
  settings: {
    customDomainBlocklist?: string;
    customPatternBlocklist?: string;
  } = {}
): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) {
    return { ok: false, reason: "invalid_format" };
  }
  const domain = trimmed.slice(at + 1);

  if (isReservedTld(domain)) {
    return { ok: false, reason: "tld_reserved", domain };
  }

  const customDomains = parseDomainBlocklist(settings.customDomainBlocklist);
  if (isDomainBlocked(domain, customDomains)) {
    return { ok: false, reason: "domain_blocked", domain };
  }

  for (const pat of BUILTIN_EMAIL_PATTERN_BLOCKLIST) {
    if (pat.test(trimmed)) return { ok: false, reason: "pattern_blocked", domain };
  }
  for (const pat of parsePatternBlocklist(settings.customPatternBlocklist)) {
    if (pat.test(trimmed)) return { ok: false, reason: "pattern_blocked", domain };
  }

  return { ok: true, domain };
}

/**
 * Нормализация email: lowercase + удаление subaddressing (user+tag@host → user@host).
 * Используется для дедупа и определения "массовой регистрации с одного адреса".
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  const cleanLocal = plus > 0 ? local.slice(0, plus) : local;
  // Gmail: точки в локалпарте игнорируются (a.b.c@gmail = abc@gmail)
  const finalLocal = domain === "gmail.com" || domain === "googlemail.com"
    ? cleanLocal.replace(/\./g, "")
    : cleanLocal;
  return `${finalLocal}@${domain}`;
}
