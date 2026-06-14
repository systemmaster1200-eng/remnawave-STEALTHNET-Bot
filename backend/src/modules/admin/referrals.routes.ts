import { Router } from "express";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

export const adminReferralsRouter = Router();
adminReferralsRouter.use(requireAuth);
adminReferralsRouter.use((req, res, next) => {
  // роутер смонтирован на /api/admin/referrals,
  // req.path внутри него уже без префикса (/<id>/referrer) → общий requireAdminSection брал
  // секцией сам clientId и резал менеджеров 403. Весь под-роутер = секция "clients".
  const ext = req as any;
  if (ext.adminRole === "ADMIN") return next();
  if (Array.isArray(ext.adminAllowedSections) && ext.adminAllowedSections.includes("clients")) return next();
  return res.status(403).json({ message: "Access denied to this section." });
});

adminReferralsRouter.get("/network", async (req, res) => {
  try {
    // в граф грузим ТОЛЬКО участников реф.сети
    // (есть реферер ИЛИ есть рефералы), а не всех клиентов. Иначе при большой базе
    // (154k+) Prisma превышает лимит PostgreSQL на bind-переменные (32767) при выборке
    // вложенных payments/referralCredits и эндпоинт падает с 500 → «рефералов нет».
    const clients = await prisma.client.findMany({
      where: { OR: [{ referrerId: { not: null } }, { referrals: { some: {} } }] },
      select: {
        id: true,
        email: true,
        telegramUsername: true,
        referrerId: true,
        trialUsed: true,
        utmCampaign: true,
        _count: {
          select: {
            referrals: true,
          }
        },
        payments: {
          where: { status: "PAID" },
          select: { amount: true }
        },
        referralCredits: {
          select: { amount: true }
        }
      }
    });

    const nodes = clients.map(c => {
      const paymentsCount = c.payments.length;
      const subIncome = c.payments.reduce((sum, p) => sum + p.amount, 0);
      const refIncome = c.referralCredits.reduce((sum, p) => sum + p.amount, 0);

      let status = "no_sub";
      if (c._count.referrals >= 10) status = "top_referrer";
      else if (c._count.referrals > 0) status = "active_referrer";
      else if (c.utmCampaign) status = "campaign";
      else if (paymentsCount > 0) status = "paid";
      else if (c.trialUsed) status = "trial";

      return {
        id: c.id,
        name: c.telegramUsername ? `@${c.telegramUsername}` : (c.email || c.id.slice(0, 8)),
        status,
        referralsCount: c._count.referrals,
        subscriptionIncome: subIncome,
        referralIncome: refIncome,
        campaign: c.utmCampaign
      };
    });

    const clientIds = new Set(clients.map(c => c.id));
    const links = clients
      .filter(c => c.referrerId && clientIds.has(c.referrerId))
      .map(c => ({
        source: c.referrerId,
        target: c.id
      }));

    // Stats считаем агрегатами по ВСЕЙ базе (а не по отфильтрованным участникам графа),
    // чтобы цифры были корректные и не зависели от фильтра выше. Всё на стороне БД.
    const [totalUsers, totalReferrers, campaignGroups, subAgg, refAgg] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { referrals: { some: {} } } }),
      prisma.client.groupBy({ by: ["utmCampaign"], where: { utmCampaign: { not: null } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID" } }),
      prisma.referralCredit.aggregate({ _sum: { amount: true } }),
    ]);

    return res.json({
      nodes,
      links,
      stats: {
        totalUsers,
        totalReferrers,
        totalCampaigns: campaignGroups.length,
        totalSubscriptionIncome: subAgg._sum.amount ?? 0,
        totalReferralIncome: refAgg._sum.amount ?? 0
      }
    });
  } catch (e) {
    console.error("GET /admin/referrals/network error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
});
