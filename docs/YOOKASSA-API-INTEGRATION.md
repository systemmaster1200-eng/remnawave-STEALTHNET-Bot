# Интеграция ЮKassa API (YooKassa)

Документация API: [Справочник API ЮKassa](https://yookassa.ru/developers/api).

В проекте уже есть два способа оплаты, связанных с ЮMoney:
- **ЮMoney кошелёк** (OAuth + request-payment/process-payment) — пополнение/оплата с кошелька пользователя.
- **ЮMoney форма** (`yoomoney_form`) — редирект на `yoomoney.ru/quickpay/confirm.xml`, HTTP-уведомления с `sha1_hash`.

**ЮKassa API** — отдельный приём платежей картой и другими способами через API магазина (shop_id + secret key). Ниже — выжимка по API и план добавления в STEALTHNET.

---

## 1. Создание платежа (Create payment)

**Ссылка:** [Create a payment](https://yookassa.ru/developers/api#create_payment)

- **Метод:** `POST https://api.yookassa.ru/v3/payments`
- **Аутентификация:** HTTP Basic Auth  
  - **Username:** ID магазина (Shop ID) из личного кабинета ЮKassa  
  - **Password:** секретный ключ (Secret key)
- **Заголовки:**  
  - `Content-Type: application/json`  
  - `Idempotence-Key: <уникальная строка>` — ключ идемпотентности (обязателен для POST)
- **Тело запроса (JSON):**
  - `amount` — объект `{ "value": "100.00", "currency": "RUB" }` (сумма в формате строки с точкой)
  - `capture: true` — автоматическое списание (без двухстадийного подтверждения)
  - `confirmation` — способ подтверждения:
    - для редиректа на страницу оплаты ЮKassa:  
      `{ "type": "redirect", "return_url": "https://your-site.com/cabinet?yookassa=success" }`
  - `description` — описание платежа (до 128 символов), показывается пользователю и в ЛК
  - `metadata` — произвольные пары ключ-значение (например `payment_id` — наш ID платежа в БД)

**Ответ (201):** объект платежа (Payment object):
- `id` — ID платежа в ЮKassa
- `status` — `pending`, далее `waiting_for_capture` / `succeeded` / `canceled`
- `amount` — `{ value, currency }`
- `confirmation.confirmation_url` — URL для редиректа пользователя на оплату
- `metadata` — переданные данные

Для сценария «оплата тарифа/пополнение» достаточно создать платёж и отдать клиенту `confirmation_url` для редиректа.

---

## 2. Объект платежа (Payment object)

**Ссылка:** [Payment object](https://yookassa.ru/developers/api#payment_object)

Основные поля:
- `id` — идентификатор платежа в ЮKassa
- `status` — `pending` | `waiting_for_capture` | `succeeded` | `canceled`
- `amount` — `{ value: string, currency: string }`
- `metadata` — объект с переданными при создании данными (наш `payment_id` и т.д.)
- `confirmation` — при `type: "redirect"` есть `confirmation_url`
- `created_at` — дата создания (ISO 8601)

Для активации тарифа/пополнения баланса используем событие `payment.succeeded` в webhook и `metadata.payment_id` для поиска записи в нашей БД.

---

## 3. Способы оплаты (Payment method)

**Ссылка:** [Payment method](https://yookassa.ru/developers/api#payment_method)

При создании платежа можно не указывать конкретный способ — пользователь выберет его на странице ЮKassa (карта, ЮMoney, СБП и т.д.). При необходимости можно ограничить способы через параметр `payment_method_data` или настройки в личном кабинете ЮKassa.

Для минимальной интеграции достаточно создания платежа с `confirmation.type: "redirect"` без указания способа оплаты.

---

## 4. Уведомления (Webhook)

**Ссылка:** [Входящие уведомления](https://yookassa.ru/developers/using-api/webhooks)

- **Настройка:** в [личном кабинете ЮKassa](https://yookassa.ru/my/http-notifications-settings) в разделе «Интеграция — HTTP-уведомления» указывается URL (HTTPS, порт 443/8443) и включаются нужные события.
- **События для приёма платежей:**
  - `payment.succeeded` — платёж успешно завершён (основное для активации тарифа/пополнения)
  - `payment.canceled` — платёж отменён
  - `payment.waiting_for_capture` — платёж ожидает подтверждения (при двухстадийной оплате)
- **Формат запроса:** POST на ваш URL, тело — **JSON** (не form-urlencoded):
  - `type` — тип уведомления (например `notification`)
  - `event` — событие: `payment.succeeded`, `payment.canceled` и т.д.
  - `object` — объект платежа (как в API): `id`, `status`, `amount`, `metadata` и др.

**Важно:** ответ на webhook должен быть **200 OK** в течение короткого времени; обработку (активация тарифа, начисление баланса) лучше делать асинхронно после быстрого ответа или проверки подписи (если ЮKassa её предоставляет).

Проверка подлинности: в документации указано, что для HTTP Basic Auth уведомления настраиваются в ЛК; при необходимости нужно уточнить в [документации](https://yookassa.ru/developers/using-api/webhooks) наличие подписи тела запроса (аналог `sha1_hash` у старого ЮMoney).

---

## 5. Отличия от текущей интеграции ЮMoney в проекте

| Аспект | Текущее (ЮMoney форма / кошелёк) | ЮKassa API |
|--------|----------------------------------|------------|
| Назначение | QuickPay-форма или оплата с кошелька | Приём платежей картой и др. через API магазина |
| Аутентификация | Кошелёк получателя + HTTP secret для уведомлений | Shop ID + Secret key (HTTP Basic) |
| Создание платежа | Форма с `receiver`, `sum`, `label` → редирект на quickpay | POST /v3/payments → `confirmation_url` |
| Webhook | application/x-www-form-urlencoded, проверка sha1_hash | JSON, события payment.succeeded и др. |
| Provider в БД | `yoomoney_form`, `yoomoney` | Предлагается `yookassa` |

ЮKassa API и текущая ЮMoney-интеграция могут сосуществовать: разный `provider` в таблице `Payment`, отдельные настройки (shop_id/secret для ЮKassa, существующие для ЮMoney).

---

## 6. План добавления ЮKassa в STEALTHNET

1. **Настройки (SystemSetting):**
   - `yookassa_shop_id` — ID магазина
   - `yookassa_secret_key` — секретный ключ
   - Флаг включения (например через существующий раздел «Платежи» или отдельный `yookassa_enabled`).

2. **Backend:**
   - **Модуль** `backend/src/modules/yookassa/yookassa.service.ts`:
     - Функция создания платежа: POST `/v3/payments` с HTTP Basic (shop_id, secret), телом с `amount`, `capture: true`, `confirmation: { type: "redirect", return_url }`, `description`, `metadata: { payment_id }`.
     - Возврат `{ id, confirmation_url, status }` или ошибки.
   - **Клиентские маршруты** (`client.routes.ts`):
     - POST создание платежа ЮKassa для тарифа (аналогично Platega): создаём запись `Payment` (provider: `yookassa`), вызываем yookassa.service → создание платежа в ЮKassa, в `metadata` передаём наш `payment.id`, в ответ клиенту отдаём `confirmation_url` для редиректа.
     - Аналогично для пополнения баланса (без tariffId).
   - **Webhook** `backend/src/modules/webhooks/yookassa.webhooks.routes.ts`:
     - POST `/api/webhooks/yookassa` — парсинг JSON, проверка `event === "payment.succeeded"`, извлечение `object.metadata.payment_id`, поиск платежа в БД по `id` и `provider: "yookassa"`. При статусе PENDING: обновление на PAID, вызов `activateTariffByPaymentId` или зачисление на баланс, затем `distributeReferralRewards`. Ответ 200 OK.

3. **Frontend:**
   - В настройках: поля для Shop ID и Secret key ЮKassa, включение/выключение.
   - В публичном конфиге для кабинета: флаг `yookassaEnabled`.
   - На странице тарифов и пополнения: при выборе «Оплатить картой ЮKassa» запрос на создание платежа и редирект на `confirmation_url`.

4. **Бот:** при `yookassaEnabled` показывать кнопку оплаты через ЮKassa (редирект в браузер или Mini App на `confirmation_url`).

5. **Отчёт по продажам:** в фильтре по провайдеру добавить `yookassa`.

После реализации в ЛК ЮKassa нужно указать URL webhook:  
`https://<ваш-домен>/api/webhooks/yookassa` и включить события `payment.succeeded` (и при необходимости `payment.canceled`).

---

## Ссылки

- [Справочник API ЮKassa](https://yookassa.ru/developers/api)
- [Создание платежа](https://yookassa.ru/developers/api#create_payment)
- [Объект платежа](https://yookassa.ru/developers/api#payment_object)
- [Способы оплаты](https://yookassa.ru/developers/api#payment_method)
- [Входящие уведомления (webhook)](https://yookassa.ru/developers/using-api/webhooks)
- [Формат взаимодействия (auth, idempotence)](https://yookassa.ru/developers/using-api/interaction-format)
- [Быстрый старт](https://yookassa.ru/developers/payment-acceptance/getting-started/quick-start)
