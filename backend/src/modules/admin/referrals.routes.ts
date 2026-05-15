import { Router } from "express";
import { prisma } from "../../db.js";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";

export const adminReferralsRouter = Router();
adminReferralsRouter.use(requireAuth);
adminReferralsRouter.use(requireAdminSection);

adminReferralsRouter.get("/network", async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
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

    let totalSubscriptionIncome = 0;
    let totalReferralIncome = 0;
    let totalCampaigns = new Set<string>();

    const nodes = clients.map(c => {
      const paymentsCount = c.payments.length;
      const subIncome = c.payments.reduce((sum, p) => sum + p.amount, 0);
      const refIncome = c.referralCredits.reduce((sum, p) => sum + p.amount, 0);
      
      totalSubscriptionIncome += subIncome;
      totalReferralIncome += refIncome;
      if (c.utmCampaign) totalCampaigns.add(c.utmCampaign);

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

    return res.json({
      nodes,
      links,
      stats: {
        totalUsers: clients.length,
        totalReferrers: clients.filter(c => c._count.referrals > 0).length,
        totalCampaigns: totalCampaigns.size,
        totalSubscriptionIncome,
        totalReferralIncome
      }
    });
  } catch (e) {
    console.error("GET /admin/referrals/network error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
});
