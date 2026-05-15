import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { createApiKey, listApiKeys, deleteApiKey, toggleApiKey } from "./api-keys.service.js";

export const apiKeysAdminRouter = Router();
apiKeysAdminRouter.use(requireAuth);
apiKeysAdminRouter.use(requireAdminSection);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

apiKeysAdminRouter.get("/", async (_req, res) => {
  const keys = await listApiKeys();
  res.json(keys);
});

apiKeysAdminRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });
  }
  const result = await createApiKey(parsed.data.name, parsed.data.description);
  res.status(201).json(result);
});

apiKeysAdminRouter.patch("/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "isActive (boolean) required" });
  }
  try {
    const updated = await toggleApiKey(id, isActive);
    res.json(updated);
  } catch {
    res.status(404).json({ message: "API key not found" });
  }
});

apiKeysAdminRouter.delete("/:id", async (req, res) => {
  try {
    await deleteApiKey(req.params.id);
    res.json({ message: "Deleted" });
  } catch {
    res.status(404).json({ message: "API key not found" });
  }
});
