/**
 * Обёртка над fetch с поддержкой HTTP(S) и SOCKS5 прокси.
 * Прокси-URL форматы:
 *   http://user:pass@host:port
 *   https://user:pass@host:port
 *   socks5://user:pass@host:port
 *
 * Используется undici ProxyAgent для HTTP(S) и socks-proxy-agent для SOCKS5.
 */

import { ProxyAgent as UndiciProxyAgent, fetch as undiciFetch } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import https from "node:https";
import http from "node:http";

let cachedAgent: { url: string; dispatcher: any } | null = null;

function getOrCreateDispatcher(proxyUrl: string): any {
  if (cachedAgent && cachedAgent.url === proxyUrl) {
    return cachedAgent.dispatcher;
  }

  const lower = proxyUrl.toLowerCase();
  let dispatcher: any;

  if (lower.startsWith("socks5://") || lower.startsWith("socks4://") || lower.startsWith("socks://")) {
    dispatcher = new SocksProxyAgent(proxyUrl);
  } else if (lower.startsWith("http://") || lower.startsWith("https://")) {
    dispatcher = new UndiciProxyAgent(proxyUrl);
  } else {
    throw new Error(`Unsupported proxy protocol: ${proxyUrl}`);
  }

  cachedAgent = { url: proxyUrl, dispatcher };
  return dispatcher;
}

/**
 * fetch через прокси (если proxyUrl задан), иначе — обычный fetch.
 * Поддерживает HTTP(S) и SOCKS5 прокси.
 */
export async function proxyFetch(
  url: string | URL,
  init?: RequestInit & { signal?: AbortSignal },
  proxyUrl?: string | null,
): Promise<Response> {
  if (!proxyUrl?.trim()) {
    return fetch(url, init);
  }

  const proxy = proxyUrl.trim();
  const lower = proxy.toLowerCase();

  if (lower.startsWith("socks5://") || lower.startsWith("socks4://") || lower.startsWith("socks://")) {
    const agent = getOrCreateDispatcher(proxy) as SocksProxyAgent;
    const parsedUrl = new URL(url.toString());
    const isHttps = parsedUrl.protocol === "https:";
    const nodeModule = isHttps ? https : http;

    return new Promise<Response>((resolve, reject) => {
      const reqOptions: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: (init?.method ?? "GET").toUpperCase(),
        headers: init?.headers ? Object.fromEntries(
          init.headers instanceof Headers
            ? init.headers.entries()
            : Array.isArray(init.headers)
              ? init.headers
              : Object.entries(init.headers as Record<string, string>)
        ) : {},
        agent,
      };

      const req = nodeModule.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(new Response(body, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "",
            headers,
          }));
        });
        res.on("error", reject);
      });

      req.on("error", reject);

      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          req.destroy();
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }

      if (init?.body) {
        req.write(typeof init.body === "string" ? init.body : init.body);
      }
      req.end();
    });
  }

  const dispatcher = getOrCreateDispatcher(proxy);
  return undiciFetch(url, { ...init, dispatcher } as any) as unknown as Response;
}
