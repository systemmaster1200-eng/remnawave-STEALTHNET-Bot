import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Code, Key, Shield, Server, Users, CreditCard } from "lucide-react";

const base = "https://your-domain.tld/api/v1";

const endpoints = [
  {
    category: "Аутентификация",
    icon: <Shield className="h-4 w-4" />,
    items: [
      { method: "POST", path: "/auth/login", desc: "Вход по email/password", auth: "API Key" },
      { method: "POST", path: "/auth/2fa", desc: "Подтверждение 2FA", auth: "API Key" },
      { method: "POST", path: "/auth/register", desc: "Регистрация нового клиента", auth: "API Key" },
    ]
  },
  {
    category: "Профиль клиента",
    icon: <Users className="h-4 w-4" />,
    items: [
      { method: "GET", path: "/client/profile", desc: "Получить профиль клиента", auth: "Client JWT" },
      { method: "PATCH", path: "/client/profile", desc: "Обновить язык/валюту", auth: "Client JWT" },
      { method: "GET", path: "/client/referrals", desc: "Реферальный код и заработок", auth: "Client JWT" },
    ]
  },
  {
    category: "Финансы",
    icon: <CreditCard className="h-4 w-4" />,
    items: [
      { method: "GET", path: "/client/balance", desc: "Текущий баланс", auth: "Client JWT" },
      { method: "GET", path: "/client/payments", desc: "История платежей", auth: "Client JWT" },
    ]
  },
  {
    category: "Услуги",
    icon: <Server className="h-4 w-4" />,
    items: [
      { method: "GET", path: "/client/subscription", desc: "Данные подписки из Remna", auth: "Client JWT" },
      { method: "GET", path: "/client/devices", desc: "Устройства (HWID)", auth: "Client JWT" },
      { method: "GET", path: "/client/proxy-slots", desc: "Активные прокси слоты", auth: "Client JWT" },
      { method: "GET", path: "/client/singbox-slots", desc: "Активные sing-box слоты", auth: "Client JWT" },
    ]
  },
  {
    category: "Публичные данные",
    icon: <BookOpen className="h-4 w-4" />,
    items: [
      { method: "GET", path: "/tariffs", desc: "Список VPN тарифов", auth: "API Key" },
      { method: "GET", path: "/proxy-tariffs", desc: "Список прокси тарифов", auth: "API Key" },
      { method: "GET", path: "/singbox-tariffs", desc: "Список sing-box тарифов", auth: "API Key" },
      { method: "GET", path: "/config", desc: "Публичная конфигурация проекта", auth: "API Key" },
    ]
  }
];

export function ApiDocsPage() {
  const [tab, setTab] = useState("endpoints");

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-primary/10 text-primary rounded-xl">
          <Code className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">External API v1</h1>
          <p className="text-sm text-muted-foreground">
            Документация для интеграции с мобильными приложениями и внешними сервисами
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Авторизация
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <div>
              <p className="font-medium mb-1">1. API Key (Обязательно для всех)</p>
              <p className="text-muted-foreground mb-2">Передаётся в заголовке каждого запроса.</p>
              <code className="block bg-muted/50 p-2 rounded border text-xs">X-Api-Key: sk_...</code>
            </div>
            <div>
              <p className="font-medium mb-1">2. Client JWT (Для клиентских данных)</p>
              <p className="text-muted-foreground mb-2">Выдаётся при логине/регистрации. Нужен для эндпоинтов <code>/client/*</code>.</p>
              <code className="block bg-muted/50 p-2 rounded border text-xs">Authorization: Bearer &lt;client_jwt&gt;</code>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5" />
              Базовый URL
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <p className="text-muted-foreground">Все запросы отправляются на базовый URL вашего сервера:</p>
            <code className="block bg-muted/50 p-3 rounded border text-sm font-mono text-primary">
              {base}
            </code>
            <div className="pt-2">
              <p className="font-medium mb-1">Формат данных</p>
              <p className="text-muted-foreground">Все запросы и ответы используют <code>application/json</code>.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="endpoints">Эндпоинты</TabsTrigger>
          <TabsTrigger value="examples">Примеры (cURL)</TabsTrigger>
        </TabsList>
        
        <TabsContent value="endpoints" className="mt-6 space-y-6">
          {endpoints.map((category, i) => (
            <Card key={i} className="shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  {category.icon}
                  {category.category}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {category.items.map((item, j) => (
                    <div key={j} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-muted/10 transition-colors">
                      <div className="flex items-center gap-3 min-w-[240px]">
                        <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded text-xs font-semibold w-16 ${item.method === "GET" ? "bg-secondary text-secondary-foreground" : item.method === "POST" ? "bg-primary text-primary-foreground" : "border bg-transparent"}`}>
                          {item.method}
                        </span>
                        <code className="text-sm font-semibold">{item.path}</code>
                      </div>
                      <div className="flex-1 text-sm text-muted-foreground">
                        {item.desc}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                        {item.auth}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="examples" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Логин клиента</CardTitle>
              <CardDescription>Получение Client JWT по email и паролю</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X POST ${base}/auth/login \\
  -H "X-Api-Key: sk_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com",
    "password": "secret_password"
  }'`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Получение профиля</CardTitle>
              <CardDescription>Запрос данных авторизованного клиента</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto rounded-lg border bg-zinc-950 text-zinc-50 p-4 font-mono">
{`curl -X GET ${base}/client/profile \\
  -H "X-Api-Key: sk_your_api_key_here" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
