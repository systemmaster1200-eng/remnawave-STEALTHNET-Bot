import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Shield, Loader2 } from "lucide-react";
import { useClientAuth } from "@/contexts/client-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientVerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");
  const { verifyEmail } = useClientAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Ссылка недействительна");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setStatus("ok");
        setTimeout(() => navigate("/cabinet/dashboard", { replace: true }), 1500);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Ссылка недействительна или истекла");
      });
  }, [token, verifyEmail, navigate]);

  return (
    <div className="min-h-svh flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </span>
        </div>
        <Card className="border shadow-lg">
          <CardHeader>
            <div className="flex justify-center mb-2">
              <div className="rounded-lg bg-primary/10 p-3">
                <Mail className="h-10 w-10 text-primary" />
              </div>
            </div>
            <CardTitle className="text-center">Подтверждение email</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            {status === "loading" && (
              <p className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Проверка ссылки…
              </p>
            )}
            {status === "ok" && (
              <p className="text-green-600">Регистрация завершена. Перенаправление в кабинет…</p>
            )}
            {status === "error" && (
              <p className="text-destructive">{message}</p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
