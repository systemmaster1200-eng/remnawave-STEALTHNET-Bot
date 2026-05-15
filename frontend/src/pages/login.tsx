import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { state, login, submit2FACode, clearPending2FA } = useAuth();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<{ serviceName: string; logo: string | null }>({
    serviceName: "",
    logo: null,
  });
  const pending2FA = Boolean(state.pending2FAToken);

  useEffect(() => {
    api
      .getPublicConfig()
      .then((cfg) => {
        setBrand({
          serviceName: cfg.serviceName ?? "",
          logo: cfg.logo ?? null,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state.accessToken) navigate("/", { replace: true });
  }, [state.accessToken, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.trim().length !== 6) {
      setError("Введите 6-значный код из приложения");
      return;
    }
    setLoading(true);
    try {
      await submit2FACode(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный код");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md relative z-10"
      >
        <Card className="border-border/50 shadow-2xl">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-2">
              {brand.logo ? (
                <div className="rounded-lg bg-card p-2">
                  <img src={brand.logo} alt="" className="h-12 w-auto object-contain" />
                </div>
              ) : (
                <div className="rounded-lg bg-primary/10 p-3">
                  {pending2FA ? <KeyRound className="h-10 w-10 text-primary" /> : <Shield className="h-10 w-10 text-primary" />}
                </div>
              )}
            </div>
            <CardTitle className="text-2xl">{brand.serviceName || "Вход"}</CardTitle>
            <p className="text-muted-foreground text-sm">{pending2FA ? "Код из приложения-аутентификатора" : "Вход в админ-панель"}</p>
          </CardHeader>
          <CardContent>
            {pending2FA ? (
              <form onSubmit={handle2FASubmit} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="code">Код 2FA</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="bg-transparent text-center text-lg tracking-[0.3em] font-mono"
                  />
                </div>
                <Button type="submit" className="w-full shadow-lg" disabled={loading || code.length !== 6}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Войти"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={clearPending2FA}>
                  Отмена
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@stealthnet.local"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="bg-transparent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="bg-transparent"
                  />
                </div>
                <Button type="submit" className="w-full shadow-lg" disabled={loading}>
                  {loading ? "Вход…" : "Войти"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
