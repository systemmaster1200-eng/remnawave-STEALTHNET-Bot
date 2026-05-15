import { Router } from "express";
import { prisma } from "../../db.js";

// Mounted on adminRouter at "/gramads" — parent already runs requireAuth + requireAdminSection.
// Local section check would compute section from "/status" (returns "status"), breaking
// managers who only have "promo-vpn" allowed. So no auth middleware here.
export const adminGramadsRouter = Router();

const GRAMADS_BASE = "https://api.gramads.net";

// Список разрешённых путей для прокси. Только endpoints для рекламодателя (Wallet + PostManagement).
// Намеренно НЕ включаем endpoints paйblisher'а — в этом API их нет, так что список совпадает со всей OpenAPI.
const ALLOWED_PATHS = new Set<string>([
  // Wallet
  "GET:/Wallet/GetBalance",
  "GET:/Wallet/GetIncomesAndExpenses",
  "GET:/Wallet/GetMyTopups",
  // Post management — чтение
  "GET:/PostManagement/GetMyPosts",
  "GET:/PostManagement/GetMyPost",
  "GET:/PostManagement/GetMyFavouritePosts",
  "GET:/PostManagement/GetStatistics",
  "GET:/PostManagement/GetShows",
  "GET:/PostManagement/GetTags",
  "GET:/PostManagement/GetBotsShowedMyPost",
  "GET:/PostManagement/GetUseRedirectStatistic",
  "GET:/PostManagement/RequestXlsxReport",
  // Post management — мутации
  "POST:/PostManagement/AddPost",
  "POST:/PostManagement/TestPost",
  "POST:/PostManagement/SwitchEnabled",
  "POST:/PostManagement/SwitchIsFavourite",
  "POST:/PostManagement/SwitchPremiumOnlyEnabled",
  "POST:/PostManagement/SwitchGroupsEnabled",
  "POST:/PostManagement/SwitchFavouriteBotsOnlyEnabled",
  "POST:/PostManagement/SwitchGAlityEnabled",
  "POST:/PostManagement/PublishToChannel",
  "POST:/PostManagement/SetLimit",
  "POST:/PostManagement/SetSchedule",
  "POST:/PostManagement/DeleteSchedule",
  "POST:/PostManagement/SetExtraRate",
  "POST:/PostManagement/SetIpressionPerHours",
  "POST:/PostManagement/ChangeStrategy",
  "POST:/PostManagement/ChangePostCanBePublished",
  "POST:/PostManagement/SetExcludedCategories",
  "POST:/PostManagement/SetExcludedLanguages",
  "POST:/PostManagement/ExceptBot",
  "POST:/PostManagement/UnexceptBot",
  "POST:/PostManagement/AddExceptedUsersFromPost",
  "POST:/PostManagement/RemoveExceptedUsersFromPost",
]);

async function getApiKey(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "gramads_api_key" } });
  const v = (row?.value ?? "").trim();
  return v || null;
}

// Пинг: проверить, валиден ли текущий сохранённый ключ (через /Wallet/GetBalance)
adminGramadsRouter.get("/status", async (_req, res) => {
  const key = await getApiKey();
  if (!key) return res.json({ configured: false, valid: false });
  try {
    const r = await fetch(`${GRAMADS_BASE}/Wallet/GetBalance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) return res.json({ configured: true, valid: false });
    if (!r.ok) return res.json({ configured: true, valid: false, error: `HTTP ${r.status}` });
    const data = await r.json().catch(() => null);
    return res.json({ configured: true, valid: true, balance: data });
  } catch (e) {
    return res.json({ configured: true, valid: false, error: e instanceof Error ? e.message : "network error" });
  }
});

// Универсальный прокси: /api/admin/gramads/proxy/<path>?<query>
// Использует method и body из входящего запроса.
adminGramadsRouter.all(/^\/proxy\/(.+)$/, async (req, res) => {
  const key = await getApiKey();
  if (!key) return res.status(400).json({ error: "gramads_api_key is not configured" });

  const rawPath = (req.params as unknown as { "0": string })["0"] || "";
  const normalized = "/" + rawPath.replace(/^\/+/, "");
  const allowKey = `${req.method.toUpperCase()}:${normalized}`;
  if (!ALLOWED_PATHS.has(allowKey)) {
    return res.status(400).json({ error: "endpoint not allowed", allowKey });
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((vv) => qs.append(k, String(vv)));
    else qs.append(k, String(v));
  }
  const url = `${GRAMADS_BASE}${normalized}${qs.toString() ? `?${qs.toString()}` : ""}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.body);
  }

  try {
    const r = await fetch(url, { method: req.method, headers, body });
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get("content-type") || "";

    // Diagnostics: surface upstream failures and non-zero notSuccessExplanation in server logs.
    if (!r.ok) {
      const safeBody = body ? body.slice(0, 2000) : "";
      console.warn(
        `[gramads] ${req.method} ${normalized} -> HTTP ${r.status} | req=${safeBody} | resp=${text.slice(0, 2000)}`,
      );
    } else if (ct.includes("application/json")) {
      try {
        const parsed = JSON.parse(text) as { notSuccessExplanation?: number } | unknown;
        const expl = (parsed as { notSuccessExplanation?: number })?.notSuccessExplanation;
        if (typeof expl === "number" && expl !== 0) {
          const safeBody = body ? body.slice(0, 500) : "";
          console.warn(
            `[gramads] ${req.method} ${normalized} -> notSuccessExplanation=${expl} | req=${safeBody}`,
          );
        }
      } catch {
        // non-JSON response, ignore
      }
    }

    if (ct.includes("application/json")) {
      res.type("application/json").send(text);
    } else if (ct) {
      res.type(ct).send(text);
    } else {
      res.send(text);
    }
  } catch (e) {
    console.error(`[gramads] network error to ${url}:`, e);
    return res.status(502).json({ error: "gramads upstream error", message: e instanceof Error ? e.message : "unknown" });
  }
});
