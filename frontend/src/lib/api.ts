const API_BASE = "/api";

/** Вызывается при 401: возвращает новый access token или null. Устанавливается из AuthProvider. */
let tokenRefreshFn: (() => Promise<string | null>) | null = null;
export function setTokenRefreshFn(fn: (() => Promise<string | null>) | null) {
  tokenRefreshFn = fn;
}

export interface Admin {
  id: string;
  email: string;
  mustChangePassword: boolean;
  role: string;
  /** Для роли MANAGER — список разделов, к которым есть доступ. Для ADMIN не используется. */
  allowedSections?: string[];
  /** Включена ли двухфакторная аутентификация */
  totpEnabled?: boolean;
}

/** Разделы, которые можно выдать менеджеру (без "admins"). */
export type ManagerSectionCategory = "overview" | "management" | "subscription" | "tools" | "settings";

export const MANAGER_SECTION_CATEGORIES: { key: ManagerSectionCategory; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "management", label: "Управление" },
  { key: "subscription", label: "Подписка" },
  { key: "tools", label: "Инструменты" },
  { key: "settings", label: "Настройки" },
];

export const MANAGER_SECTIONS: { key: string; label: string; category: ManagerSectionCategory }[] = [
  // Обзор
  { key: "dashboard", label: "Дашборд", category: "overview" },
  { key: "remna-nodes", label: "Виджет нод Remna (на дашборде)", category: "overview" },
  { key: "analytics", label: "Аналитика", category: "overview" },
  { key: "sales-report", label: "Отчёты продаж", category: "overview" },
  { key: "traffic-abuse", label: "Анализ трафика", category: "overview" },
  { key: "geo-map", label: "Карта нод", category: "overview" },
  // Управление
  { key: "clients", label: "Клиенты", category: "management" },
  { key: "proxy", label: "Прокси", category: "management" },
  { key: "singbox", label: "Sing-box", category: "management" },
  { key: "backup", label: "Бэкапы", category: "management" },
  { key: "tickets", label: "Тикеты", category: "management" },
  // Подписка
  { key: "tariffs", label: "Тарифы", category: "subscription" },
  { key: "promo", label: "Промо-ссылки", category: "subscription" },
  { key: "promo-codes", label: "Промокоды", category: "subscription" },
  { key: "marketing", label: "Маркетинг", category: "subscription" },
  { key: "referral-network", label: "Реф. сеть", category: "subscription" },
  { key: "secondary-subscriptions", label: "Доп. подписки", category: "subscription" },
  // Инструменты
  { key: "video-instructions", label: "Видео-инструкции", category: "tools" },
  { key: "broadcast", label: "Рассылка", category: "tools" },
  { key: "auto-broadcast", label: "Авто-рассылка", category: "tools" },
  { key: "contests", label: "Конкурсы", category: "tools" },
  { key: "tour-constructor", label: "Конструктор тура", category: "tools" },
  { key: "marketplace", label: "Маркетплейс", category: "tools" },
  // Настройки
  { key: "settings", label: "Настройки", category: "settings" },
  { key: "languages", label: "Языки", category: "settings" },
  { key: "api-keys", label: "API ключи", category: "settings" },
  { key: "bots", label: "Боты-клоны", category: "settings" },
];

/** Вложение тикета. URL относительный — `/api/uploads/tickets/...`. */
export interface TicketAttachmentDto {
  url: string;
  mime: string;
  size: number;
  name?: string;
}

/** Сообщение тикета — в ответе клиентского и админского API. */
export interface TicketMessageDto {
  id: string;
  authorType: string;
  content: string;
  attachments?: TicketAttachmentDto[];
  createdAt: string;
  isRead?: boolean;
}

export interface AdminListItem {
  id: string;
  email: string;
  role: string;
  allowedSections: string[];
  mustChangePassword?: boolean;
  createdAt?: string;
}

/** Наценка клона: суммы по валютам из PAID-платежей (без balance) минус выплаты. */
export interface AdminBotEarnings {
  earnedTotal: number;
  earnedByCurrency: Record<string, number>;
  paidOutTotal: number;
  paidOutByCurrency: Record<string, number>;
  balance: number;
  balanceByCurrency: Record<string, number>;
}

export interface AdminBotDto {
  id: string;
  /** Маскированный токен (ответ API). */
  token: string;
  username: string | null;
  markupPercent: number;
  ownerTelegramId: string | null;
  ownerName: string | null;
  isActive: boolean;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBotListItem extends AdminBotDto {
  clientsCount: number;
  earnings: AdminBotEarnings;
}

export interface BotPayoutDto {
  id: string;
  botId: string;
  amount: number;
  currency: string;
  comment: string | null;
  paidAt: string;
  createdBy: string;
  createdAt: string;
}

export type ContestPrizeType = "custom" | "balance" | "vpn_days";
export type ContestDrawType = "random" | "by_days_bought" | "by_payments_count" | "by_referrals_count";
export type ContestStatus = "draft" | "active" | "ended" | "drawn";

export interface ContestFormPayload {
  name: string;
  startAt: string;
  endAt: string;
  prize1Type: ContestPrizeType;
  prize1Value: string;
  prize2Type: ContestPrizeType;
  prize2Value: string;
  prize3Type: ContestPrizeType;
  prize3Value: string;
  conditionsJson: string | null;
  drawType: ContestDrawType;
  dailyMessage: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  /** Включены ли напоминания для этого контеста (issue #35) */
  reminderEnabled?: boolean;
  /** Интервал между напоминаниями в часах. 0 = не слать periodic-напоминания (только startNotification + deadline). */
  reminderIntervalHours?: number;
  /** CSV часов до endAt: "24,1" → за 24ч и за 1ч до окончания. Пусто = выкл. */
  reminderDeadlineHoursBefore?: string;
}

export interface ContestListItem {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  prize1Type: ContestPrizeType;
  prize1Value: string;
  prize2Type: ContestPrizeType;
  prize2Value: string;
  prize3Type: ContestPrizeType;
  prize3Value: string;
  conditionsJson: string | null;
  drawType: ContestDrawType;
  dailyMessage: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  reminderEnabled?: boolean;
  reminderIntervalHours?: number;
  reminderDeadlineHoursBefore?: string;
  status: ContestStatus;
  createdAt: string;
  updatedAt: string;
  winners: { place: number; prizeType: string; prizeValue: string; client?: { id: string; email: string | null; telegramUsername: string | null } }[];
}

export interface ContestDetail extends ContestListItem {
  winners: { place: number; prizeType: string; prizeValue: string; appliedAt: string | null; client?: { id: string; email: string | null; telegramId: string | null; telegramUsername: string | null } }[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  admin: Admin;
}

/** Ответ входа, когда у админа включена 2FA */
export interface AdminAuthRequires2FA {
  requires2FA: true;
  tempToken: string;
}

export interface AuthState {
  admin: Admin | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** Временный токен для шага 2FA после проверки пароля */
  pending2FAToken: string | null;
}

// ───────── Gramads (Advertising API for Resellers) types ─────────
export interface GramadsBalanceDto { balance: number; notSuccessExplanation?: number }
export interface GramadsChartDto { year: number; month: number; day: number; count: number; paidReward: number }
export interface GramadsIncomesExpensesDto { incomes: GramadsChartDto[]; expenses: GramadsChartDto[]; notSuccessExplanation?: number }
export interface GramadsDepositDto { id: number; amount: number; depositReason: number; dateCreated: string }
export interface GramadsDepositPageDto { items: GramadsDepositDto[]; currentPageIndex: number; totalItemsCount: number; totalPagesCount: number }
export interface GramadsScheduleDto { postId: number; utcScheduleFrom?: string | null; utcScheduleTill?: string | null }
export interface GramadsRedirectUrlDto { postId: number; linkNumber: number; sourceUrl?: string | null }
export interface GramadsPostDto {
  id: number;
  text?: string | null;
  buttonText?: string | null;
  link?: string | null;
  buttonsInfo?: string | null;
  extraPriceButtons: number;
  enabled: boolean;
  totalShows: number;
  limit: number;
  campaignForBot?: string | null;
  isRestricted: boolean;
  isArchived: boolean;
  useRedirects: boolean;
  extraRate: number;
  gAlityEnabled: boolean;
  premiumOnlyEnabled: boolean;
  favouriteBotsOnly: boolean;
  groupChatsEnabled: boolean;
  gramAdsPromoChannelPublished: boolean;
  isFavourite: boolean;
  schedule?: GramadsScheduleDto;
  /** 0=minimum, 1=normal, 2=max */
  strategy: number;
  /** 0=pending, 1=approved, 2=rejected */
  moderationStatus: number;
  /** 0=yes, 1=no, 2=moderated */
  postCanBePublished: number;
  excludedCategories?: number[];
  excludedLanguages?: string[];
  redirectUrlDtos?: GramadsRedirectUrlDto[];
  dateCreated: string;
  /** 0-7 PostCategory */
  postCategory: number;
  /** 0=None, 1=Markdown, 2=HTML */
  markup: number;
  exceptedUsersCount: number;
  impressionPerHours: number;
  paid: number;
  notSuccessExplanation?: number;
}
export interface GramadsPostPageDto { items: GramadsPostDto[]; currentPageIndex: number; totalItemsCount: number; totalPagesCount: number }
export interface GramadsTagDto { tag: string; count: number }
export interface GramadsShowDto {
  id: number; postId: number; botUsername?: string | null; showedToUserName?: string | null; showedToUserUsername?: string | null;
  buttonsInfo?: string | null; postText?: string | null; buttonText?: string | null; postLink?: string | null;
  forUsername?: string | null; postContentBannedFromBot: boolean; language?: string | null; dateShowed: string;
}
export interface GramadsShowPageDto { items: GramadsShowDto[]; currentPageIndex: number; totalItemsCount: number; totalPagesCount: number }
export interface GramadsBotShowedMyPostDto {
  botId: number; postId: number; botUsername?: string | null; botPic?: string | null; botName?: string | null;
  views: number; isExcepted: boolean; category: number; isFavourite: boolean;
}


async function request<T>(
  path: string,
  options: RequestInit & { token?: string; _retry?: boolean } = {}
): Promise<T> {
  const { token, _retry, ...init } = options;
  const headers = new Headers(init.headers);
  // Для FormData Content-Type НЕ выставляем: браузер сам добавит boundary.
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(res.statusText || "Request failed");
  }

  if (res.status === 401 && token && !_retry && tokenRefreshFn && !path.startsWith("/auth/")) {
    const newToken = await tokenRefreshFn();
    if (newToken) {
      return request<T>(path, { ...options, token: newToken, _retry: true });
    }
  }

  if (!res.ok) {
    const message = (data as { message?: string })?.message ?? res.statusText;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  async login(email: string, password: string): Promise<LoginResponse | AdminAuthRequires2FA> {
    return request<LoginResponse | AdminAuthRequires2FA>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  /** Обмен временного токена на access/refresh после ввода кода 2FA */
  async admin2FALogin(tempToken: string, code: string): Promise<LoginResponse> {
    return request("/auth/2fa-login", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    });
  },

  /** Запуск настройки 2FA админа (возвращает secret и otpauthUrl для QR) */
  async admin2FASetup(token: string): Promise<{ secret: string; otpauthUrl: string }> {
    return request("/auth/2fa/setup", { method: "POST", token });
  },
  /** Подтвердить включение 2FA админа кодом из приложения */
  async admin2FAConfirm(token: string, code: string): Promise<{ message: string }> {
    return request("/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }), token });
  },
  /** Отключить 2FA админа (требуется код из приложения) */
  async admin2FADisable(token: string, code: string): Promise<{ message: string }> {
    return request("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }), token });
  },

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: string; admin: Admin }> {
    return request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  },

  async logout(refreshToken: string | null) {
    if (refreshToken) {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }).catch(() => { });
    }
  },

  async changePassword(
    currentPassword: string,
    newPassword: string,
    token: string
  ): Promise<{ success: boolean; message: string; admin: Admin }> {
    return request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
      token,
    });
  },

  async getMe(token: string): Promise<Admin> {
    return request<Admin>("/admin/me", { token });
  },

  async getRemnaStatus(token: string): Promise<{ configured: boolean }> {
    return request("/admin/remna/status", { token });
  },

  async getDashboardStats(token: string): Promise<DashboardStats> {
    return request("/admin/dashboard/stats", { token });
  },

  async getServerStats(token: string): Promise<ServerStats> {
    return request("/admin/server/stats", { token });
  },

  async getSshConfig(token: string): Promise<SshConfig | null> {
    return request("/admin/server/ssh", { token }).then((r) => r as SshConfig).catch(() => null);
  },

  async updateSshConfig(token: string, data: Partial<SshConfig>): Promise<SshConfig> {
    return request("/admin/server/ssh", { method: "PATCH", body: JSON.stringify(data), token });
  },

  async testNalogConnection(token: string): Promise<{ ok: boolean; error?: string; inn?: string }> {
    return request("/admin/nalog/test", { method: "POST", token });
  },

  async getAutoRenewStats(token: string): Promise<AutoRenewStats> {
    return request("/admin/auto-renew/stats", { token });
  },

  async getAdminNotificationCounters(token: string): Promise<AdminNotificationCounters> {
    return request("/admin/notifications/counters", { token });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAnalytics(token: string): Promise<any> {
    return request("/admin/analytics", { token });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getSalesReport(token: string, params?: { from?: string; to?: string; provider?: string; search?: string; status?: string; page?: number; limit?: number }): Promise<any> {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.provider) qs.set("provider", params.provider);
    if (params?.search) qs.set("search", params.search);
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return request(`/admin/sales-report${q ? `?${q}` : ""}`, { token });
  },

  async deleteSalePayment(token: string, paymentId: string): Promise<{ ok: boolean }> {
    return request(`/admin/sales-report/${paymentId}`, { token, method: "DELETE" });
  },

  async getVideoInstructions(token: string): Promise<{ enabled: boolean; items: { id: string; title: string; telegramFileId: string; sortOrder: number }[] }> {
    return request("/admin/video-instructions", { token });
  },

  async toggleVideoInstructions(token: string, enabled: boolean): Promise<{ ok: boolean }> {
    return request("/admin/video-instructions/toggle", { token, method: "PUT", body: JSON.stringify({ enabled }) });
  },

  async addVideoInstruction(token: string, title: string, telegramFileId: string): Promise<{ ok: boolean; items: any[] }> {
    return request("/admin/video-instructions", { token, method: "POST", body: JSON.stringify({ title, telegramFileId }) });
  },

  async updateVideoInstruction(token: string, id: string, data: { title?: string; telegramFileId?: string }): Promise<{ ok: boolean; items: any[] }> {
    return request(`/admin/video-instructions/${id}`, { token, method: "PUT", body: JSON.stringify(data) });
  },

  async deleteVideoInstruction(token: string, id: string): Promise<{ ok: boolean; items: any[] }> {
    return request(`/admin/video-instructions/${id}`, { token, method: "DELETE" });
  },

  async reorderVideoInstructions(token: string, order: string[]): Promise<{ ok: boolean; items: any[] }> {
    return request("/admin/video-instructions/reorder", { token, method: "PUT", body: JSON.stringify({ order }) });
  },

  async getRemnaSystemStats(token: string): Promise<RemnaSystemStats> {
    return request("/admin/remna/system/stats", { token });
  },

  async getRemnaNodes(token: string): Promise<RemnaNodesResponse> {
    return request("/admin/remna/nodes", { token });
  },

  async remnaNodeEnable(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/enable`, { method: "POST", token });
  },

  async remnaNodeDisable(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/disable`, { method: "POST", token });
  },

  async remnaNodeRestart(token: string, nodeUuid: string): Promise<unknown> {
    return request(`/admin/remna/nodes/${nodeUuid}/restart`, { method: "POST", token });
  },

  // ——— Прокси-ноды ———
  async getProxyNodes(token: string): Promise<{ items: ProxyNodeListItem[] }> {
    return request("/admin/proxy/nodes", { token });
  },

  async createProxyNode(token: string, data?: { name?: string }): Promise<CreateProxyNodeResponse> {
    return request("/admin/proxy/nodes", { method: "POST", body: JSON.stringify(data ?? {}), token });
  },

  async getProxyNode(token: string, id: string): Promise<ProxyNodeDetail> {
    return request(`/admin/proxy/nodes/${id}`, { token });
  },

  async updateProxyNode(token: string, id: string, data: { name?: string; status?: string; capacity?: number | null; socksPort?: number; httpPort?: number }): Promise<unknown> {
    return request(`/admin/proxy/nodes/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteProxyNode(token: string, id: string): Promise<void> {
    return request(`/admin/proxy/nodes/${id}`, { method: "DELETE", token });
  },

  async getProxyCategories(token: string): Promise<{ items: { id: string; name: string; sortOrder: number; tariffs: { id: string; categoryId: string; name: string; proxyCount: number; durationDays: number; trafficLimitBytes: string | null; connectionLimit: number | null; price: number; currency: string; sortOrder: number; enabled: boolean; nodeIds: string[] }[] }[] }> {
    return request("/admin/proxy/categories", { token });
  },
  async createProxyCategory(token: string, data: { name: string; sortOrder?: number }): Promise<{ id: string; name: string; sortOrder: number }> {
    return request("/admin/proxy/categories", { method: "POST", body: JSON.stringify(data), token });
  },
  async updateProxyCategory(token: string, id: string, data: { name?: string; sortOrder?: number }): Promise<unknown> {
    return request(`/admin/proxy/categories/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  async deleteProxyCategory(token: string, id: string): Promise<void> {
    return request(`/admin/proxy/categories/${id}`, { method: "DELETE", token });
  },

  async getProxyTariffs(token: string, categoryId?: string): Promise<{ items: { id: string; categoryId: string; categoryName: string; name: string; proxyCount: number; durationDays: number; trafficLimitBytes: string | null; connectionLimit: number | null; price: number; currency: string; sortOrder: number; enabled: boolean }[] }> {
    const q = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    return request(`/admin/proxy/tariffs${q}`, { token });
  },
  async createProxyTariff(token: string, data: { categoryId: string; name: string; proxyCount: number; durationDays: number; trafficLimitBytes?: string | number | null; connectionLimit?: number | null; price: number; currency: string; sortOrder?: number; enabled?: boolean; nodeIds?: string[] }): Promise<unknown> {
    return request("/admin/proxy/tariffs", { method: "POST", body: JSON.stringify(data), token });
  },
  async updateProxyTariff(token: string, id: string, data: Partial<{ name: string; proxyCount: number; durationDays: number; trafficLimitBytes: string | number | null; connectionLimit: number | null; price: number; currency: string; sortOrder: number; enabled: boolean; nodeIds: string[] }>): Promise<unknown> {
    return request(`/admin/proxy/tariffs/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  async deleteProxyTariff(token: string, id: string): Promise<void> {
    return request(`/admin/proxy/tariffs/${id}`, { method: "DELETE", token });
  },

  async getProxySlotsAdmin(token: string): Promise<{ items: ProxySlotAdminItem[] }> {
    return request("/admin/proxy/slots", { token });
  },

  async updateProxySlotAdmin(token: string, id: string, data: { login?: string; password?: string; connectionLimit?: number | null; status?: string; expiresAt?: string }): Promise<unknown> {
    return request(`/admin/proxy/slots/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteProxySlotAdmin(token: string, id: string): Promise<void> {
    return request(`/admin/proxy/slots/${id}`, { method: "DELETE", token });
  },

  // ——— Sing-box ноды ———
  async getSingboxNodes(token: string): Promise<{ items: SingboxNodeListItem[] }> {
    return request("/admin/singbox/nodes", { token });
  },

  async createSingboxNode(token: string, data?: { name?: string; protocol?: string; port?: number; tlsEnabled?: boolean }): Promise<CreateSingboxNodeResponse> {
    return request("/admin/singbox/nodes", { method: "POST", body: JSON.stringify(data ?? {}), token });
  },

  async getSingboxNode(token: string, id: string): Promise<SingboxNodeDetail> {
    return request(`/admin/singbox/nodes/${id}`, { token });
  },

  async updateSingboxNode(
    token: string,
    id: string,
    data: {
      name?: string;
      status?: string;
      capacity?: number | null;
      port?: number;
      protocol?: string;
      tlsEnabled?: boolean;
      customConfigJson?: string | null;
    }
  ): Promise<unknown> {
    return request(`/admin/singbox/nodes/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteSingboxNode(token: string, id: string): Promise<void> {
    return request(`/admin/singbox/nodes/${id}`, { method: "DELETE", token });
  },

  async getSingboxCategories(token: string): Promise<{ items: SingboxCategoryItem[] }> {
    return request("/admin/singbox/categories", { token });
  },

  async createSingboxCategory(token: string, data: { name: string; sortOrder?: number }): Promise<{ id: string; name: string; sortOrder: number }> {
    return request("/admin/singbox/categories", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateSingboxCategory(token: string, id: string, data: { name?: string; sortOrder?: number }): Promise<unknown> {
    return request(`/admin/singbox/categories/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteSingboxCategory(token: string, id: string): Promise<void> {
    return request(`/admin/singbox/categories/${id}`, { method: "DELETE", token });
  },

  async getSingboxTariffs(token: string, categoryId?: string): Promise<{ items: SingboxTariffListItem[] }> {
    const q = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    return request(`/admin/singbox/tariffs${q}`, { token });
  },

  async createSingboxTariff(
    token: string,
    data: { categoryId: string; name: string; slotCount: number; durationDays: number; trafficLimitBytes?: string | number | null; price: number; currency: string; sortOrder?: number; enabled?: boolean }
  ): Promise<unknown> {
    return request("/admin/singbox/tariffs", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateSingboxTariff(
    token: string,
    id: string,
    data: { categoryId?: string; name?: string; slotCount?: number; durationDays?: number; trafficLimitBytes?: string | number | null; price?: number; currency?: string; sortOrder?: number; enabled?: boolean }
  ): Promise<unknown> {
    return request(`/admin/singbox/tariffs/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteSingboxTariff(token: string, id: string): Promise<void> {
    return request(`/admin/singbox/tariffs/${id}`, { method: "DELETE", token });
  },

  /** Скачивает CSV со списком прокси-слотов. */
  async downloadProxySlotsCsv(token: string): Promise<void> {
    const res = await fetch(`${API_BASE}/admin/proxy/slots/export?format=csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(res.statusText || "Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proxy-slots.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  async getClients(
    token: string,
    page = 1,
    limit = 20,
    params?: { search?: string; isBlocked?: boolean }
  ): Promise<{ items: ClientRecord[]; total: number; page: number; limit: number }> {
    const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (params?.search?.trim()) sp.set("search", params.search.trim());
    if (params?.isBlocked === true) sp.set("isBlocked", "true");
    if (params?.isBlocked === false) sp.set("isBlocked", "false");
    return request(`/admin/clients?${sp.toString()}`, { token });
  },

  /** Лёгкий поллинг онлайн-статусов: принимает массив remnawaveUuid, возвращает { [uuid]: { onlineAt } } */
  async getClientsOnlineStatuses(
    token: string,
    uuids: string[]
  ): Promise<Record<string, { onlineAt: string | null }>> {
    return request("/admin/clients/online-statuses", {
      method: "POST",
      body: JSON.stringify({ uuids }),
      token,
    });
  },

  async getClient(token: string, id: string): Promise<ClientRecord> {
    return request(`/admin/clients/${id}`, { token });
  },

  async updateClient(token: string, id: string, data: UpdateClientPayload): Promise<ClientRecord> {
    return request(`/admin/clients/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async setClientPassword(token: string, clientId: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    return request(`/admin/clients/${clientId}/password`, {
      method: "PATCH",
      body: JSON.stringify({ newPassword }),
      token,
    });
  },

  async deleteClient(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/clients/${id}`, { method: "DELETE", token });
  },

  async getClientRemna(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna`, { token });
  },

  async updateClientRemna(token: string, clientId: string, data: UpdateClientRemnaPayload): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async clientRemnaRevokeSubscription(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/revoke-subscription`, { method: "POST", token });
  },

  /** Отвязать клиента от Remna (remnawaveUuid = null). Клиент остаётся, связь сбрасывается —
   *  используется если Remna-пользователь удалён руками в панели Remna и sync зависает. */
  async clientRemnaUnlink(token: string, clientId: string): Promise<{ ok: boolean }> {
    return request(`/admin/clients/${clientId}/remna/unlink`, { method: "POST", token });
  },

  async clientRemnaDisable(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/disable`, { method: "POST", token });
  },

  async clientRemnaEnable(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/enable`, { method: "POST", token });
  },

  async clientRemnaResetTraffic(token: string, clientId: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/reset-traffic`, { method: "POST", token });
  },

  async grantClientTariff(
    token: string,
    clientId: string,
    payload: { tariffId: string; tariffPriceOptionId?: string;
      deviceCount?: number; note?: string; createPaymentRecord?: boolean }
  ): Promise<{ ok: boolean; paymentId: string | null; tariff: { id: string; name: string; durationDays: number }; message?: string }> {
    return request(`/admin/clients/${clientId}/grant-tariff`, {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    });
  },

  async clientRemnaSquadAdd(token: string, clientId: string, squadUuid: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/squads/add`, { method: "POST", body: JSON.stringify({ squadUuid }), token });
  },

  async clientRemnaSquadRemove(token: string, clientId: string, squadUuid: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/squads/remove`, { method: "POST", body: JSON.stringify({ squadUuid }), token });
  },

  async getClientRemnaDevices(token: string, clientId: string): Promise<RemnaHwidDevicesResponse> {
    return request(`/admin/clients/${clientId}/remna/devices`, { token });
  },

  async deleteClientRemnaDevice(token: string, clientId: string, hwid: string): Promise<unknown> {
    return request(`/admin/clients/${clientId}/remna/devices/delete`, { method: "POST", body: JSON.stringify({ hwid }), token });
  },

  async getClientRemnaUsage(token: string, clientId: string, days = 30): Promise<RemnaUserUsageResponse> {
    return request(`/admin/clients/${clientId}/remna/usage?days=${days}`, { token });
  },

  async getRemnaSubscriptionTemplates(token: string): Promise<unknown> {
    return request("/admin/remna/subscription-templates", { token });
  },

  async getRemnaSquadsInternal(token: string): Promise<unknown> {
    return request("/admin/remna/squads/internal", { token });
  },

  async getSettings(token: string): Promise<AdminSettings> {
    return request("/admin/settings", { token });
  },

  async getReferralNetwork(token: string): Promise<{
    nodes: Array<{
      id: string;
      name: string;
      status: string;
      referralsCount: number;
      subscriptionIncome: number;
      referralIncome: number;
      campaign: string | null;
    }>;
    links: Array<{ source: string; target: string }>;
    stats: {
      totalUsers: number;
      totalReferrers: number;
      totalCampaigns: number;
      totalSubscriptionIncome: number;
      totalReferralIncome: number;
    };
  }> {
    return request("/admin/referrals/network", { token });
  },

  async getTrafficAbuseAnalytics(
    token: string,
    params?: { days?: number; threshold?: number; minBytes?: number }
  ): Promise<TrafficAbuseResponse> {
    const qs = new URLSearchParams();
    if (params?.days) qs.set("days", String(params.days));
    if (params?.threshold) qs.set("threshold", String(params.threshold));
    if (params?.minBytes) qs.set("minBytes", String(params.minBytes));
    const q = qs.toString();
    return request(`/admin/traffic-abuse/analytics${q ? `?${q}` : ""}`, { token });
  },

  async getApiKeys(token: string): Promise<ApiKeyListItem[]> {
    return request("/admin/api-keys", { token });
  },
  async createApiKey(token: string, data: { name: string; description?: string }): Promise<ApiKeyCreated> {
    return request("/admin/api-keys", { method: "POST", body: JSON.stringify(data), token });
  },
  async toggleApiKey(token: string, id: string, isActive: boolean): Promise<void> {
    return request(`/admin/api-keys/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ isActive }), token });
  },
  async deleteApiKey(token: string, id: string): Promise<void> {
    return request(`/admin/api-keys/${id}`, { method: "DELETE", token });
  },

  async getAdminBots(token: string): Promise<{ items: AdminBotListItem[] }> {
    return request("/admin/bots", { token });
  },
  async getAdminBot(token: string, id: string): Promise<AdminBotListItem> {
    return request(`/admin/bots/${id}`, { token });
  },
  async createAdminBot(
    token: string,
    data: {
      token: string;
      username?: string;
      markupPercent?: number;
      ownerTelegramId?: string;
      ownerName?: string;
      notes?: string;
    },
  ): Promise<AdminBotDto> {
    return request("/admin/bots", { method: "POST", body: JSON.stringify(data), token });
  },
  async updateAdminBot(
    token: string,
    id: string,
    data: Partial<{
      token: string;
      username: string | null;
      markupPercent: number;
      ownerTelegramId: string | null;
      ownerName: string | null;
      isActive: boolean;
      notes: string | null;
    }>,
  ): Promise<AdminBotDto> {
    return request(`/admin/bots/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  async deleteAdminBot(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/bots/${id}`, { method: "DELETE", token });
  },
  async getAdminBotPayouts(token: string, botId: string): Promise<{ items: BotPayoutDto[] }> {
    return request(`/admin/bots/${botId}/payouts`, { token });
  },
  async createAdminBotPayout(
    token: string,
    botId: string,
    data: { amount: number; currency?: string; comment?: string; paidAt?: string },
  ): Promise<BotPayoutDto> {
    return request(`/admin/bots/${botId}/payouts`, { method: "POST", body: JSON.stringify(data), token });
  },
  async deleteAdminBotPayout(token: string, botId: string, payoutId: string): Promise<{ ok: boolean }> {
    return request(`/admin/bots/${botId}/payouts/${payoutId}`, { method: "DELETE", token });
  },

  async getAdmins(token: string): Promise<AdminListItem[]> {
    return request("/admin/admins", { token });
  },
  async createManager(token: string, data: { email: string; password: string; allowedSections: string[] }): Promise<AdminListItem> {
    return request("/admin/admins", { method: "POST", body: JSON.stringify(data), token });
  },
  async updateManager(token: string, id: string, data: { allowedSections?: string[]; password?: string }): Promise<AdminListItem> {
    return request(`/admin/admins/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  async deleteManager(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/admins/${id}`, { method: "DELETE", token });
  },

  // ────── Admin Secondary Subscriptions ──────
  async getSecondarySubscriptions(
    token: string,
    filters?: AdminSecondarySubscriptionFilters
  ): Promise<AdminSecondarySubscriptionsResponse> {
    const qs = new URLSearchParams();
    if (filters?.page) qs.set("page", String(filters.page));
    if (filters?.limit) qs.set("limit", String(filters.limit));
    if (filters?.search) qs.set("search", filters.search);
    if (filters?.giftStatus) qs.set("giftStatus", filters.giftStatus);
    if (filters?.dateFrom) qs.set("dateFrom", filters.dateFrom);
    if (filters?.dateTo) qs.set("dateTo", filters.dateTo);
    if (filters?.sortBy) qs.set("sortBy", filters.sortBy);
    if (filters?.sortDir) qs.set("sortDir", filters.sortDir);
    const q = qs.toString();
    return request(`/admin/secondary-subscriptions${q ? `?${q}` : ""}`, { token });
  },
  async getSecondarySubscription(
    token: string,
    id: string
  ): Promise<AdminSecondarySubscriptionDetail> {
    return request(`/admin/secondary-subscriptions/${id}`, { token });
  },
  async deleteSecondarySubscription(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/secondary-subscriptions/${id}`, { method: "DELETE", token });
  },
  async deleteSecondarySubscriptionsBulk(token: string, ids: string[]): Promise<{ success: boolean; deleted: number }> {
    return request("/admin/secondary-subscriptions/bulk", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
      token,
    });
  },

  // ────── Gift Analytics ──────
  async getGiftAnalytics(token: string): Promise<GiftAnalytics> {
    return request("/admin/gift-analytics", { token });
  },

  // ────── Admin Gift Code Creation ──────
  async adminCreateGiftCode(
    token: string,
    data: { clientId: string; tariffId: string; giftMessage?: string },
  ): Promise<{ code: string; expiresAt: string; secondarySubscriptionId: string }> {
    return request("/admin/gift-codes/create", {
      method: "POST",
      body: JSON.stringify(data),
      token,
    });
  },

  /** Конкурсы: список */
  async getContests(token: string): Promise<ContestListItem[]> {
    return request("/admin/contests", { token });
  },
  /** Конкурсы: один */
  async getContest(token: string, id: string): Promise<ContestDetail> {
    return request(`/admin/contests/${id}`, { token });
  },
  /** Конкурсы: создать */
  async createContest(token: string, data: ContestFormPayload): Promise<ContestDetail> {
    return request("/admin/contests", { method: "POST", body: JSON.stringify(data), token });
  },
  /** Конкурсы: обновить */
  async updateContest(token: string, id: string, data: Partial<ContestFormPayload>): Promise<ContestDetail> {
    return request(`/admin/contests/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  /** Конкурсы: сменить статус */
  async patchContestStatus(token: string, id: string, status: "draft" | "active" | "ended"): Promise<ContestDetail> {
    return request(`/admin/contests/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }), token });
  },
  /** Конкурсы: превью участников */
  async getContestParticipantsPreview(token: string, id: string): Promise<{ total: number; participants: { clientId: string; totalDaysBought: number; paymentsCount: number; referralsCount?: number }[] }> {
    return request(`/admin/contests/${id}/participants-preview`, { token });
  },
  /** Конкурсы: запустить (отправить уведомление всем и выставить статус «Активен») */
  async launchContest(token: string, id: string): Promise<{ message: string; sent?: number; errors?: number }> {
    return request(`/admin/contests/${id}/launch`, { method: "POST", token });
  },
  /** Конкурсы: провести розыгрыш */
  async runContestDraw(token: string, id: string): Promise<{ message: string; winners: unknown[] }> {
    return request(`/admin/contests/${id}/draw`, { method: "POST", token });
  },
  /** Конкурсы: удалить */
  async deleteContest(token: string, id: string): Promise<void> {
    return request(`/admin/contests/${id}`, { method: "DELETE", token });
  },

  /** Базовый конфиг страницы подписки для визуального редактора (subpage-*.json) */
  async getDefaultSubscriptionPageConfig(token: string): Promise<SubscriptionPageConfig | null> {
    return request("/admin/default-subscription-page-config", { token });
  },

  async updateSettings(token: string, data: UpdateSettingsPayload): Promise<AdminSettings> {
    return request("/admin/settings", { method: "PATCH", body: JSON.stringify(data), token });
  },

  /** Админ: сброс текстов лендинга на исходные (из кода). Возвращает обновлённые настройки. */
  async resetLandingText(token: string): Promise<AdminSettings> {
    return request("/admin/settings/reset-landing-text", { method: "POST", token });
  },

  /** Админ: список тикетов (опционально ?status=open|closed) */
  async getAdminTickets(token: string, status?: "open" | "closed"): Promise<{
    items: { id: string; subject: string; status: string; createdAt: string; updatedAt: string; client: { id: string; email: string | null; telegramUsername: string | null } }[];
  }> {
    const q = status ? `?status=${status}` : "";
    return request(`/admin/tickets${q}`, { token });
  },
  /** Админ: один тикет с сообщениями */
  async getAdminTicket(token: string, id: string): Promise<{
    id: string;
    subject: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    client: { id: string; email: string | null; telegramUsername: string | null };
    messages: TicketMessageDto[];
  }> {
    return request(`/admin/tickets/${id}`, { token });
  },
  /** Админ: закрыть/открыть тикет */
  async patchAdminTicket(token: string, id: string, data: { status: "open" | "closed" }): Promise<{ id: string; status: string }> {
    return request(`/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },
  /** Админ: ответ в тикет (поддержка). Можно приложить до 5 фото — тогда уходит multipart/form-data. */
  async postAdminTicketMessage(
    token: string,
    ticketId: string,
    data: { content: string; files?: File[] }
  ): Promise<TicketMessageDto> {
    const files = data.files ?? [];
    if (files.length > 0) {
      const fd = new FormData();
      fd.append("content", data.content ?? "");
      for (const f of files) fd.append("files", f);
      return request(`/admin/tickets/${ticketId}/messages`, { method: "POST", body: fd, token });
    }
    return request(`/admin/tickets/${ticketId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: data.content }),
      token,
    });
  },

  async syncFromRemna(token: string): Promise<SyncResult> {
    return request("/admin/sync/from-remna", { method: "POST", token });
  },

  async syncToRemna(token: string): Promise<SyncToRemnaResult> {
    return request("/admin/sync/to-remna", { method: "POST", token });
  },

  async syncCreateRemnaForMissing(token: string): Promise<SyncCreateRemnaForMissingResult> {
    return request("/admin/sync/create-remna-for-missing", { method: "POST", token });
  },

  /** Количество получателей рассылки (с Telegram / с email) */
  async broadcastRecipientsCount(token: string): Promise<{ withTelegram: number; withEmail: number }> {
    return request("/admin/broadcast/recipients-count", { token });
  },

  /**
   * Поставить рассылку в очередь.
   * Возвращает jobId — результат нужно опрашивать через `broadcastStatus(jobId)`,
   * потому что сама рассылка идёт в фоне на бэкенде (может длиться минуты).
   */
  async broadcast(
    token: string,
    body: { channel: "telegram" | "email" | "both"; subject?: string; message: string; buttonText?: string; buttonUrl?: string },
    attachment?: File | null
  ): Promise<{ jobId: string }> {
    const form = new FormData();
    form.append("channel", body.channel);
    form.append("message", body.message);
    if (body.subject != null && body.subject !== "") form.append("subject", body.subject);
    if (body.buttonText?.trim()) form.append("buttonText", body.buttonText.trim());
    if (body.buttonUrl?.trim()) form.append("buttonUrl", body.buttonUrl.trim());
    if (attachment) form.append("attachment", attachment, attachment.name);
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/broadcast`, { method: "POST", headers, body: form });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(res.statusText || "Request failed");
    }
    if (res.status === 401 && token && tokenRefreshFn && !res.url.includes("/auth/")) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.broadcast(newToken, body, attachment);
    }
    if (!res.ok) {
      const message = (data as { message?: string })?.message ?? res.statusText;
      throw new Error(message);
    }
    return data as { jobId: string };
  },

  /** Проверить статус фоновой рассылки. */
  async broadcastStatus(token: string, jobId: string): Promise<{
    id: string;
    status: "running" | "completed" | "error";
    progress: BroadcastProgress;
    result: BroadcastResult | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }> {
    return request(`/admin/broadcast/status/${encodeURIComponent(jobId)}`, { token });
  },

  /** История рассылок (пагинация). */
  async getBroadcastHistory(token: string, limit = 50, offset = 0): Promise<{ items: BroadcastHistoryItem[]; total: number }> {
    return request(`/admin/broadcast/history?limit=${limit}&offset=${offset}`, { token });
  },

  /** Подробности одной записи истории рассылки. */
  async getBroadcastHistoryItem(token: string, id: string): Promise<BroadcastHistoryItem> {
    return request(`/admin/broadcast/history/${encodeURIComponent(id)}`, { token });
  },

  /** Авто-рассылка: список правил */
  async getAutoBroadcastRules(token: string): Promise<AutoBroadcastRule[]> {
    return request("/admin/auto-broadcast/rules", { token });
  },

  /** Количество получателей для правила (ещё не получали) */
  async getAutoBroadcastEligibleCount(token: string, ruleId: string): Promise<{ count: number }> {
    return request(`/admin/auto-broadcast/rules/${ruleId}/eligible-count`, { token });
  },

  /** Создать правило авто-рассылки */
  async createAutoBroadcastRule(token: string, data: AutoBroadcastRulePayload): Promise<AutoBroadcastRule> {
    return request("/admin/auto-broadcast/rules", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Обновить правило */
  async updateAutoBroadcastRule(token: string, id: string, data: Partial<AutoBroadcastRulePayload>): Promise<AutoBroadcastRule> {
    return request(`/admin/auto-broadcast/rules/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  /** Удалить правило */
  async deleteAutoBroadcastRule(token: string, id: string): Promise<void> {
    return request(`/admin/auto-broadcast/rules/${id}`, { method: "DELETE", token });
  },

  /** Запустить все правила сейчас */
  async runAutoBroadcastAll(token: string): Promise<{ results: RunRuleResult[] }> {
    return request("/admin/auto-broadcast/run", { method: "POST", token });
  },

  /** Запустить одно правило сейчас */
  async runAutoBroadcastRule(token: string, ruleId: string): Promise<RunRuleResult> {
    return request(`/admin/auto-broadcast/run/${ruleId}`, { method: "POST", token });
  },

  /** Создать бэкап БД (скачать SQL) */
  async createBackup(token: string): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/create`, { headers });
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.createBackup(newToken);
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const d = JSON.parse(text);
        if (d.message) msg = d.message;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match ? match[1].trim() : `stealthnet-backup-${new Date().toISOString().slice(0, 10)}.sql`;
    return { blob, filename };
  },

  /** Список сохранённых на сервере бэкапов */
  async getBackupList(token: string): Promise<{ items: { path: string; filename: string; date: string; size: number }[] }> {
    return request("/admin/backup/list", { token });
  },

  /** Скачать бэкап с сервера по пути (path из списка) */
  async downloadBackup(token: string, path: string): Promise<{ blob: Blob; filename: string }> {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/download?path=${encodeURIComponent(path)}`, { headers });
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.downloadBackup(newToken, path);
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const d = JSON.parse(text);
        if (d.message) msg = d.message;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match ? match[1].trim() : path.split("/").pop() || "backup.sql";
    return { blob, filename };
  },

  /** Восстановить БД из бэкапа на сервере (path из списка) */
  async sendBackupToTelegram(token: string): Promise<{ ok: boolean; message: string }> {
    return request("/admin/backup/send-to-telegram", { method: "POST", token });
  },

  async restoreBackupFromServer(token: string, path: string): Promise<{ message: string }> {
    return request("/admin/backup/restore", {
      method: "POST",
      body: JSON.stringify({ confirm: "RESTORE", path }),
      token,
    });
  },

  /** Восстановить БД из загруженного SQL-файла */
  async restoreBackup(token: string, file: File): Promise<{ message: string }> {
    const form = new FormData();
    form.append("file", file);
    form.append("confirm", "RESTORE");
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/backup/restore`, { method: "POST", body: form, headers });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(res.statusText || "Request failed");
    }
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.restoreBackup(newToken, file);
    }
    if (!res.ok) {
      const message = (data as { message?: string })?.message ?? res.statusText;
      throw new Error(message);
    }
    return data as { message: string };
  },

  async getTariffCategories(token: string): Promise<{ items: TariffCategoryWithTariffs[] }> {
    return request("/admin/tariff-categories", { token });
  },

  async createTariffCategory(token: string, data: { name: string; sortOrder?: number; emojiKey?: string | null }): Promise<TariffCategoryRecord> {
    return request("/admin/tariff-categories", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateTariffCategory(token: string, id: string, data: { name?: string; sortOrder?: number; emojiKey?: string | null }): Promise<TariffCategoryRecord> {
    return request(`/admin/tariff-categories/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteTariffCategory(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tariff-categories/${id}`, { method: "DELETE", token });
  },

  // Tour Steps (admin)
  async getTourSteps(token: string): Promise<{ items: TourStepRecord[] }> {
    return request("/admin/tour-steps", { token });
  },

  async createTourStep(token: string, payload: CreateTourStepPayload): Promise<TourStepRecord> {
    return request("/admin/tour-steps", { method: "POST", body: JSON.stringify(payload), token });
  },

  async updateTourStep(token: string, id: string, payload: UpdateTourStepPayload): Promise<TourStepRecord> {
    return request(`/admin/tour-steps/${id}`, { method: "PATCH", body: JSON.stringify(payload), token });
  },

  async deleteTourStep(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tour-steps/${id}`, { method: "DELETE", token });
  },

  async reorderTourSteps(token: string, items: { id: string; sortOrder: number }[]): Promise<{ success: boolean }> {
    return request("/admin/tour-steps/reorder", { method: "PATCH", body: JSON.stringify({ items }), token });
  },

  async seedDefaultTourSteps(token: string): Promise<{ items: TourStepRecord[] }> {
    return request("/admin/tour-steps/seed-defaults", { method: "POST", token });
  },

  // Tour Mascots (admin)
  async getTourMascots(token: string): Promise<{ items: TourMascotRecord[] }> {
    return request("/admin/tour-mascots", { token });
  },

  async uploadTourMascot(token: string, name: string, image?: File): Promise<TourMascotRecord> {
    const form = new FormData();
    form.append("name", name);
    if (image) form.append("image", image, image.name);
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/tour-mascots`, { method: "POST", headers, body: form });
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { throw new Error(res.statusText || "Request failed"); }
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.uploadTourMascot(newToken, name, image);
    }
    if (!res.ok) { throw new Error((data as { message?: string })?.message ?? res.statusText); }
    return data as TourMascotRecord;
  },

  async deleteTourMascot(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tour-mascots/${id}`, { method: "DELETE", token });
  },

  async updateTourMascot(token: string, id: string, name: string): Promise<TourMascotRecord> {
    return request(`/admin/tour-mascots/${id}`, { method: "PATCH", token, body: JSON.stringify({ name }) });
  },

  async uploadMascotEmotion(token: string, mascotId: string, mood: string, image: File): Promise<MascotEmotionRecord> {
    const form = new FormData();
    form.append("mood", mood);
    form.append("image", image, image.name);
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/tour-mascots/${mascotId}/emotions`, { method: "POST", headers, body: form });
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { throw new Error(res.statusText || "Request failed"); }
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.uploadMascotEmotion(newToken, mascotId, mood, image);
    }
    if (!res.ok) { throw new Error((data as { message?: string })?.message ?? res.statusText); }
    return data as MascotEmotionRecord;
  },

  async deleteMascotEmotion(token: string, mascotId: string, emotionId: string): Promise<{ success: boolean }> {
    return request(`/admin/tour-mascots/${mascotId}/emotions/${emotionId}`, { method: "DELETE", token });
  },

  // Tour Step Video Upload (admin)
  async uploadTourStepVideo(token: string, stepId: string, video: File): Promise<TourStepRecord> {
    const form = new FormData();
    form.append("video", video, video.name);
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/tour-steps/${stepId}/video`, { method: "POST", headers, body: form });
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { throw new Error(res.statusText || "Request failed"); }
    if (res.status === 401 && token && tokenRefreshFn) {
      const newToken = await tokenRefreshFn();
      if (newToken) return api.uploadTourStepVideo(newToken, stepId, video);
    }
    if (!res.ok) { throw new Error((data as { message?: string })?.message ?? res.statusText); }
    return data as TourStepRecord;
  },

  async deleteTourStepVideo(token: string, stepId: string): Promise<TourStepRecord> {
    return request(`/admin/tour-steps/${stepId}/video`, { method: "DELETE", token });
  },

  async getTariffs(token: string, categoryId?: string): Promise<{ items: TariffRecord[] }> {
    const q = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    return request(`/admin/tariffs${q}`, { token });
  },

  async createTariff(token: string, data: CreateTariffPayload): Promise<TariffRecord> {
    return request("/admin/tariffs", { method: "POST", body: JSON.stringify(data), token });
  },

  async updateTariff(token: string, id: string, data: UpdateTariffPayload): Promise<TariffRecord> {
    return request(`/admin/tariffs/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deleteTariff(token: string, id: string): Promise<{ success: boolean }> {
    return request(`/admin/tariffs/${id}`, { method: "DELETE", token });
  },

  // ——— Кабинет клиента (клиентский API) ———
  async clientLogin(email: string, password: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async clientRegister(data: ClientRegisterPayload): Promise<ClientAuthResponse | ClientAuthRequires2FA | { message: string; requiresVerification: true }> {
    return request("/client/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async clientVerifyEmail(token: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  /** Авторизация по initData из Telegram Mini App (Web App) */
  async clientAuthByTelegramMiniapp(initData: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/telegram-miniapp", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });
  },
  async clientGoogleAuth(idToken: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
  },

  async clientAppleAuth(idToken: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/apple", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
  },

  /** Генерация одноразового токена для deep-link авторизации через Telegram */
  async clientTelegramLoginToken(): Promise<{ token: string; expiresAt: string }> {
    return request("/client/auth/telegram-login-token", { method: "POST" });
  },

  /** Проверка статуса deep-link авторизации (поллинг) */
  async clientTelegramLoginCheck(token: string): Promise<(ClientAuthResponse & { confirmed: true }) | (ClientAuthRequires2FA & { confirmed: true }) | { confirmed: false }> {
    return request(`/client/auth/telegram-login-check?token=${encodeURIComponent(token)}`);
  },

  /** Обмен временного токена (после пароля/Telegram) на полный токен по коду 2FA */
  async client2FALogin(tempToken: string, code: string): Promise<ClientAuthResponse> {
    return request("/client/auth/2fa-login", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    });
  },

  async clientMe(token: string): Promise<ClientProfile> {
    return request("/client/auth/me", { token });
  },

  async clientSubscription(token: string): Promise<{
    subscription: unknown;
    tariffDisplayName?: string | null;
    currentPricePerDay?: number | null;
    /** Сумма следующего автоплатежа (если автопродление включено). С учётом extras × коэффициент длительности × скидка. */
    autoRenewNextChargeAmount?: number | null;
    /** ISO-дата следующего списания (за N дней до истечения, N из config.autoRenewDaysBeforeExpiry). */
    autoRenewNextChargeAt?: string | null;
    autoRenewCurrency?: string | null;
    message?: string;
  }> {
    return request("/client/subscription", { token });
  },

  /** Подписка по Remnawave UUID (для secondary подписок на /cabinet/subscribe?uuid=xxx) */
  async clientSubscriptionByUuid(token: string, uuid: string): Promise<{ subscription: unknown; tariffDisplayName?: string | null; message?: string }> {
    return request(`/client/subscription/by-uuid/${encodeURIComponent(uuid)}`, { token });
  },

  /** Все подписки клиента (root + secondary) с Remnawave-данными */
  async clientAllSubscriptions(token: string): Promise<{
    items: Array<{
      type: "root" | "secondary";
      id: string;
      subscriptionIndex: number | null;
      subscription: unknown;
      tariffDisplayName: string;
      remnawaveUuid: string | null;
    }>;
  }> {
    return request("/client/subscription/all", { token });
  },

  async clientPayments(token: string): Promise<{ items: ClientPayment[] }> {
    return request("/client/payments", { token });
  },

  /** Список устройств (HWID) пользователя в Remna */
  async getClientDevices(token: string): Promise<{ total: number; devices: { hwid: string; platform?: string; deviceModel?: string; createdAt?: string }[] }> {
    return request("/client/devices", { token });
  },

  /** Удалить устройство по HWID */
  async deleteClientDevice(token: string, hwid: string): Promise<{ ok: boolean; message?: string }> {
    return request("/client/devices/delete", { method: "POST", body: JSON.stringify({ hwid }), token });
  },

  /** Запуск настройки 2FA: возвращает secret и otpauthUrl для QR */
  async client2FASetup(token: string): Promise<{ secret: string; otpauthUrl: string }> {
    return request("/client/2fa/setup", { method: "POST", token });
  },
  /** Подтвердить включение 2FA кодом из приложения */
  async client2FAConfirm(token: string, code: string): Promise<{ message: string }> {
    return request("/client/2fa/confirm", { method: "POST", body: JSON.stringify({ code }), token });
  },
  /** Отключить 2FA (требуется код из приложения) */
  async client2FADisable(token: string, code: string): Promise<{ message: string }> {
    return request("/client/2fa/disable", { method: "POST", body: JSON.stringify({ code }), token });
  },

  async clientCreatePlategaPayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      paymentMethod: number;
      description?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentUrl: string; orderId: string; paymentId: string; discountApplied?: boolean; finalAmount?: number }> {
    return request("/client/payments/platega", { method: "POST", body: JSON.stringify(data), token });
  },

  async getPublicTariffs(): Promise<{ items: PublicTariffCategory[] }> {
    return request("/public/tariffs");
  },

  /** Шаги тура (публичный, без авторизации) */
  async getClientTourSteps(): Promise<{ items: ClientTourStep[] }> {
    return request("/client/tour-steps");
  },

  /** Публичный список тарифов прокси по категориям */
  async getPublicProxyTariffs(): Promise<{
    items: { id: string; name: string; sortOrder: number; tariffs: { id: string; name: string; proxyCount: number; durationDays: number; trafficLimitBytes: string | null; connectionLimit: number | null; price: number; currency: string }[] }[];
  }> {
    return request("/public/proxy-tariffs");
  },

  /** Публичный список тарифов Sing-box по категориям */
  async getPublicSingboxTariffs(): Promise<{
    items: { id: string; name: string; sortOrder: number; tariffs: { id: string; name: string; slotCount: number; durationDays: number; trafficLimitBytes: string | null; price: number; currency: string }[] }[];
  }> {
    return request("/public/singbox-tariffs");
  },

  /** Активные прокси-слоты клиента */
  async getProxySlots(token: string): Promise<{
    slots: { id: string; login: string; password: string; host: string; socksPort: number; httpPort: number; expiresAt: string; trafficLimitBytes: string | null; trafficUsedBytes: string; connectionLimit: number | null }[];
  }> {
    return request("/client/proxy-slots", { token });
  },

  /** Активные Sing-box слоты клиента (с ссылкой подписки) */
  async getSingboxSlots(token: string): Promise<{
    slots: { id: string; subscriptionLink: string; expiresAt: string; trafficLimitBytes: string | null; trafficUsedBytes: string; protocol: string }[];
  }> {
    return request("/client/singbox-slots", { token });
  },

  async getPublicConfig(): Promise<PublicConfig> {
    return request("/public/config");
  },

  /** Конфиг страницы подписки (приложения по платформам) для /cabinet/subscribe */
  async getPublicSubscriptionPageConfig(): Promise<SubscriptionPageConfig | null> {
    return request("/public/subscription-page");
  },

  async clientPayByBalance(
    token: string,
    data: { tariffId?: string; tariffPriceOptionId?: string;
      deviceCount?: number; proxyTariffId?: string; singboxTariffId?: string; promoCode?: string }
  ): Promise<{ message: string; paymentId: string; newBalance: number }> {
    return request("/client/payments/balance", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Оплата опции (доп. трафик/устройства/сервер) с баланса */
  async clientPayOptionByBalance(
    token: string,
    data: { extraOption: { kind: "traffic" | "devices" | "servers"; productId: string } }
  ): Promise<{ message: string; paymentId: string; newBalance: number }> {
    return request("/client/payments/balance/option", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Оплата гибкого тарифа (собери сам) с баланса */
  async customBuildPayBalance(
    token: string,
    data: { days: number; devices: number; trafficGb?: number; promoCode?: string }
  ): Promise<{ message: string; paymentId: string; newBalance: number }> {
    return request("/client/custom-build/pay-balance", { method: "POST", body: JSON.stringify(data), token });
  },

  async getYoomoneyAuthUrl(token: string): Promise<{ url: string }> {
    return request("/client/yoomoney/auth-url", { token });
  },
  /** Форма перевода ЮMoney (оплата картой). Пополнение баланса, тариф, прокси, доступы, опция или гибкий тариф. */
  async yoomoneyCreateFormPayment(
    token: string,
    data: {
      amount?: number;
      paymentType: "PC" | "AC";
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; paymentUrl: string; form: { receiver: string; sum: number; label: string; paymentType: string; successURL: string }; successURL: string }> {
    return request("/client/yoomoney/create-form-payment", { method: "POST", body: JSON.stringify(data), token });
  },
  async yoomoneyFormPaymentParams(token: string, paymentId: string): Promise<{ receiver: string; sum: number; label: string; paymentType: string; successURL: string }> {
    return request(`/client/yoomoney/form-payment/${encodeURIComponent(paymentId)}`, { token });
  },
  async yoomoneyRequestTopup(token: string, amount: number): Promise<{ paymentId: string; request_id: string; money_source: Record<string, unknown>; contract_amount?: number }> {
    return request("/client/yoomoney/request-topup", { method: "POST", body: JSON.stringify({ amount }), token });
  },
  async yoomoneyProcessPayment(
    token: string,
    data: { paymentId: string; request_id: string; money_source?: string; csc?: string }
  ): Promise<{ message: string; newBalance: number }> {
    return request("/client/yoomoney/process-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** ЮKassa API: создание платежа (тариф, прокси, гибкий тариф или пополнение), возвращает confirmationUrl для редиректа. */
  async yookassaCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; confirmationUrl: string; yookassaPaymentId: string }> {
    return request("/client/yookassa/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** ЮKassa: отвязка сохранённого способа оплаты */
  async yookassaUnlinkPaymentMethod(token: string): Promise<{ client: ClientProfile }> {
    return request("/client/yookassa/unlink-payment-method", { method: "POST", token });
  },

  /** Crypto Pay (Crypto Bot) — создание инвойса, возвращает ссылку на оплату */
  async cryptopayCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; payUrl: string; miniAppPayUrl?: string; webAppPayUrl?: string }> {
    return request("/client/cryptopay/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Heleket — создание инвойса (крипто), возвращает ссылку на оплату */
  async heleketCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; payUrl: string }> {
    return request("/client/heleket/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** LAVA Business — создание счёта (RUB: СБП / Карты / СберPay), возвращает ссылку на оплату */
  async lavaCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; payUrl: string }> {
    return request("/client/lava/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Lava.top — создание invoice через product/offer модель (RUB/USD/EUR) */
  async lavatopCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      email?: string;
      offerId?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; payUrl: string }> {
    return request("/client/lavatop/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Overpay — создание платёжной формы (Карты/СБП), возвращает ссылку на оплату */
  async overpayCreatePayment(
    token: string,
    data: {
      amount?: number;
      currency?: string;
      tariffId?: string;
      tariffPriceOptionId?: string;
      deviceCount?: number;
      proxyTariffId?: string;
      singboxTariffId?: string;
      promoCode?: string;
      extraOption?: { kind: "traffic" | "devices" | "servers"; productId: string };
      customBuild?: { days: number; devices: number; trafficGb?: number };
    }
  ): Promise<{ paymentId: string; payUrl: string }> {
    return request("/client/overpay/create-payment", { method: "POST", body: JSON.stringify(data), token });
  },

  async clientActivateTrial(token: string): Promise<{ message: string; client: ClientProfile | null }> {
    return request("/client/trial", { method: "POST", token });
  },

  async clientUpdateProfile(token: string, data: { preferredLang?: string; preferredCurrency?: string }): Promise<ClientProfile> {
    return request("/client/profile", { method: "PATCH", body: JSON.stringify(data), token });
  },

  async clientUpdateAutoRenew(token: string, data: { enabled?: boolean; tariffId?: string | null; promoCode?: string | null }): Promise<ClientProfile> {
    return request("/client/auto-renew", { method: "PATCH", body: JSON.stringify(data), token });
  },

  async clientChangePassword(token: string, data: { currentPassword: string; newPassword: string }): Promise<{ message: string }> {
    return request("/client/change-password", { method: "POST", body: JSON.stringify(data), token });
  },

  async clientSetPassword(token: string, data: { newPassword: string }): Promise<{ message: string }> {
    return request("/client/set-password", { method: "POST", body: JSON.stringify(data), token });
  },

  async clientCompleteOnboarding(token: string): Promise<{ message: string }> {
    return request("/client/complete-onboarding", { method: "POST", token });
  },

  /** Запросить код для привязки Telegram через бота (без авторизации по токену не нужен) */
  async clientLinkTelegramRequest(token: string): Promise<{ code: string; expiresAt: string; botUsername: string | null }> {
    return request("/client/link-telegram-request", { method: "POST", token });
  },

  /** Привязать Telegram из Mini App (initData от Telegram WebApp) */
  async clientLinkTelegram(token: string, data: { initData: string }): Promise<{ client: ClientProfile }> {
    return request("/client/link-telegram", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Запросить привязку email (отправить письмо со ссылкой) */
  async clientLinkEmailRequest(token: string, data: { email: string }): Promise<{ message: string }> {
    return request("/client/link-email-request", { method: "POST", body: JSON.stringify(data), token });
  },

  /** Подтвердить привязку email по токену из письма (без Bearer; возвращает token и client) */
  async clientVerifyLinkEmail(verificationToken: string): Promise<ClientAuthResponse | ClientAuthRequires2FA> {
    return request("/client/auth/verify-link-email", { method: "POST", body: JSON.stringify({ token: verificationToken }) });
  },

  async getClientReferralStats(token: string): Promise<ClientReferralStats> {
    return request("/client/referral-stats", { token });
  },

  // ─── Gift Subscriptions ─────────────────────────────────────────────────────

  /** Buy additional subscription (balance payment). Optional priceOptionId + extraDevices. */
  async giftBuySubscription(
    token: string,
    payload: { tariffId: string; tariffPriceOptionId?: string; extraDevices?: number },
  ): Promise<{ message: string; secondarySubscriptionId: string; subscriptionIndex: number }> {
    return request("/client/gift/buy", { token, method: "POST", body: JSON.stringify(payload) });
  },

  /** List secondary subscriptions (without GIFT_RESERVED) */
  async giftListSubscriptions(token: string): Promise<{ subscriptions: Array<{ id: string; ownerId: string; remnawaveUuid: string | null; subscriptionIndex: number; tariffId: string | null; giftStatus: string | null; giftedToClientId: string | null; createdAt: string; updatedAt: string }> }> {
    return request("/client/gift/subscriptions", { token });
  },

  /** List ALL secondary subscriptions including GIFT_RESERVED (for gift management) */
  async giftListAllSubscriptions(token: string): Promise<{ subscriptions: Array<{ id: string; ownerId: string; remnawaveUuid: string | null; subscriptionIndex: number; tariffId: string | null; giftStatus: string | null; giftedToClientId: string | null; createdAt: string; updatedAt: string }> }> {
    return request("/client/gift/subscriptions/all", { token });
  },

  /** Activate subscription for self (remove GIFT_RESERVED) */
  async giftActivateForSelf(token: string, subscriptionId: string): Promise<{ message: string; subscriptionId: string }> {
    return request("/client/gift/activate-self", { token, method: "POST", body: JSON.stringify({ subscriptionId }) });
  },

  /** Delete a secondary subscription */
  async giftDeleteSubscription(token: string, subscriptionId: string): Promise<{ message: string }> {
    return request(`/client/gift/subscription/${encodeURIComponent(subscriptionId)}`, { token, method: "DELETE" });
  },

  /** Create gift code for a subscription */
  async giftCreateCode(token: string, secondarySubscriptionId: string, giftMessage?: string): Promise<{ message: string; code: string; expiresAt: string }> {
    return request("/client/gift/create-code", { token, method: "POST", body: JSON.stringify({ secondarySubscriptionId, giftMessage }) });
  },

  /** Redeem a gift code */
  async giftRedeemCode(token: string, code: string): Promise<{ message: string; secondarySubscriptionId: string; subscriptionIndex: number }> {
    return request("/client/gift/redeem", { token, method: "POST", body: JSON.stringify({ code }) });
  },

  /** Cancel a gift code */
  async giftCancelCode(token: string, codeOrId: string): Promise<{ message: string }> {
    return request(`/client/gift/cancel/${encodeURIComponent(codeOrId)}`, { token, method: "DELETE" });
  },

  /** List gift codes created by the client */
  async giftListCodes(token: string): Promise<{ codes: Array<{ id: string; code: string; status: string; expiresAt: string; createdAt: string; redeemedAt: string | null; giftMessage: string | null; secondarySubscriptionId: string }> }> {
    return request("/client/gift/codes", { token });
  },

  /** Get gift history with pagination */
  async giftGetHistory(token: string, page: number = 1, limit: number = 20): Promise<{ items: Array<{ id: string; eventType: string; metadata: unknown; createdAt: string; secondarySubscriptionId: string | null }>; total: number; page: number; limit: number }> {
    return request(`/client/gift/history?page=${page}&limit=${limit}`, { token });
  },

  /** Get Remnawave subscription URL for a secondary subscription */
  async giftGetSubscriptionUrl(token: string, subscriptionId: string): Promise<{ uuid: string }> {
    return request(`/client/gift/subscription-url/${encodeURIComponent(subscriptionId)}`, { token });
  },

  /** Get public info about a gift code (no auth required) */
  async getPublicGiftCodeInfo(code: string): Promise<PublicGiftCodeInfo> {
    return request(`/gift/public/${encodeURIComponent(code)}`);
  },

  /** Список тикетов клиента (доступно при включённой тикет-системе) */
  async getTickets(token: string): Promise<{ items: { id: string; subject: string; status: string; createdAt: string; updatedAt: string }[] }> {
    return request("/client/tickets", { token });
  },
  /** Количество непрочитанных сообщений от поддержки */
  async getUnreadTicketsCount(token: string): Promise<{ count: number }> {
    return request("/client/tickets/unread-count", { token });
  },
  /** Один тикет с сообщениями */
  async getTicket(token: string, id: string): Promise<{
    id: string;
    subject: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messages: TicketMessageDto[];
  }> {
    return request(`/client/tickets/${id}`, { token });
  },
  /**
   * Создать тикет (тема + первое сообщение, опционально — до 5 фото).
   * При наличии файлов отправляем multipart/form-data.
   */
  async createTicket(
    token: string,
    data: { subject: string; message: string; files?: File[] }
  ): Promise<{
    id: string;
    subject: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messages: TicketMessageDto[];
  }> {
    const files = data.files ?? [];
    if (files.length > 0) {
      const fd = new FormData();
      fd.append("subject", data.subject);
      fd.append("message", data.message ?? "");
      for (const f of files) fd.append("files", f);
      return request("/client/tickets", { method: "POST", body: fd, token });
    }
    return request("/client/tickets", {
      method: "POST",
      body: JSON.stringify({ subject: data.subject, message: data.message }),
      token,
    });
  },
  /** Ответ в тикет. Можно приложить до 5 фото. */
  async replyTicket(
    token: string,
    ticketId: string,
    data: { content: string; files?: File[] }
  ): Promise<TicketMessageDto> {
    const files = data.files ?? [];
    if (files.length > 0) {
      const fd = new FormData();
      fd.append("content", data.content ?? "");
      for (const f of files) fd.append("files", f);
      return request(`/client/tickets/${ticketId}/messages`, { method: "POST", body: fd, token });
    }
    return request(`/client/tickets/${ticketId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: data.content }),
      token,
    });
  },

  /** AI Чат (Groq) */
  async chatAi(
    token: string,
    data: { messages: { role: "user" | "assistant" | "system"; content: string }[] }
  ): Promise<{ reply: string }> {
    return request("/client/ai/chat", { method: "POST", body: JSON.stringify(data), token });
  },

  // ——— Промо-группы (админ) ———
  async getPromoGroups(token: string): Promise<PromoGroup[]> {
    return request("/admin/promo-groups", { token });
  },

  async getPromoGroup(token: string, id: string): Promise<PromoGroupDetail> {
    return request(`/admin/promo-groups/${id}`, { token });
  },

  async createPromoGroup(token: string, data: CreatePromoGroupPayload): Promise<PromoGroup> {
    return request("/admin/promo-groups", { method: "POST", body: JSON.stringify(data), token });
  },

  async updatePromoGroup(token: string, id: string, data: UpdatePromoGroupPayload): Promise<PromoGroup> {
    return request(`/admin/promo-groups/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deletePromoGroup(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/promo-groups/${id}`, { method: "DELETE", token });
  },

  // ——— Промокоды (админ) ———
  async getPromoCodes(token: string): Promise<PromoCodeRecord[]> {
    return request("/admin/promo-codes", { token });
  },

  async getPromoCode(token: string, id: string): Promise<PromoCodeDetail> {
    return request(`/admin/promo-codes/${id}`, { token });
  },

  async createPromoCode(token: string, data: CreatePromoCodePayload): Promise<PromoCodeRecord> {
    return request("/admin/promo-codes", { method: "POST", body: JSON.stringify(data), token });
  },

  async updatePromoCode(token: string, id: string, data: UpdatePromoCodePayload): Promise<PromoCodeRecord> {
    return request(`/admin/promo-codes/${id}`, { method: "PATCH", body: JSON.stringify(data), token });
  },

  async deletePromoCode(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/promo-codes/${id}`, { method: "DELETE", token });
  },

  // ——— Промокоды (клиент) ———
  async clientCheckPromoCode(token: string, code: string): Promise<{ type: string; discountPercent?: number | null; discountFixed?: number | null; durationDays?: number | null; name: string }> {
    return request("/client/promo-code/check", { method: "POST", body: JSON.stringify({ code }), token });
  },

  async clientActivatePromoCode(token: string, code: string): Promise<{ message: string }> {
    return request("/client/promo-code/activate", { method: "POST", body: JSON.stringify({ code }), token });
  },

  // ——— Geo Map ———
  async getGeoMapData(token: string): Promise<GeoMapResponse> {
    return request("/admin/geo-map/data", { token });
  },
  async refreshGeoMap(token: string): Promise<GeoMapResponse> {
    return request("/admin/geo-map/refresh", { method: "POST", token });
  },

  async getLanguages(token: string): Promise<{ ok: boolean; languages: LanguageInfo[]; totalKeys: number }> {
    return request("/admin/languages", { token });
  },
  async getLanguageKeys(token: string): Promise<{ ok: boolean; keys: Record<string, string> }> {
    return request("/admin/languages/keys", { token });
  },
  async getLanguagePack(token: string, code: string): Promise<{ ok: boolean; code: string; data: Record<string, unknown> }> {
    return request(`/admin/languages/${code}`, { token });
  },
  async saveLanguagePack(token: string, code: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request(`/admin/languages/${code}`, { method: "PUT", body: JSON.stringify(data), token });
  },
  async deleteLanguage(token: string, code: string): Promise<{ ok: boolean }> {
    return request(`/admin/languages/${code}`, { method: "DELETE", token });
  },
  async importLanguagePack(token: string, code: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request(`/admin/languages/${code}/import`, { method: "POST", body: JSON.stringify(data), token });
  },
  async exportLanguagePack(token: string, code: string): Promise<string> {
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}/admin/languages/${code}/export`, { headers });
    return res.text();
  },

  // ═══════════ Gramads: "Продвижение VPN" (прокси к https://api.gramads.net) ═══════════
  /** Статус подключения (валиден ли сохранённый API-ключ) */
  async gramadsStatus(token: string): Promise<{ configured: boolean; valid: boolean; balance?: GramadsBalanceDto; error?: string }> {
    return request("/admin/gramads/status", { token });
  },
  /** Универсальный вызов: через прокси. */
  async gramadsCall<T = unknown>(token: string, method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const qs = query
      ? "?" + Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
      : "";
    const full = `/admin/gramads/proxy${path.startsWith("/") ? path : "/" + path}${qs}`;
    const init: RequestInit = { method, token } as RequestInit & { token?: string };
    const options: RequestInit & { token?: string } = { ...init, token };
    if (body !== undefined && method !== "GET") {
      (options as RequestInit).body = JSON.stringify(body);
    }
    return request<T>(full, options);
  },
  async gramadsGetBalance(token: string) { return api.gramadsCall<GramadsBalanceDto>(token, "GET", "/Wallet/GetBalance"); },
  async gramadsGetIncomesAndExpenses(token: string, getDaysCount = 30) { return api.gramadsCall<GramadsIncomesExpensesDto>(token, "GET", "/Wallet/GetIncomesAndExpenses", undefined, { getDaysCount }); },
  async gramadsGetMyTopups(token: string, count = 20, pageIndex = 0) { return api.gramadsCall<GramadsDepositPageDto>(token, "GET", "/Wallet/GetMyTopups", undefined, { count, pageIndex }); },
  async gramadsGetMyPosts(token: string, args: { count?: number; pageIndex?: number; isArchived?: boolean; activeOnly?: boolean; tag?: string } = {}) {
    return api.gramadsCall<GramadsPostPageDto>(token, "GET", "/PostManagement/GetMyPosts", undefined, args);
  },
  async gramadsGetMyPost(token: string, postId: number) { return api.gramadsCall<GramadsPostDto>(token, "GET", "/PostManagement/GetMyPost", undefined, { postId }); },
  async gramadsGetStatistics(token: string, postId: number, getDaysCount = 30) { return api.gramadsCall<GramadsChartDto[] | unknown>(token, "GET", "/PostManagement/GetStatistics", undefined, { postId, getDaysCount }); },
  async gramadsGetTags(token: string) { return api.gramadsCall<GramadsTagDto[]>(token, "GET", "/PostManagement/GetTags"); },
  async gramadsGetShows(token: string, postId: number, count = 20, pageIndex = 0) { return api.gramadsCall<GramadsShowPageDto>(token, "GET", "/PostManagement/GetShows", undefined, { postId, count, pageIndex }); },
  async gramadsGetBotsShowedMyPost(token: string, postId: number) { return api.gramadsCall<GramadsBotShowedMyPostDto[]>(token, "GET", "/PostManagement/GetBotsShowedMyPost", undefined, { postId }); },
  async gramadsAddPost(token: string, post: Partial<GramadsPostDto>) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/AddPost", post); },
  async gramadsTestPost(token: string, post: Partial<GramadsPostDto>) { return api.gramadsCall<number>(token, "POST", "/PostManagement/TestPost", post); },
  /**
   * Все Switch*-эндпоинты Gramads ожидают в теле полный PostDto (см. Swagger).
   * Если прислать только `{id}`, сервер биндит остальные поля в дефолты и ничего не меняет —
   * поэтому нужно передавать текущее состояние поста, а переключаемый флаг — в нужном значении.
   */
  async gramadsSwitchEnabled(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchEnabled", post); },
  async gramadsSwitchIsFavourite(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchIsFavourite", post); },
  async gramadsSwitchPremiumOnlyEnabled(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchPremiumOnlyEnabled", post); },
  async gramadsSwitchGroupsEnabled(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchGroupsEnabled", post); },
  async gramadsSwitchFavouriteBotsOnlyEnabled(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchFavouriteBotsOnlyEnabled", post); },
  async gramadsSwitchGAlityEnabled(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SwitchGAlityEnabled", post); },
  async gramadsSetLimit(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetLimit", post); },
  async gramadsSetSchedule(token: string, schedule: { postId: number; utcScheduleFrom?: string | null; utcScheduleTill?: string | null }) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetSchedule", schedule); },
  async gramadsDeleteSchedule(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/DeleteSchedule", post); },
  async gramadsSetExtraRate(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetExtraRate", post); },
  async gramadsSetIpressionPerHours(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetIpressionPerHours", post); },
  async gramadsChangeStrategy(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/ChangeStrategy", post); },
  async gramadsSetExcludedCategories(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetExcludedCategories", post); },
  async gramadsSetExcludedLanguages(token: string, post: GramadsPostDto) { return api.gramadsCall<GramadsPostDto>(token, "POST", "/PostManagement/SetExcludedLanguages", post); },

  // ─── Маркетплейс между админами ───────────────────────────────────────────
  async marketplaceStatus(token: string): Promise<MarketplaceStatusDto> {
    return request("/admin/marketplace/status", { token });
  },
  async marketplaceUpdateSettings(token: string, body: MarketplaceSettingsUpdate): Promise<{ ok: boolean }> {
    return request("/admin/marketplace/settings", { method: "PATCH", body: JSON.stringify(body), token });
  },
  async marketplaceConnect(token: string): Promise<{ ok: boolean; status: string; message?: string; installationId?: string | null }> {
    return request("/admin/marketplace/connect", { method: "POST", token });
  },
  async marketplaceCategories(token: string): Promise<{ items: MarketplaceCategoryDto[] }> {
    return request("/admin/marketplace/categories", { token });
  },
  async marketplaceListings(
    token: string,
    params: MarketplaceBrowseParams = {}
  ): Promise<{ items: MarketplaceListingDto[]; total: number; page: number; limit: number }> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
    const qs = q.toString();
    return request(`/admin/marketplace/listings${qs ? `?${qs}` : ""}`, { token });
  },
  async marketplaceListing(token: string, id: string): Promise<MarketplaceListingDto> {
    return request(`/admin/marketplace/listings/${encodeURIComponent(id)}`, { token });
  },
  async marketplaceTrackView(token: string, id: string): Promise<{ ok: boolean; deduped?: boolean }> {
    return request(`/admin/marketplace/listings/${encodeURIComponent(id)}/view`, { method: "POST", token });
  },
  async marketplaceMyListings(token: string): Promise<{ items: MarketplaceListingDto[] }> {
    return request("/admin/marketplace/my/listings", { token });
  },
  async marketplaceCreateListing(token: string, body: MarketplaceListingPayload): Promise<MarketplaceListingDto> {
    return request("/admin/marketplace/my/listings", { method: "POST", body: JSON.stringify(body), token });
  },
  async marketplaceUpdateListing(token: string, id: string, body: Partial<MarketplaceListingPayload> & { status?: "active" | "archived" }): Promise<MarketplaceListingDto> {
    return request(`/admin/marketplace/my/listings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  async marketplaceDeleteListing(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/marketplace/my/listings/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  async marketplaceReport(token: string, body: { listingId: string; reason: MarketplaceReportReason; comment?: string }): Promise<{ ok: boolean; reports: number; autoHidden: boolean }> {
    return request("/admin/marketplace/reports", { method: "POST", body: JSON.stringify(body), token });
  },

  // Хаб-админ (доступно только если status.role === "hub")
  async marketplaceHubInstallations(token: string, q?: string): Promise<{ items: MarketplaceInstallationDto[] }> {
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q)}` : "";
    return request(`/admin/marketplace/hub/installations${qs}`, { token });
  },
  async marketplaceHubBanInstallation(token: string, id: string, isBanned: boolean, reason?: string): Promise<{ id: string; isBanned: boolean; banReason: string | null }> {
    return request(`/admin/marketplace/hub/installations/${encodeURIComponent(id)}/ban`, {
      method: "PATCH",
      body: JSON.stringify({ isBanned, reason }),
      token,
    });
  },
  async marketplaceHubDeleteInstallation(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/marketplace/hub/installations/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  async marketplaceHubReports(token: string, status: "open" | "resolved" | "dismissed" = "open"): Promise<{ items: MarketplaceReportDto[] }> {
    return request(`/admin/marketplace/hub/reports?status=${status}`, { token });
  },
  async marketplaceHubResolveReport(token: string, id: string, body: { status: "resolved" | "dismissed"; unhideListing?: boolean }): Promise<{ ok: boolean }> {
    return request(`/admin/marketplace/hub/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
  },
  async marketplaceHubForceDeleteListing(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/marketplace/hub/listings/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  async marketplaceHubCategories(token: string): Promise<{ items: MarketplaceCategoryDto[] }> {
    return request("/admin/marketplace/hub/categories", { token });
  },
  async marketplaceHubCreateCategory(token: string, body: MarketplaceCategoryPayload): Promise<MarketplaceCategoryDto> {
    return request("/admin/marketplace/hub/categories", { method: "POST", body: JSON.stringify(body), token });
  },
  async marketplaceHubUpdateCategory(token: string, id: string, body: Partial<MarketplaceCategoryPayload>): Promise<MarketplaceCategoryDto> {
    return request(`/admin/marketplace/hub/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body), token });
  },
  async marketplaceHubDeleteCategory(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/admin/marketplace/hub/categories/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
};

export type MarketplaceCurrency = "USD" | "RUB" | "EUR" | "USDT";
export type MarketplacePriceUnit = "one_time" | "per_month" | "per_gb" | "per_device";
export type MarketplaceListingStatus = "active" | "archived" | "auto_hidden";
export type MarketplaceReportReason = "spam" | "scam" | "wrong_category" | "offensive" | "other";

export interface MarketplaceStatusDto {
  enabled: boolean;
  role: "client" | "hub";
  hubUrl: string;
  installationId: string | null;
  apiKeyConnected: boolean;
  contactUsername: string | null;
  displayName: string | null;
  logoUrl: string | null;
  description: string | null;
  lastConnectAt: string | null;
  lastConnectStatus: string | null;
}

export interface MarketplaceSettingsUpdate {
  enabled?: boolean;
  role?: "client" | "hub";
  contactUsername?: string | null;
  displayName?: string | null;
  logoUrl?: string | null;
  description?: string | null;
}

export interface MarketplaceCategoryDto {
  id: string;
  slug: string;
  labelRu: string;
  labelEn: string;
  icon?: string | null;
  sortOrder: number;
  isEnabled: boolean;
}

export interface MarketplaceCategoryPayload {
  slug: string;
  labelRu: string;
  labelEn: string;
  icon?: string | null;
  sortOrder?: number;
  isEnabled?: boolean;
}

export interface MarketplaceSellerDto {
  installationId: string;
  displayName: string | null;
  contactUsername: string;
  contactUrl: string;
  logoUrl: string | null;
  memberSince: string;
}

export interface MarketplaceListingDto {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: MarketplaceCurrency;
  priceUnit: MarketplacePriceUnit;
  country: string | null;
  tags: string[];
  coverImageUrl: string | null;
  gallery: string[];
  status: MarketplaceListingStatus;
  views: number;
  createdAt: string;
  updatedAt: string;
  category: { id: string; slug: string; labelRu: string; labelEn: string; icon?: string | null };
  seller: MarketplaceSellerDto;
}

export interface MarketplaceListingPayload {
  categoryId: string;
  title: string;
  description: string;
  priceCents: number;
  currency: MarketplaceCurrency;
  priceUnit: MarketplacePriceUnit;
  country?: string | null;
  tags: string[];
  coverImageUrl?: string | null;
  gallery: string[];
}

export interface MarketplaceBrowseParams {
  category?: string;
  country?: string;
  currency?: MarketplaceCurrency;
  q?: string;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  limit?: number;
  sort?: "new" | "cheap" | "expensive";
  installationId?: string;
}

export interface MarketplaceInstallationDto {
  id: string;
  domain: string;
  displayName: string | null;
  contactUsername: string;
  contactTelegramId: string | null;
  logoUrl: string | null;
  description: string | null;
  isBanned: boolean;
  banReason: string | null;
  totalListings: number;
  apiKeyPrefix: string;
  lastSeenAt: string;
  lastIp: string | null;
  createdAt: string;
}

export interface MarketplaceReportDto {
  id: string;
  listingId: string;
  reason: MarketplaceReportReason;
  comment: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  listing: {
    id: string;
    title: string;
    status: MarketplaceListingStatus;
    reportsCount: number;
    category: { slug: string; labelRu: string; labelEn: string };
    installation: {
      id: string;
      domain: string;
      displayName: string | null;
      contactUsername: string;
      isBanned: boolean;
    };
  };
  reporter: {
    id: string;
    domain: string;
    displayName: string | null;
  };
}

export interface ClientReferralStats {
  referralCode: string | null;
  referralPercent: number;
  referralPercentLevel2: number;
  referralPercentLevel3: number;
  referralCount: number;
  totalEarnings: number;
}

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface SyncToRemnaResult {
  ok: boolean;
  updated: number;
  unlinked: number;
  errors: string[];
}

export interface SyncCreateRemnaForMissingResult {
  ok: boolean;
  created: number;
  linked: number;
  errors: string[];
}

export interface BroadcastResult {
  ok: boolean;
  sentTelegram: number;
  sentEmail: number;
  failedTelegram: number;
  failedEmail: number;
  errors: string[];
}

export interface BroadcastProgress {
  totalTelegram: number;
  totalEmail: number;
  sentTelegram: number;
  sentEmail: number;
  failedTelegram: number;
  failedEmail: number;
  currentChannel?: "telegram" | "email";
}

export interface BroadcastHistoryItem {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "error";
  channel: "telegram" | "email" | "both";
  subject: string;
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  attachmentName: string | null;
  totalTelegram: number;
  sentTelegram: number;
  failedTelegram: number;
  totalEmail: number;
  sentEmail: number;
  failedEmail: number;
  errors: string[] | null;
  error: string | null;
  startedByAdmin: string | null;
}

export type AutoBroadcastTriggerType =
  | "after_registration"
  | "inactivity"
  | "no_payment"
  | "trial_not_connected"
  | "trial_used_never_paid"
  | "no_traffic"
  | "subscription_expired"
  | "subscription_ending_soon";

export interface AutoBroadcastRule {
  id: string;
  name: string;
  triggerType: AutoBroadcastTriggerType;
  delayDays: number;
  channel: "telegram" | "email" | "both";
  subject: string | null;
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  enabled: boolean;
  sentCount?: number;
}

export interface AutoBroadcastRulePayload {
  name: string;
  triggerType: AutoBroadcastTriggerType;
  delayDays: number;
  channel: "telegram" | "email" | "both";
  subject?: string | null;
  message: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  enabled?: boolean;
}

export interface RunRuleResult {
  ruleId: string;
  sent: number;
  skipped: number;
  errors: string[];
}

export type UpdateSettingsPayload = {
  allowUserThemeChange?: boolean;
  activeLanguages?: string;
  activeCurrencies?: string;
  defaultLanguage?: string;
  defaultCurrency?: string;
  defaultReferralPercent?: number;
  referralPercentLevel2?: number;
  referralPercentLevel3?: number;
  trialDays?: number;
  trialSquadUuid?: string | null;
  trialDeviceLimit?: number | null;
  trialTrafficLimitBytes?: number | null;
  serviceName?: string;
  logo?: string | null;
  logoBot?: string | null;
  favicon?: string | null;
  cabinetDesign?: "classic" | "stealth";
  remnaClientUrl?: string | null;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  publicAppUrl?: string | null;
  telegramBotToken?: string | null;
  telegramBotUsername?: string | null;
  botAdminTelegramIds?: string[] | null;
  notificationTelegramGroupId?: string | null;
  notificationTopicNewClients?: string | null;
  notificationTopicPayments?: string | null;
  notificationTopicTickets?: string | null;
  notificationTopicBackups?: string | null;
  autoBackupEnabled?: boolean;
  autoBackupCron?: string | null;
  plategaMerchantId?: string | null;
  plategaSecret?: string | null;
  plategaMethods?: string | null;
  plategaWebhookSecret?: string | null;
  yoomoneyClientId?: string | null;
  yoomoneyClientSecret?: string | null;
  yoomoneyReceiverWallet?: string | null;
  yoomoneyNotificationSecret?: string | null;
  yookassaShopId?: string | null;
  yookassaSecretKey?: string | null;
  yookassaWebhookBasicUser?: string | null;
  yookassaWebhookBasicPassword?: string | null;
  cryptopayApiToken?: string | null;
  cryptopayTestnet?: boolean;
  heleketMerchantId?: string | null;
  heleketApiKey?: string | null;
  lavaShopId?: string | null;
  lavaSecretKey?: string | null;
  lavaAdditionalKey?: string | null;
  lavatopApiKey?: string | null;
  lavatopDefaultOfferId?: string | null;
  botWelcomeEnabled?: boolean;
  botWelcomeText?: string | null;
  botWelcomeImage?: string | null;
  botWelcomeShowOnce?: boolean;
  cabinetDesignApplyInBrowser?: boolean;
  overpayApiUrl?: string | null;
  overpayProjectId?: string | null;
  overpayLogin?: string | null;
  overpayPassword?: string | null;
  paymentProvidersConfig?: string | null;
  groqApiKey?: string | null;
  groqModel?: string | null;
  groqFallback1?: string | null;
  groqFallback2?: string | null;
  groqFallback3?: string | null;
  aiSystemPrompt?: string | null;
  botButtons?: string | null;
  botButtonsPerRow?: 1 | 2;
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }> | string | null;
  botBackLabel?: string | null;
  botMenuTexts?: string | null;
  botMenuLineVisibility?: string | null;
  botInnerButtonStyles?: string | null;
  botTariffsText?: string | null;
  botTariffsFields?: string | null;
  botPaymentText?: string | null;
  subscriptionPageConfig?: string | null;
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  ticketsEnabled?: boolean;
  themeAccent?: string;
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
  blacklistEnabled?: boolean;
  botAutoDeleteUnknownMessages?: boolean;
  botInfoBlock?: string | null;
  sellOptionsEnabled?: boolean;
  sellOptionsTrafficEnabled?: boolean;
  sellOptionsTrafficProducts?: string | null;
  sellOptionsDevicesEnabled?: boolean;
  sellOptionsDevicesProducts?: string | null;
  sellOptionsServersEnabled?: boolean;
  sellOptionsServersProducts?: string | null;
  googleAnalyticsId?: string | null;
  yandexMetrikaId?: string | null;
  autoBroadcastCron?: string | null;
  adminFrontNotificationsEnabled?: boolean;
  skipEmailVerification?: boolean;
  useRemnaSubscriptionPage?: boolean;
  aiChatEnabled?: boolean;
  customBuildEnabled?: boolean;
  customBuildPricePerDay?: number;
  customBuildPricePerDevice?: number;
  customBuildTrafficMode?: "unlimited" | "per_gb";
  customBuildPricePerGb?: number;
  customBuildSquadUuid?: string | null;
  customBuildCurrency?: string;
  customBuildMaxDays?: number;
  customBuildMaxDevices?: number;
  defaultAutoRenewEnabled?: boolean;
  autoRenewDaysBeforeExpiry?: number;
  autoRenewNotifyDaysBefore?: number;
  autoRenewGracePeriodDays?: number;
  autoRenewMaxRetries?: number;
  yookassaRecurringEnabled?: boolean;
  googleLoginEnabled?: boolean;
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  appleLoginEnabled?: boolean;
  appleClientId?: string | null;
  appleTeamId?: string | null;
  appleKeyId?: string | null;
  applePrivateKey?: string | null;
  landingEnabled?: boolean;
  landingHeroTitle?: string | null;
  landingHeroSubtitle?: string | null;
  landingHeroCtaText?: string | null;
  landingShowTariffs?: boolean;
  landingContacts?: string | null;
  landingOfferLink?: string | null;
  landingPrivacyLink?: string | null;
  landingFooterText?: string | null;
  landingHeroBadge?: string | null;
  landingHeroHint?: string | null;
  landingFeature1Label?: string | null;
  landingFeature1Sub?: string | null;
  landingFeature2Label?: string | null;
  landingFeature2Sub?: string | null;
  landingFeature3Label?: string | null;
  landingFeature3Sub?: string | null;
  landingFeature4Label?: string | null;
  landingFeature4Sub?: string | null;
  landingFeature5Label?: string | null;
  landingFeature5Sub?: string | null;
  landingBenefitsTitle?: string | null;
  landingBenefitsSubtitle?: string | null;
  landingBenefit1Title?: string | null;
  landingBenefit1Desc?: string | null;
  landingBenefit2Title?: string | null;
  landingBenefit2Desc?: string | null;
  landingBenefit3Title?: string | null;
  landingBenefit3Desc?: string | null;
  landingBenefit4Title?: string | null;
  landingBenefit4Desc?: string | null;
  landingBenefit5Title?: string | null;
  landingBenefit5Desc?: string | null;
  landingBenefit6Title?: string | null;
  landingBenefit6Desc?: string | null;
  landingTariffsTitle?: string | null;
  landingTariffsSubtitle?: string | null;
  landingDevicesTitle?: string | null;
  landingDevicesSubtitle?: string | null;
  landingFaqTitle?: string | null;
  landingFaqJson?: string | null;
  landingHeroHeadline1?: string | null;
  landingHeroHeadline2?: string | null;
  landingHeaderBadge?: string | null;
  landingButtonLogin?: string | null;
  landingButtonLoginCabinet?: string | null;
  landingNavBenefits?: string | null;
  landingNavTariffs?: string | null;
  landingNavDevices?: string | null;
  landingNavFaq?: string | null;
  landingBenefitsBadge?: string | null;
  landingDefaultPaymentText?: string | null;
  landingButtonChooseTariff?: string | null;
  landingNoTariffsMessage?: string | null;
  landingButtonWatchTariffs?: string | null;
  landingButtonStart?: string | null;
  landingButtonOpenCabinet?: string | null;
  landingJourneyStepsJson?: string | null;
  landingSignalCardsJson?: string | null;
  landingTrustPointsJson?: string | null;
  landingExperiencePanelsJson?: string | null;
  landingDevicesListJson?: string | null;
  landingQuickStartJson?: string | null;
  landingInfraTitle?: string | null;
  landingNetworkCockpitText?: string | null;
  landingPulseTitle?: string | null;
  landingComfortTitle?: string | null;
  landingComfortBadge?: string | null;
  landingPrinciplesTitle?: string | null;
  landingTechTitle?: string | null;
  landingTechDesc?: string | null;
  landingCategorySubtitle?: string | null;
  landingTariffDefaultDesc?: string | null;
  landingTariffBullet1?: string | null;
  landingTariffBullet2?: string | null;
  landingTariffBullet3?: string | null;
  landingLowestTariffDesc?: string | null;
  landingDevicesCockpitText?: string | null;
  landingUniversalityTitle?: string | null;
  landingUniversalityDesc?: string | null;
  landingQuickSetupTitle?: string | null;
  landingQuickSetupDesc?: string | null;
  landingPremiumServiceTitle?: string | null;
  landingPremiumServicePara1?: string | null;
  landingPremiumServicePara2?: string | null;
  landingHowItWorksTitle?: string | null;
  landingHowItWorksDesc?: string | null;
  landingStatsPlatforms?: string | null;
  landingStatsTariffsLabel?: string | null;
  landingStatsAccessLabel?: string | null;
  landingStatsPaymentMethods?: string | null;
  landingReadyToConnectEyebrow?: string | null;
  landingReadyToConnectTitle?: string | null;
  landingReadyToConnectDesc?: string | null;
  landingShowFeatures?: boolean;
  landingShowBenefits?: boolean;
  landingShowDevices?: boolean;
  landingShowFaq?: boolean;
  landingShowHowItWorks?: boolean;
  landingShowCta?: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  proxyTelegram?: boolean;
  proxyPayments?: boolean;
  proxyAi?: boolean;
  nalogEnabled?: boolean;
  nalogInn?: string | null;
  nalogPassword?: string | null;
  nalogDeviceId?: string | null;
  nalogServiceName?: string | null;
  geoMapEnabled?: boolean;
  geoCacheTtl?: number;
  maxmindDbPath?: string | null;
  giftSubscriptionsEnabled?: boolean;
  giftCodeExpiryHours?: number;
  maxAdditionalSubscriptions?: number;
  giftCodeFormatLength?: number;
  giftRateLimitPerMinute?: number;
  giftExpiryNotificationDays?: number;
  giftReferralEnabled?: boolean;
  giftMessageMaxLength?: number;
}

export interface ClientRecord {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  remnawaveUuid: string | null;
  trialUsed: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  referralPercent: number | null;
  /** Персональная скидка клиента, % (0–100). null = без скидки. */
  personalDiscountPercent: number | null;
  createdAt: string;
  /** Количество приглашённых рефералов (приходит с бэкенда) */
  _count?: { referrals: number };
  /** Активная нода Remna (если есть) */
  activeNode?: string | null;
  /** Время последнего подключения к VPN (ISO timestamp) */
  onlineAt?: string | null;
}

export type UpdateClientPayload = {
  email?: string | null;
  preferredLang?: string;
  preferredCurrency?: string;
  balance?: number;
  isBlocked?: boolean;
  blockReason?: string | null;
  referralPercent?: number | null;
  personalDiscountPercent?: number | null;
};

export type UpdateClientRemnaPayload = {
  trafficLimitBytes?: number;
  trafficLimitStrategy?: "NO_RESET" | "DAY" | "WEEK" | "MONTH" | "MONTH_ROLLING";
  hwidDeviceLimit?: number | null;
  expireAt?: string;
  activeInternalSquads?: string[];
  status?: "ACTIVE" | "DISABLED";
};

export interface RemnaUserFull {
  uuid: string;
  id: number;
  shortUuid: string;
  username: string;
  status: "ACTIVE" | "DISABLED" | "LIMITED" | "EXPIRED";
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  expireAt: string | null;
  telegramId: number | null;
  email: string | null;
  description: string | null;
  tag: string | null;
  hwidDeviceLimit: number | null;
  trojanPassword: string;
  vlessUuid: string;
  ssPassword: string;
  lastTriggeredThreshold: number;
  subRevokedAt: string | null;
  lastTrafficResetAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionUrl: string;
  activeInternalSquads: { uuid: string; name?: string }[];
  userTraffic: {
    usedTrafficBytes: number;
    lifetimeUsedTrafficBytes: number;
    onlineAt: string | null;
    lastConnectedNodeUuid: string | null;
    firstConnectedAt: string | null;
  };
}

export interface RemnaHwidDevice {
  id: string;
  hwid: string;
  userUuid: string;
  platform: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RemnaHwidDevicesResponse {
  response: {
    total: number;
    devices: RemnaHwidDevice[];
  };
}

export interface RemnaUserUsageResponse {
  response: {
    categories: string[];
    series: { name: string; data: number[] }[];
    sparklineData: number[];
  };
}

export interface AdminSettings {
  allowUserThemeChange?: boolean;
  activeLanguages: string[];
  activeCurrencies: string[];
  defaultLanguage?: string;
  defaultCurrency?: string;
  defaultReferralPercent: number;
  referralPercentLevel2: number;
  referralPercentLevel3: number;
  trialDays: number;
  trialSquadUuid?: string | null;
  trialDeviceLimit?: number | null;
  trialTrafficLimitBytes?: number | null;
  serviceName: string;
  logo?: string | null;
  logoBot?: string | null;
  favicon?: string | null;
  cabinetDesign?: "classic" | "stealth";
  remnaClientUrl?: string | null;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  smtpFromEmail?: string | null;
  smtpFromName?: string | null;
  publicAppUrl?: string | null;
  telegramBotToken?: string | null;
  defaultAutoRenewEnabled?: boolean;
  autoRenewDaysBeforeExpiry?: number;
  autoRenewNotifyDaysBefore?: number;
  autoRenewGracePeriodDays?: number;
  autoRenewMaxRetries?: number;
  yookassaRecurringEnabled?: boolean;
  telegramBotUsername?: string | null;
  /** Telegram ID админов бота (видят кнопку «Панель админа» в боте) */
  botAdminTelegramIds?: string[] | null;
  /** Группа для уведомлений: Chat ID (например -1001234567890). Бот должен быть в группе. */
  notificationTelegramGroupId?: string | null;
  notificationTopicNewClients?: string | null;
  notificationTopicPayments?: string | null;
  notificationTopicTickets?: string | null;
  notificationTopicBackups?: string | null;
  autoBackupEnabled?: boolean;
  autoBackupCron?: string | null;
  plategaMerchantId?: string | null;
  plategaSecret?: string | null;
  plategaMethods?: { id: number; enabled: boolean; label: string }[];
  yoomoneyClientId?: string | null;
  yoomoneyClientSecret?: string | null;
  yoomoneyReceiverWallet?: string | null;
  yoomoneyNotificationSecret?: string | null;
  yookassaShopId?: string | null;
  yookassaSecretKey?: string | null;
  cryptopayApiToken?: string | null;
  cryptopayTestnet?: boolean;
  heleketMerchantId?: string | null;
  heleketApiKey?: string | null;
  lavaShopId?: string | null;
  lavaSecretKey?: string | null;
  lavaAdditionalKey?: string | null;
  lavatopApiKey?: string | null;
  lavatopDefaultOfferId?: string | null;
  botWelcomeEnabled?: boolean;
  botWelcomeText?: string | null;
  botWelcomeImage?: string | null;
  botWelcomeShowOnce?: boolean;
  cabinetDesignApplyInBrowser?: boolean;
  overpayApiUrl?: string | null;
  overpayProjectId?: string | null;
  overpayLogin?: string | null;
  overpayPassword?: string | null;
  paymentProviders?: { id: string; label: string; sortOrder: number }[];
  groqApiKey?: string | null;
  groqModel?: string | null;
  groqFallback1?: string | null;
  groqFallback2?: string | null;
  groqFallback3?: string | null;
  aiSystemPrompt?: string | null;
  /** Кнопки главного меню бота: порядок, видимость, текст, стиль, ключ эмодзи, в один ряд */
  botButtons?: { id: string; visible: boolean; label: string; order: number; style?: string; emojiKey?: string; onePerRow?: boolean }[];
  /** Кнопок в ряд в главном меню: 1 или 2 (по умолчанию 1) */
  botButtonsPerRow?: 1 | 2;
  /** Эмодзи по ключам: Unicode и/или TG custom emoji ID (премиум). Ключи: TRIAL, PACKAGE, CARD, LINK, SERVERS, … */
  botEmojis?: Record<string, { unicode?: string; tgEmojiId?: string }>;
  /** Текст кнопки «В меню» */
  botBackLabel?: string | null;
  /** Тексты главного меню бота (приветствие, подписи) */
  botMenuTexts?: Record<string, string> | null;
  /** Видимость строк приветственного текста и главного меню */
  botMenuLineVisibility?: Record<string, boolean> | null;
  /** Стили внутренних кнопок бота (тарифы, пополнение, «Назад» и т.д.) */
  botInnerButtonStyles?: Record<string, string> | null;
  /** Текст экрана тарифов в боте */
  botTariffsText?: string | null;
  /** Какие поля показывать в строке тарифа */
  botTariffsFields?: Record<string, boolean> | null;
  /** Текст окна оплаты в боте */
  botPaymentText?: string | null;
  /** JSON конфиг страницы подписки (приложения, тексты) */
  subscriptionPageConfig?: string | null;
  /** Ссылки раздела «Поддержка» в боте (если пусто — кнопка не показывается) */
  supportLink?: string | null;
  agreementLink?: string | null;
  offerLink?: string | null;
  instructionsLink?: string | null;
  /** Тикет-система включена (кабинет + мини-апп) */
  ticketsEnabled?: boolean;
  /** Глобальная цветовая тема */
  themeAccent?: string;
  /** Принудительная подписка на канал/группу */
  forceSubscribeEnabled?: boolean;
  forceSubscribeChannelId?: string | null;
  forceSubscribeMessage?: string | null;
  /** Community Blacklist — автоблокировка пользователей из общего списка */
  blacklistEnabled?: boolean;
  /** Авто-удаление нераспознанных сообщений в боте (стикеры, случайный текст и т.п.) */
  botAutoDeleteUnknownMessages?: boolean;
  /** Кастомный инфо-блок: показывается в главном меню бота и в кабинете. Пусто = скрыт. */
  botInfoBlock?: string | null;
  /** Продажа опций: доп. трафик, устройства, серверы */
  sellOptionsEnabled?: boolean;
  sellOptionsTrafficEnabled?: boolean;
  sellOptionsTrafficProducts?: { id: string; name: string; trafficGb: number; price: number; currency: string }[];
  sellOptionsDevicesEnabled?: boolean;
  sellOptionsDevicesProducts?: { id: string; name: string; deviceCount: number; price: number; currency: string }[];
  sellOptionsServersEnabled?: boolean;
  sellOptionsServersProducts?: { id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string }[];
  /** Google Analytics 4 Measurement ID (G-XXXXXXXXXX) — подключается на страницах кабинета */
  googleAnalyticsId?: string | null;
  /** Яндекс.Метрика: номер счётчика — подключается на страницах кабинета */
  yandexMetrikaId?: string | null;
  /** Расписание авто-рассылки (cron, например "0 9 * * *" = 9:00 каждый день). Пусто = по умолчанию 9:00. */
  autoBroadcastCron?: string | null;
  /** Фронтовые всплывающие уведомления в панели админа включены */
  adminFrontNotificationsEnabled?: boolean;
  /** Регистрация без подтверждения почты */
  skipEmailVerification?: boolean;
  /** Кнопка VPN в боте ведёт на страницу подписки Remna */
  useRemnaSubscriptionPage?: boolean;
  /** AI-чат в кабинете включён */
  aiChatEnabled?: boolean;
  /** Гибкий тариф (собери сам) */
  customBuildEnabled?: boolean;
  customBuildPricePerDay?: number;
  customBuildPricePerDevice?: number;
  customBuildTrafficMode?: "unlimited" | "per_gb";
  customBuildPricePerGb?: number;
  customBuildSquadUuid?: string | null;
  customBuildCurrency?: string;
  customBuildMaxDays?: number;
  customBuildMaxDevices?: number;
  /** OAuth */
  googleLoginEnabled?: boolean;
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  appleLoginEnabled?: boolean;
  appleClientId?: string | null;
  appleTeamId?: string | null;
  appleKeyId?: string | null;
  applePrivateKey?: string | null;
  /** Лендинг на главной (/) */
  landingEnabled?: boolean;
  landingHeroTitle?: string | null;
  landingHeroSubtitle?: string | null;
  landingHeroCtaText?: string | null;
  landingShowTariffs?: boolean;
  landingContacts?: string | null;
  landingOfferLink?: string | null;
  landingPrivacyLink?: string | null;
  landingFooterText?: string | null;
  landingHeroBadge?: string | null;
  landingHeroHint?: string | null;
  landingFeature1Label?: string | null;
  landingFeature1Sub?: string | null;
  landingFeature2Label?: string | null;
  landingFeature2Sub?: string | null;
  landingFeature3Label?: string | null;
  landingFeature3Sub?: string | null;
  landingFeature4Label?: string | null;
  landingFeature4Sub?: string | null;
  landingFeature5Label?: string | null;
  landingFeature5Sub?: string | null;
  landingBenefitsTitle?: string | null;
  landingBenefitsSubtitle?: string | null;
  landingBenefit1Title?: string | null;
  landingBenefit1Desc?: string | null;
  landingBenefit2Title?: string | null;
  landingBenefit2Desc?: string | null;
  landingBenefit3Title?: string | null;
  landingBenefit3Desc?: string | null;
  landingBenefit4Title?: string | null;
  landingBenefit4Desc?: string | null;
  landingBenefit5Title?: string | null;
  landingBenefit5Desc?: string | null;
  landingBenefit6Title?: string | null;
  landingBenefit6Desc?: string | null;
  landingTariffsTitle?: string | null;
  landingTariffsSubtitle?: string | null;
  landingDevicesTitle?: string | null;
  landingDevicesSubtitle?: string | null;
  landingFaqTitle?: string | null;
  landingFaqJson?: string | null;
  landingHeroHeadline1?: string | null;
  landingHeroHeadline2?: string | null;
  landingHeaderBadge?: string | null;
  landingButtonLogin?: string | null;
  landingButtonLoginCabinet?: string | null;
  landingNavBenefits?: string | null;
  landingNavTariffs?: string | null;
  landingNavDevices?: string | null;
  landingNavFaq?: string | null;
  landingBenefitsBadge?: string | null;
  landingDefaultPaymentText?: string | null;
  landingButtonChooseTariff?: string | null;
  landingNoTariffsMessage?: string | null;
  landingButtonWatchTariffs?: string | null;
  landingButtonStart?: string | null;
  landingButtonOpenCabinet?: string | null;
  landingJourneyStepsJson?: string | null;
  landingSignalCardsJson?: string | null;
  landingTrustPointsJson?: string | null;
  landingExperiencePanelsJson?: string | null;
  landingDevicesListJson?: string | null;
  landingQuickStartJson?: string | null;
  landingInfraTitle?: string | null;
  landingNetworkCockpitText?: string | null;
  landingPulseTitle?: string | null;
  landingComfortTitle?: string | null;
  landingComfortBadge?: string | null;
  landingPrinciplesTitle?: string | null;
  landingTechTitle?: string | null;
  landingTechDesc?: string | null;
  landingCategorySubtitle?: string | null;
  landingTariffDefaultDesc?: string | null;
  landingTariffBullet1?: string | null;
  landingTariffBullet2?: string | null;
  landingTariffBullet3?: string | null;
  landingLowestTariffDesc?: string | null;
  landingDevicesCockpitText?: string | null;
  landingUniversalityTitle?: string | null;
  landingUniversalityDesc?: string | null;
  landingQuickSetupTitle?: string | null;
  landingQuickSetupDesc?: string | null;
  landingPremiumServiceTitle?: string | null;
  landingPremiumServicePara1?: string | null;
  landingPremiumServicePara2?: string | null;
  landingHowItWorksTitle?: string | null;
  landingHowItWorksDesc?: string | null;
  landingStatsPlatforms?: string | null;
  landingStatsTariffsLabel?: string | null;
  landingStatsAccessLabel?: string | null;
  landingStatsPaymentMethods?: string | null;
  landingReadyToConnectEyebrow?: string | null;
  landingReadyToConnectTitle?: string | null;
  landingReadyToConnectDesc?: string | null;
  landingShowFeatures?: boolean;
  landingShowBenefits?: boolean;
  landingShowDevices?: boolean;
  landingShowFaq?: boolean;
  landingShowHowItWorks?: boolean;
  landingShowCta?: boolean;
  /** Прокси для внешних запросов */
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  proxyTelegram?: boolean;
  proxyPayments?: boolean;
  proxyAi?: boolean;
  nalogEnabled?: boolean;
  nalogInn?: string | null;
  nalogPassword?: string | null;
  nalogDeviceId?: string | null;
  nalogServiceName?: string | null;
  geoMapEnabled?: boolean;
  geoCacheTtl?: number;
  maxmindDbPath?: string | null;
  giftSubscriptionsEnabled?: boolean;
  giftCodeExpiryHours?: number;
  maxAdditionalSubscriptions?: number;
  giftCodeFormatLength?: number;
  giftRateLimitPerMinute?: number;
  giftExpiryNotificationDays?: number;
  giftReferralEnabled?: boolean;
  giftMessageMaxLength?: number;
}

/** Конфиг страницы подписки (формат как sub.stealthnet.app) */
export type SubscriptionPageConfig = {
  locales?: string[];
  version?: string;
  uiConfig?: { subscriptionInfoBlockType?: string; installationGuidesBlockType?: string };
  platforms?: Record<
    string,
    {
      apps?: {
        name: string;
        featured?: boolean;
        blocks?: {
          title?: Record<string, string>;
          description?: Record<string, string>;
          buttons?: { link: string; text: Record<string, string>; type: string; svgIconKey?: string }[];
          svgIconKey?: string;
          svgIconColor?: string;
        }[];
      }[];
      displayName?: Record<string, string>;
      svgIconKey?: string;
    }
  >;
  translations?: Record<string, Record<string, string>>;
  brandingSettings?: { title?: string; logoUrl?: string; supportUrl?: string };
} | null;

export interface ServerStats {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  cpu: { model: string; cores: number; usagePercent: number };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number };
  disk: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number; mount: string } | null;
}

export interface SshConfig {
  port: number;
  permitRootLogin: string;
  passwordAuthentication: boolean;
  pubkeyAuthentication: boolean;
}

export interface DashboardStats {
  users: {
    total: number;
    withRemna: number;
    newToday: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  sales: {
    totalAmount: number;
    totalCount: number;
    todayAmount: number;
    todayCount: number;
    last7DaysAmount: number;
    last7DaysCount: number;
    last30DaysAmount: number;
    last30DaysCount: number;
  };
}

export interface AutoRenewStats {
  enabled: number;
  disabled: number;
  retriesInProgress: number;
  renewalsLast7Days: number;
  renewalsLast30Days: number;
  amountLast30Days: number;
}

export interface AdminNotificationCounters {
  totalClients: number;
  totalTickets: number;
  totalTariffPayments: number;
  totalBalanceTopups: number;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  description: string | null;
  prefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKeyListItem {
  keyHash: string;
  rawKey: string;
}

export interface TrafficAbuser {
  uuid: string;
  username: string;
  email: string | null;
  telegramId: number | null;
  status: string;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  usedTrafficBytes: number;
  lifetimeUsedTrafficBytes: number;
  periodUsageBytes: number;
  usagePercent: number;
  perNodeUsage: { nodeName: string; bytes: number }[];
  onlineAt: string | null;
  lastConnectedNodeUuid: string | null;
  createdAt: string;
  expireAt: string;
  abuseScore: number;
}

export interface TrafficAbuseStats {
  totalUsers: number;
  activeNodes: number;
  nodesWithData?: number;
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  totalTrafficPeriod: number;
  abusersCount: number;
  abuserTrafficTotal: number;
  abuserTrafficPercent: number;
  threshold: number;
  minBytes: number;
}

export interface TrafficAbuseResponse {
  abusers: TrafficAbuser[];
  stats: TrafficAbuseStats;
}

// ────── Admin Secondary Subscriptions ──────

export interface AdminSecondarySubscriptionOwner {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
}

export interface AdminSecondarySubscriptionTariff {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  category?: string | null;
}

export interface AdminGiftCodeBrief {
  id: string;
  code: string;
  status: string;
  giftMessage: string | null;
  expiresAt: string;
  redeemedAt: string | null;
  createdAt: string;
  redeemedBy: { id: string; email: string | null; telegramUsername: string | null } | null;
  creator?: { id: string; email: string | null; telegramUsername: string | null } | null;
}

export interface AdminSecondarySubscription {
  id: string;
  ownerId: string;
  remnawaveUuid: string | null;
  subscriptionIndex: number;
  tariffId: string | null;
  giftStatus: string | null;
  giftedToClientId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: AdminSecondarySubscriptionOwner;
  giftedToClient: AdminSecondarySubscriptionOwner | null;
  tariff: AdminSecondarySubscriptionTariff | null;
  latestGiftCode: AdminGiftCodeBrief | null;
}

export interface AdminSecondarySubscriptionsResponse {
  items: AdminSecondarySubscription[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminSecondarySubscriptionDetail extends AdminSecondarySubscription {
  giftCodes: AdminGiftCodeBrief[];
  remnaData: Record<string, unknown> | null;
  history: {
    id: string;
    clientId: string;
    secondarySubscriptionId: string | null;
    eventType: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }[];
}

export interface AdminSecondarySubscriptionFilters {
  page?: number;
  limit?: number;
  search?: string;
  giftStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface GiftAnalytics {
  totalSubscriptions: number;
  last30Days: number;
  activatedSelf: number;
  gifted: number;
  pendingCodes: number;
  expiredCodes: number;
  redeemedCodes: number;
  conversionRate: number;
}

export interface PublicGiftCodeInfo {
  code: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "CANCELLED";
  giftMessage: string | null;
  expiresAt: string;
  createdAt: string;
  tariffName: string | null;
  isExpired: boolean;
}

export interface RemnaNode {
  uuid: string;
  name: string;
  address: string;
  port?: number | null;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  lastStatusChange?: string | null;
  lastStatusMessage?: string | null;
  xrayUptime?: number;
  isTrafficTrackingActive?: boolean;
  usersOnline?: number | null;
  trafficUsedBytes?: number | null;
  trafficLimitBytes?: number | null;
  countryCode?: string;
  /** Old API (<=2.6): top-level fields (deprecated) */
  cpuCount?: number | null;
  cpuModel?: string | null;
  totalRam?: string | null;
  /** New API (>=2.7): nested under system/versions */
  system?: {
    info?: {
      cpus?: number;
      cpuModel?: string;
      memoryTotal?: number;
      hostname?: string;
      platform?: string;
    } | null;
    stats?: {
      memoryFree?: number;
      memoryUsed?: number;
      uptime?: number;
      loadAvg?: number[];
      interface?: {
        rxBytesPerSec?: number;
        txBytesPerSec?: number;
        rxTotal?: number;
        txTotal?: number;
      } | null;
    } | null;
  } | null;
  versions?: {
    xray?: string;
    node?: string;
  } | null;
}

export interface ProxySlotAdminItem {
  id: string;
  nodeId: string;
  nodeName: string;
  publicHost: string | null;
  socksPort: number;
  httpPort: number;
  clientId: string;
  clientEmail: string | null;
  clientTelegram: string | null;
  clientTelegramId: string | null;
  login: string;
  password: string;
  expiresAt: string;
  trafficLimitBytes: string | null;
  trafficUsedBytes: string;
  connectionLimit: number | null;
  currentConnections: number;
  status: string;
  createdAt: string;
}

export type RemnaNodesResponse = { response?: RemnaNode[] };

export interface ProxyNodeListItem {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  publicHost: string | null;
  socksPort: number;
  httpPort: number;
  capacity: number | null;
  currentConnections: number;
  trafficInBytes: string;
  trafficOutBytes: string;
  slotsCount: number;
  createdAt: string;
}

export interface CreateProxyNodeResponse {
  node: { id: string; name: string; status: string; token: string; createdAt: string };
  dockerCompose: string;
  instructions: string;
}

export interface ProxyNodeDetail {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  publicHost: string | null;
  socksPort: number;
  httpPort: number;
  capacity: number | null;
  currentConnections: number;
  trafficInBytes: string;
  trafficOutBytes: string;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  slots: Array<{
    id: string;
    login: string;
    expiresAt: string;
    trafficLimitBytes: string | null;
    connectionLimit: number | null;
    trafficUsedBytes: string;
    currentConnections: number;
    status: string;
    client: { id: string; email: string | null; telegramUsername: string | null; telegramId: string | null };
    createdAt: string;
  }>;
}

export interface SingboxNodeListItem {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  publicHost: string | null;
  port: number;
  protocol: string;
  tlsEnabled: boolean;
  capacity: number | null;
  currentConnections: number;
  trafficInBytes: string;
  trafficOutBytes: string;
  slotsCount: number;
  hasCustomConfig: boolean;
  createdAt: string;
}

export interface CreateSingboxNodeResponse {
  node: { id: string; name: string; status: string; protocol: string; port: number; token: string; createdAt: string };
  dockerCompose: string;
  instructions: string;
}

export interface SingboxNodeDetail {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  publicHost: string | null;
  port: number;
  protocol: string;
  tlsEnabled: boolean;
  capacity: number | null;
  currentConnections: number;
  trafficInBytes: string;
  trafficOutBytes: string;
  metadata: string | null;
  customConfigJson: string | null;
  createdAt: string;
  updatedAt: string;
  slots: Array<{
    id: string;
    userIdentifier: string;
    expiresAt: string;
    trafficLimitBytes: string | null;
    trafficUsedBytes: string;
    currentConnections: number;
    status: string;
    client: { id: string; email: string | null; telegramUsername: string | null; telegramId: string | null };
    createdAt: string;
  }>;
}

export interface SingboxCategoryItem {
  id: string;
  name: string;
  sortOrder: number;
  tariffs: { id: string; name: string; slotCount: number; durationDays: number; trafficLimitBytes: string | null; price: number; currency: string; enabled: boolean }[];
}

export interface SingboxTariffListItem {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  slotCount: number;
  durationDays: number;
  trafficLimitBytes: string | null;
  price: number;
  currency: string;
  sortOrder: number;
  enabled: boolean;
}

export type RemnaSystemStats = {
  response?: {
    users?: { totalUsers?: number; statusCounts?: Record<string, number> };
    cpu?: { cores?: number; physicalCores?: number };
    memory?: { total?: number; used?: number; free?: number };
    uptime?: number;
  };
};

export interface TariffCategoryRecord {
  id: string;
  name: string;
  emojiKey: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TariffCategoryWithTariffs extends TariffCategoryRecord {
  tariffs: TariffRecord[];
}

export interface TariffPriceOption {
  id: string;
  durationDays: number;
  price: number;
  sortOrder: number;
}

export interface DeviceDiscountTier {
  minExtraDevices: number;
  discountPercent: number;
}

export interface TariffRecord {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  durationDays: number;
  internalSquadUuids: string[];
  trafficLimitBytes: number | null;
  trafficResetMode: string;
  deviceLimit: number | null;
  includedDevices: number;
  pricePerExtraDevice: number;
  maxExtraDevices: number;
  deviceDiscountTiers: DeviceDiscountTier[];
  price: number;
  currency: string;
  sortOrder: number;
  lavatopOfferId?: string | null;
  priceOptions: TariffPriceOption[];
  createdAt: string;
  updatedAt: string;
}

export type CreateTariffPayload = {
  categoryId: string;
  name: string;
  description?: string | null;
  durationDays?: number;
  internalSquadUuids: string[];
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  price?: number;
  currency?: string;
  sortOrder?: number;
  lavatopOfferId?: string | null;
  priceOptions?: { durationDays: number; price: number }[];
};

export type UpdateTariffPayload = {
  name?: string;
  description?: string | null;
  durationDays?: number;
  internalSquadUuids?: string[];
  trafficLimitBytes?: number | null;
  trafficResetMode?: string;
  deviceLimit?: number | null;
  includedDevices?: number;
  pricePerExtraDevice?: number;
  maxExtraDevices?: number;
  deviceDiscountTiers?: DeviceDiscountTier[];
  price?: number;
  currency?: string;
  sortOrder?: number;
  lavatopOfferId?: string | null;
  priceOptions?: { durationDays: number; price: number }[];
};

// ——— Кабинет клиента ———
export interface ClientProfile {
  id: string;
  email: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredLang: string;
  preferredCurrency: string;
  balance: number;
  referralCode: string | null;
  remnawaveUuid: string | null;
  trialUsed: boolean;
  isBlocked: boolean;
  /** Кошелёк ЮMoney подключён (токен сохранён) */
  yoomoneyConnected?: boolean;
  /** Включена ли двухфакторная аутентификация (TOTP) */
  totpEnabled?: boolean;
  createdAt?: string;
  autoRenewEnabled?: boolean;
  autoRenewTariffId?: string | null;
  /** Сохранённый промокод-скидка для автопродления (применяется каждый цикл cron). null = не задан. */
  autoRenewPromoCode?: string | null;
  /** Название привязанного способа оплаты ЮKassa (например "Банковская карта *4444") */
  yookassaPaymentMethodTitle?: string | null;
  /** Завершён ли онбоардинг (установлен ли пароль для email-регистрации) */
  onboardingCompleted?: boolean;
  /** Установлен ли пароль для входа через веб. false для юзеров, зарегистрированных через Telegram/Google/Apple без пароля. */
  hasPassword?: boolean;
}

export interface ClientAuthResponse {
  token: string;
  client: ClientProfile;
}

/** Ответ входа, когда включена 2FA: нужен шаг ввода кода. */
export interface ClientAuthRequires2FA {
  requires2FA: true;
  tempToken: string;
}

export type ClientRegisterPayload = {
  email?: string;
  password?: string;
  telegramId?: string;
  telegramUsername?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  referralCode?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

export interface ClientPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface PublicTariffCategory {
  id: string;
  name: string;
  emojiKey: string | null;
  emoji: string;
  tariffs: PublicTariff[];
}

export type PublicTariff = {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  price: number;
  currency: string;
  trafficLimitBytes: number | null;
  trafficResetMode?: string;
  deviceLimit: number | null;
  includedDevices: number;
  pricePerExtraDevice: number;
  maxExtraDevices: number;
  deviceDiscountTiers: DeviceDiscountTier[];
  priceOptions: TariffPriceOption[];
};

// ——— Промо-группы ———
export interface PromoGroup {
  id: string;
  name: string;
  code: string;
  squadUuid: string;
  trafficLimitBytes: string;
  deviceLimit: number | null;
  durationDays: number;
  maxActivations: number;
  isActive: boolean;
  activationsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromoActivation {
  id: string;
  promoGroupId: string;
  clientId: string;
  createdAt: string;
  client: {
    id: string;
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    createdAt: string;
    remnawaveUuid: string | null;
  };
}

export interface PromoGroupDetail extends PromoGroup {
  activations: PromoActivation[];
}

export type CreatePromoGroupPayload = {
  name: string;
  squadUuid: string;
  trafficLimitBytes: string | number;
  deviceLimit?: number | null;
  durationDays: number;
  maxActivations: number;
  isActive?: boolean;
};

export type UpdatePromoGroupPayload = Partial<CreatePromoGroupPayload>;

// ——— Промокоды (скидки / бесплатные дни) ———
export interface PromoCodeRecord {
  id: string;
  code: string;
  name: string;
  type: "DISCOUNT" | "FREE_DAYS";
  discountPercent: number | null;
  discountFixed: number | null;
  squadUuid: string | null;
  trafficLimitBytes: string | null;
  deviceLimit: number | null;
  durationDays: number | null;
  maxUses: number;
  maxUsesPerClient: number;
  isActive: boolean;
  expiresAt: string | null;
  usagesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromoCodeUsage {
  id: string;
  promoCodeId: string;
  clientId: string;
  createdAt: string;
  client: {
    id: string;
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    createdAt: string;
    remnawaveUuid: string | null;
  };
}

export interface PromoCodeDetail extends PromoCodeRecord {
  usages: PromoCodeUsage[];
}

export type CreatePromoCodePayload = {
  code: string;
  name: string;
  type: "DISCOUNT" | "FREE_DAYS";
  discountPercent?: number | null;
  discountFixed?: number | null;
  squadUuid?: string | null;
  trafficLimitBytes?: string | number | null;
  deviceLimit?: number | null;
  durationDays?: number | null;
  maxUses: number;
  maxUsesPerClient: number;
  isActive?: boolean;
  expiresAt?: string | null;
};

export type UpdatePromoCodePayload = Partial<CreatePromoCodePayload>;

// ——— Tour Mascots ———

export interface MascotEmotionRecord {
  id: string;
  mood: string;
  imageUrl: string;
}

export interface TourMascotRecord {
  id: string;
  name: string;
  imageUrl: string;
  isBuiltIn: boolean;
  createdAt: string;
  emotions: MascotEmotionRecord[];
}

// ——— Tour Steps ———

export interface TourStepRecord {
  id: string;
  target: string;
  targetLabel: string;
  title: string;
  content: string;
  videoUrl: string | null;
  placement: string;
  route: string | null;
  mascotId: string | null;
  mood: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  mascot: TourMascotRecord | null;
}

export interface CreateTourStepPayload {
  target: string;
  targetLabel: string;
  title: string;
  content: string;
  videoUrl?: string | null;
  placement?: string;
  route?: string | null;
  mascotId?: string | null;
  mood?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export type UpdateTourStepPayload = Partial<CreateTourStepPayload>;

export interface ClientTourStep {
  id: string;
  target: string;
  targetLabel: string;
  title: string;
  content: string;
  videoUrl: string | null;
  placement: string;
  route: string | null;
  mascotId: string | null;
  mood: string;
  sortOrder: number;
  mascot: TourMascotRecord | null;
}

export interface GeoMapNode {
  uuid: string;
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  isConnected: boolean;
  usersOnline: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  trafficUsedBytes: number;
  trafficLimitBytes: number | null;
}

export interface GeoMapConnection {
  userId: string;
  username: string;
  lat: number;
  lng: number;
  ip: string;
  lastSeen: string;
  nodeUuid: string;
  trafficBytes: number;
  device: {
    platform: string;
    osVersion: string;
    deviceModel: string;
  } | null;
}

export interface GeoMapResponse {
  nodes: GeoMapNode[];
  connections: GeoMapConnection[];
  updatedAt: string;
}

export interface LanguageInfo {
  code: string;
  translatedKeys: number;
  totalKeys: number;
  completeness: number;
}

/** Одна опция для продажи в кабинете (трафик / устройства / сервер) */
export type PublicSellOption =
  | { kind: "traffic"; id: string; name: string; trafficGb: number; price: number; currency: string }
  | { kind: "devices"; id: string; name: string; deviceCount: number; price: number; currency: string }
  | { kind: "servers"; id: string; name: string; squadUuid: string; trafficGb?: number; price: number; currency: string };

export interface PublicConfig {
  activeLanguages: string[];
  activeCurrencies: string[];
  defaultLanguage?: string;
  defaultCurrency?: string;
  serviceName: string;
  logo?: string | null;
  favicon?: string | null;
  cabinetDesign?: "classic" | "stealth";
  remnaClientUrl?: string | null;
  publicAppUrl?: string | null;
  telegramBotUsername?: string | null;
  telegramBotId?: string | null;
  plategaMethods?: { id: number; label: string }[];
  yoomoneyEnabled?: boolean;
  yookassaEnabled?: boolean;
  cryptopayEnabled?: boolean;
  heleketEnabled?: boolean;
  lavaEnabled?: boolean;
  lavatopEnabled?: boolean;
  overpayEnabled?: boolean;
  paymentProviders?: { id: string; label: string; sortOrder: number }[];
  trialEnabled?: boolean;
  trialDays?: number;
  themeAccent?: string;
  ticketsEnabled?: boolean;
  sellOptionsEnabled?: boolean;
  sellOptions?: PublicSellOption[];
  showProxyEnabled?: boolean;
  showSingboxEnabled?: boolean;
  googleAnalyticsId?: string | null;
  yandexMetrikaId?: string | null;
  skipEmailVerification?: boolean;
  useRemnaSubscriptionPage?: boolean;
  aiChatEnabled?: boolean;
  customBuildConfig?: {
    enabled: true;
    pricePerDay: number;
    pricePerDevice: number;
    trafficMode: "unlimited" | "per_gb";
    pricePerGb: number;
    squadUuid: string;
    currency: string;
    maxDays: number;
    maxDevices: number;
  } | null;
  yookassaRecurringEnabled?: boolean;
  googleLoginEnabled?: boolean;
  googleClientId?: string | null;
  appleLoginEnabled?: boolean;
  appleClientId?: string | null;
  landingEnabled?: boolean;
  landingConfig?: {
    heroTitle: string;
    heroSubtitle: string | null;
    heroCtaText: string;
    heroBadge: string | null;
    heroHint: string | null;
    showTariffs: boolean;
    contacts: string | null;
    offerLink: string | null;
    privacyLink: string | null;
    footerText: string | null;
    features: { label: string; sub: string }[] | null;
    benefitsTitle: string | null;
    benefitsSubtitle: string | null;
    benefits: { title: string; desc: string }[] | null;
    tariffsTitle: string | null;
    tariffsSubtitle: string | null;
    devicesTitle: string | null;
    devicesSubtitle: string | null;
    faqTitle: string | null;
    faq: { q: string; a: string }[] | null;
    readyToConnectEyebrow?: string | null;
    readyToConnectTitle?: string | null;
    readyToConnectDesc?: string | null;
  } | null;
  translations?: Record<string, Record<string, unknown>>;
  giftSubscriptionsEnabled?: boolean;
  giftCodeExpiryHours?: number;
  maxAdditionalSubscriptions?: number;
  giftCodeFormatLength?: number;
  giftRateLimitPerMinute?: number;
  giftExpiryNotificationDays?: number;
  giftReferralEnabled?: boolean;
  giftMessageMaxLength?: number;
  /** Кастомный инфо-блок (тех. работы, акции, контакты). Пусто = скрыт. Поддерживает многострочный текст. */
  botInfoBlock?: string | null;
}
