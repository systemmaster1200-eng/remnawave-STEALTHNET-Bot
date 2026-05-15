import { Request, Response, NextFunction } from "express";
import { validateApiKey } from "./api-keys.service.js";

export interface ApiKeyRequest extends Request {
  apiKeyId?: string;
  apiKeyName?: string;
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

  const key = await validateApiKey(raw);
  if (!key) {
    return res.status(403).json({
      error: "Invalid or disabled API key",
    });
  }

  (req as ApiKeyRequest).apiKeyId = key.id;
  (req as ApiKeyRequest).apiKeyName = key.name;
  next();
}
