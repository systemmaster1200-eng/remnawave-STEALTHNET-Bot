/**
 * StealthDevicesModal — список подключённых устройств клиента с возможностью
 * удалить любое (HWID-based).
 *
 * Использует api.getClientDevices + api.deleteClientDevice.
 */

import { useEffect, useState } from "react";
import { Smartphone, Trash2, Loader2, Apple, MonitorSmartphone, Tv } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { api } from "@/lib/api";
import { StealthModal } from "./stealth-modal";
import { cn } from "@/lib/utils";

interface Device {
  hwid: string;
  platform?: string;
  deviceModel?: string;
  createdAt?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Колбэк когда устройство удалено — для обновления счётчика родителя. */
  onChanged?: () => void;
}

function platformIcon(platform?: string) {
  const p = (platform ?? "").toLowerCase();
  if (/ios|iphone|ipad/.test(p)) return Apple;
  if (/android/.test(p)) return Smartphone;
  if (/mac|darwin/.test(p)) return MonitorSmartphone;
  if (/win/.test(p)) return MonitorSmartphone;
  if (/linux/.test(p)) return Tv;
  return Smartphone;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }); }
  catch { return ""; }
}

export function StealthDevicesModal({ open, onClose, onChanged }: Props) {
  const { state } = useClientAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!state.token) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.getClientDevices(state.token);
      setDevices(r.devices ?? []);
      setTotal(r.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить устройства");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  async function remove(hwid: string) {
    if (!state.token) return;
    setRemoving(hwid);
    setErr(null);
    try {
      await api.deleteClientDevice(state.token, hwid);
      await load();
      setConfirm(null);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <StealthModal open={open} onClose={onClose} title="Мои устройства">
      <div className="space-y-3">
        {/* Counter pill */}
        <div className="rounded-2xl bg-zinc-950/60 border border-white/[0.06] p-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Подключено устройств</span>
          <span className="text-base font-bold tabular-nums">{total}</span>
        </div>

        {err && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">{err}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/40 p-6 text-center">
            <div className="h-12 w-12 mx-auto rounded-xl bg-zinc-800/60 border border-white/10 flex items-center justify-center mb-2">
              <Smartphone className="h-5 w-5 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-400">Нет подключённых устройств</p>
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => {
              const Icon = platformIcon(d.platform);
              const isConfirm = confirm === d.hwid;
              const isRemoving = removing === d.hwid;
              return (
                <div
                  key={d.hwid}
                  className={cn(
                    "rounded-2xl border bg-zinc-950/40 p-3 flex items-center gap-3 transition-colors",
                    isConfirm ? "border-rose-500/40" : "border-white/[0.06]",
                  )}
                >
                  <div className="h-10 w-10 rounded-xl bg-zinc-800/60 border border-white/10 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-zinc-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{d.deviceModel || d.platform || "Устройство"}</div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">
                      {d.hwid.slice(0, 16)}{d.createdAt && ` · ${fmtDate(d.createdAt)}`}
                    </div>
                  </div>
                  {isConfirm ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => remove(d.hwid)}
                        disabled={isRemoving}
                        className="rounded-lg bg-rose-500 hover:bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 transition"
                      >
                        {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Удалить"}
                      </button>
                      <button
                        onClick={() => setConfirm(null)}
                        disabled={isRemoving}
                        className="rounded-lg bg-zinc-800/80 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirm(d.hwid)}
                      className="h-8 w-8 rounded-lg hover:bg-rose-500/10 flex items-center justify-center text-rose-400/70 hover:text-rose-400 transition shrink-0"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StealthModal>
  );
}
