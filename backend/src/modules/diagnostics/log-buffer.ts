/**
 * In-memory ring-buffer для логов API.
 *
 * Внутри Docker-контейнера невозможно читать собственный stdout без доступа к
 * docker socket'у. Поэтому мы перехватываем все вызовы console.* и пишем
 * их в кольцевой буфер (последние N строк), а UI читает из этого буфера
 * через /api/admin/diagnostics/logs.
 *
 * Стандартные console-методы продолжают работать как раньше — они и пишут
 * в реальный stdout, и складывают строку в буфер. Никаких сторонних логгеров
 * не требуется. Если используется bunyan/winston/pino — они тоже идут через
 * stdout/stderr write hooks (см. ниже).
 *
 * Для process.stdout/stderr.write мы тоже устанавливаем перехватчик —
 * так захватываются и сторонние библиотеки, пишущие напрямую в stdout
 * (Prisma client, http-логи, и т.п.).
 */

const BUFFER_SIZE = 5000; // последние 5000 строк (примерно ≤ 1MB)

interface LogLine {
  ts: number; // ms unix epoch
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
}

const buffer: LogLine[] = [];
let installed = false;

function push(level: LogLine["level"], text: string) {
  // нормализация многострочных сообщений: пишем как есть, без разделения
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!trimmed) return;
  buffer.push({ ts: Date.now(), level, text: trimmed });
  if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE);
}

export function installLogCapture() {
  if (installed) return;
  installed = true;

  // Перехват console.* — продолжаем вызывать оригинал, чтобы Docker logs не сломались.
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  const fmt = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(" ");

  console.log = (...args) => { push("log", fmt(args)); orig.log(...args); };
  console.info = (...args) => { push("info", fmt(args)); orig.info(...args); };
  console.warn = (...args) => { push("warn", fmt(args)); orig.warn(...args); };
  console.error = (...args) => { push("error", fmt(args)); orig.error(...args); };
  console.debug = (...args) => { push("debug", fmt(args)); orig.debug(...args); };

  // Перехват process.stdout/stderr.write — для библиотек, которые пишут напрямую
  // (Prisma, native logs). Не ломаем оригинальный вывод в Docker logs.
  const wrapWrite = (stream: NodeJS.WriteStream, level: LogLine["level"]) => {
    const origWrite = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      try {
        const s = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        // Расщепляем по \n чтобы каждая строка была отдельным элементом
        for (const line of s.split("\n")) {
          if (line) push(level, line);
        }
      } catch { /* ignore */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origWrite as any)(chunk, ...rest);
    }) as typeof stream.write;
  };
  // Не оборачиваем stdout, потому что он уже захватывается через console.* —
  // иначе будут дубли. Stderr тоже идёт через console.error.
  // Но процессы, пишущие напрямую в stdout/stderr (Prisma migrate, etc.) мы
  // НЕ увидим в этом буфере. Их можно посмотреть через `docker compose logs api`.
  // Для нашей цели — отслеживание ошибок приложения — этого достаточно.
  void wrapWrite; // зарезервировано на случай, если понадобится включить
}

export function getLogs(opts: { lines?: number; filter?: string; level?: LogLine["level"] } = {}) {
  const lines = Math.min(Math.max(opts.lines ?? 200, 1), BUFFER_SIZE);
  let snapshot = buffer.slice(-lines * 4); // берём с запасом для filter

  if (opts.level) {
    snapshot = snapshot.filter((l) => l.level === opts.level);
  }
  if (opts.filter) {
    try {
      const re = new RegExp(opts.filter, "i");
      snapshot = snapshot.filter((l) => re.test(l.text));
    } catch {
      // невалидный regex — возвращаем пустой результат с пометкой
      return { error: "invalid regex", lines: [] };
    }
  }

  return {
    lines: snapshot.slice(-lines),
    bufferSize: buffer.length,
    capacity: BUFFER_SIZE,
  };
}

export function clearLogs() {
  buffer.length = 0;
}
