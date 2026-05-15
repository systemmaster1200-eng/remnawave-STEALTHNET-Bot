/**
 * Drawer для админских действий над платежом.
 *
 * Открывается из sales-report (или любого места, где есть paymentId), показывает:
 *   - сводку по платежу (сумма / валюта / провайдер / клиент / связанные referral_credits)
 *   - 3 кнопки действий:
 *       • Mark as Failed — для зависших PENDING платежей
 *       • Refund         — полный возврат (балансу клиента + reverse referrals)
 *       • Retry Activation — повторить активацию для PAID платежа (тариф/прокси/singbox/extra)
 *
 * Каждое действие требует подтверждения и логируется в audit log на бэке.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, AlertTriangle, RotateCw, Ban, Receipt, RefreshCw, ArrowUpRight, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth";
import { paymentActionsApi, type PaymentDetailResponse } from "@/lib/admin-extras-api";
import { cn } from "@/lib/utils";

interface Props {
  paymentId: string | null;
  onClose: () => void;
  onRefreshList?: () => void;
}

export function PaymentActionsDrawer({ paymentId, onClose, onRefreshList }: Props) {
  const { state } = useAuth();
  const [data, setData] = useState<PaymentDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // form state
  const [reason, setReason] = useState("");
  const [refundToBalance, setRefundToBalance] = useState(true);
  const [reverseReferrals, setReverseReferrals] = useState(true);

  // pending action
  const [pendingAction, setPendingAction] = useState<null | "mark-failed" | "refund" | "retry">(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<null | "mark-failed" | "refund">(null);

  useEffect(() => {
    if (!paymentId || !state.accessToken) {
      setData(null);
      setActionResult(null);
      setActionError(null);
      setConfirmStep(null);
      return;
    }
    setLoading(true);
    setErr(null);
    paymentActionsApi
      .details(state.accessToken, paymentId)
      .then((r) => setData(r))
      .catch((e) => setErr(e instanceof Error ? e.message : "load error"))
      .finally(() => setLoading(false));
  }, [paymentId, state.accessToken]);

  if (!paymentId) return null;

  async function reload() {
    if (!paymentId || !state.accessToken) return;
    setLoading(true);
    try {
      const r = await paymentActionsApi.details(state.accessToken, paymentId);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "reload error");
    } finally {
      setLoading(false);
    }
  }

  async function doMarkFailed() {
    if (!paymentId || !state.accessToken) return;
    setPendingAction("mark-failed");
    setActionError(null);
    try {
      await paymentActionsApi.markFailed(state.accessToken, paymentId, reason || undefined);
      setActionResult("Платёж отмечен как FAILED.");
      setConfirmStep(null);
      await reload();
      onRefreshList?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "mark-failed error");
    } finally {
      setPendingAction(null);
    }
  }

  async function doRefund() {
    if (!paymentId || !state.accessToken) return;
    setPendingAction("refund");
    setActionError(null);
    try {
      const r = await paymentActionsApi.refund(state.accessToken, paymentId, {
        refundToBalance,
        reverseReferrals,
        reason: reason || undefined,
      });
      setActionResult(
        `Возврат выполнен. На баланс: ${r.summary.creditedToBalance.toFixed(2)}; ` +
        `откатано referral-наград: ${r.summary.reversedReferralCount} (на сумму ${r.summary.reversedReferralAmount.toFixed(2)}).`
      );
      setConfirmStep(null);
      await reload();
      onRefreshList?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "refund error");
    } finally {
      setPendingAction(null);
    }
  }

  async function doRetry() {
    if (!paymentId || !state.accessToken) return;
    setPendingAction("retry");
    setActionError(null);
    try {
      const r = await paymentActionsApi.retryActivation(state.accessToken, paymentId);
      setActionResult(`Активация повторена. Результат: ${JSON.stringify(r.result).slice(0, 200)}`);
      await reload();
      onRefreshList?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "retry error");
    } finally {
      setPendingAction(null);
    }
  }

  const p = data?.payment;
  const isPaid = p?.status === "PAID";
  const isPending = p?.status === "PENDING";
  const isRefunded = p?.status === "REFUNDED";
  const isFailed = p?.status === "FAILED";

  // Drawer рендерится через portal в document.body — иначе попадает в stacking
  // context <main className="relative z-10">, и его z-[81] не выходит выше z-[70]
  // топбара/сайдбара, оказываясь визуально под ними.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={cn(
          "fixed right-0 top-0 z-[81] h-screen w-full sm:w-[480px] max-w-full overflow-y-auto",
          "bg-slate-200/80 dark:bg-slate-950/80 backdrop-blur-2xl border-l border-white/40 dark:border-white/10",
          "shadow-2xl flex flex-col"
        )}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-slate-200/60 dark:bg-slate-900/60 backdrop-blur-xl border-b border-white/30 dark:border-white/10">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-foreground">Действия с платежом</h3>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{paymentId.slice(0, 24)}…</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-xl">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="px-5 py-4 space-y-4 flex-1">
          {loading && !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : err ? (
            <Card className="p-4 bg-rose-500/10 border-rose-500/30">
              <p className="text-xs text-rose-500">{err}</p>
            </Card>
          ) : p ? (
            <>
              {/* Summary card */}
              <Card className="p-4 bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Сумма</span>
                  <span className="font-bold text-foreground">
                    {p.amount.toFixed(2)} <span className="text-xs text-muted-foreground">{p.currency}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Статус</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                    isPaid && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
                    isPending && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
                    isFailed && "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
                    isRefunded && "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
                  )}>
                    {p.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Провайдер</span>
                  <span className="text-xs text-foreground font-medium">{p.provider ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Order</span>
                  <span className="text-xs text-foreground font-mono">{p.orderId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Создан</span>
                  <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("ru-RU")}</span>
                </div>
              </Card>

              {/* Client card */}
              <Card className="p-4 bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Клиент</span>
                </div>
                <div className="text-xs space-y-1">
                  <div>
                    <span className="text-muted-foreground">Email/TG: </span>
                    <span className="text-foreground">
                      {p.client.email ?? (p.client.telegramUsername ? `@${p.client.telegramUsername}` : p.client.telegramId ?? p.client.id.slice(0, 12))}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Баланс: </span>
                    <span className="text-foreground font-medium">{p.client.balance.toFixed(2)}</span>
                  </div>
                  {p.client.isBlocked && (
                    <div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-rose-500/10 text-rose-500 border-rose-500/30">
                        Заблокирован
                      </span>
                    </div>
                  )}
                </div>
              </Card>

              {/* Referral credits */}
              {data!.referralCredits.length > 0 && (
                <Card className="p-4 bg-background/60 backdrop-blur-3xl border-white/10 rounded-2xl">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    Referral-credits ({data!.referralCredits.length})
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {data!.referralCredits.map((c) => (
                      <div key={c.id} className="flex items-center justify-between">
                        <span className="text-foreground">
                          {c.referrer?.email ?? c.referrer?.telegramUsername ?? c.referrerId.slice(0, 10)}
                        </span>
                        <span className="font-mono text-emerald-500">+{c.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Reason */}
              {(isPending || isPaid) && (
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 block">
                    Причина (опционально, попадёт в audit log)
                  </label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Напр. «Дубль платежа» или «Запрос клиента»"
                    className="bg-foreground/[0.03] dark:bg-white/[0.02] border-white/10 rounded-xl text-xs"
                  />
                </div>
              )}

              {/* Actions */}
              {actionResult && (
                <Card className="p-3 bg-emerald-500/10 border-emerald-500/30">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">{actionResult}</p>
                </Card>
              )}
              {actionError && (
                <Card className="p-3 bg-rose-500/10 border-rose-500/30">
                  <p className="text-xs text-rose-500">{actionError}</p>
                </Card>
              )}

              <div className="space-y-2 pt-2 border-t border-white/10">
                {/* Retry activation — для PAID */}
                {isPaid && (
                  <Button
                    onClick={doRetry}
                    disabled={pendingAction !== null}
                    variant="outline"
                    className="w-full justify-start gap-2 rounded-xl text-xs h-10"
                  >
                    {pendingAction === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                    Повторить активацию
                    <ArrowUpRight className="h-3.5 w-3.5 ml-auto opacity-60" />
                  </Button>
                )}

                {/* Mark failed — для PENDING */}
                {isPending && (
                  confirmStep === "mark-failed" ? (
                    <div className="flex gap-2">
                      <Button
                        onClick={doMarkFailed}
                        disabled={pendingAction !== null}
                        variant="destructive"
                        className="flex-1 gap-2 rounded-xl text-xs h-10"
                      >
                        {pendingAction === "mark-failed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        Подтвердить mark-failed
                      </Button>
                      <Button onClick={() => setConfirmStep(null)} variant="outline" className="rounded-xl text-xs h-10">
                        Отмена
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setConfirmStep("mark-failed")}
                      disabled={pendingAction !== null}
                      variant="outline"
                      className="w-full justify-start gap-2 rounded-xl text-xs h-10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Mark as FAILED
                    </Button>
                  )
                )}

                {/* Refund — для PAID */}
                {isPaid && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-foreground/[0.03] dark:bg-white/[0.02] p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground">Зачислить на баланс клиента</span>
                        <Switch checked={refundToBalance} onCheckedChange={setRefundToBalance} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground">Откатить referral-награды</span>
                        <Switch checked={reverseReferrals} onCheckedChange={setReverseReferrals} />
                      </div>
                    </div>

                    {confirmStep === "refund" ? (
                      <div className="flex gap-2">
                        <Button
                          onClick={doRefund}
                          disabled={pendingAction !== null}
                          variant="destructive"
                          className="flex-1 gap-2 rounded-xl text-xs h-10"
                        >
                          {pendingAction === "refund" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                          Подтвердить REFUND
                        </Button>
                        <Button onClick={() => setConfirmStep(null)} variant="outline" className="rounded-xl text-xs h-10">
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setConfirmStep("refund")}
                        disabled={pendingAction !== null}
                        variant="outline"
                        className="w-full justify-start gap-2 rounded-xl text-xs h-10 border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        Refund (полный возврат)
                      </Button>
                    )}
                  </>
                )}

                {(isFailed || isRefunded) && (
                  <p className="text-xs text-muted-foreground italic text-center py-2">
                    Платёж в статусе {p.status} — действия недоступны.
                  </p>
                )}

                <Button
                  onClick={reload}
                  disabled={loading}
                  variant="ghost"
                  size="sm"
                  className="w-full gap-2 text-xs h-8"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Обновить
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>,
    document.body
  );
}
