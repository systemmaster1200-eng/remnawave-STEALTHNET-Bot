import { Request, Response, NextFunction } from "express";
import { validateApiKey, recordApiKeyUsage } from "./api-keys.service.js";

export interface ApiKeyRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
}

function getClientIp(req: Request): string | null {
  // Express уже распарсил X-Forwarded-For (trust proxy = 1)
  const ip = req.ip || req.socket.remoteAddress || null;
  if (!ip) return null;
  // ::ffff:1.2.3.4 → 1.2.3.4
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const raw =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization?.startsWith("Bearer sk_")
      ? req.headers.authorization.slice(7)
      : null);

  if (!raw) {
    return res.status(401).json({
      error: "API key required",
      message: "Provide API key via X-Api-Key header or Authorization: Bearer sk_...",
    });
  }

  const ip = getClientIp(req);
  const result = await validateApiKey(raw, ip);

  if (!result.ok) {
    // Если ключ был найден, но отклонён — логируем попытку
    if (result.key) {
      recordApiKeyUsage({
        apiKeyId: result.key.id,
        ip,
        ua: req.headers["user-agent"] ?? null,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: 403,
      });
    }
    const messages = {
      not_found: "Invalid API key",
      disabled: "API key disabled",
      expired: "API key expired",
      ip_blocked: "Request from this IP is not allowed for this API key",
    } as const;
    return res.status(403).json({
      error: messages[result.reason ?? "not_found"],
    });
  }

  const key = result.key!;
  (req as ApiKeyRequest).apiKeyId = key.id;
  (req as ApiKeyRequest).apiKeyName = key.name;

  // Логируем успешный запрос ПОСЛЕ ответа (через res.on("finish"))
  res.on("finish", () => {
    recordApiKeyUsage({
      apiKeyId: key.id,
      ip,
      ua: req.headers["user-agent"] ?? null,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
    });
  });

  next();
}
