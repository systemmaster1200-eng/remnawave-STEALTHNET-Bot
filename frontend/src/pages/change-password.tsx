import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { state, updateAdmin } = useAuth();
  const navigate = useNavigate();
  const token = state.accessToken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPass !== confirm) {
      setError("Новый пароль и подтверждение не совпадают");
      return;
    }
    if (newPass.length < 8) {
      setError("Пароль не менее 8 символов");
      return;
    }
    if (!token) {
      setError("Нет доступа");
      return;
    }
    setLoading(true);
    try {
      const res = await api.changePassword(current, newPass, token);
      if (res.admin) updateAdmin(res.admin);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка смены пароля");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-muted/30 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardHeader>
            <CardTitle>Смена пароля</CardTitle>
            <p className="text-muted-foreground text-sm">
              При первом входе необходимо сменить пароль.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="current">Текущий пароль</Label>
                <Input
                  id="current"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">Новый пароль</Label>
                <Input
                  id="new"
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Подтверждение</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Сохранение…" : "Сменить пароль"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
