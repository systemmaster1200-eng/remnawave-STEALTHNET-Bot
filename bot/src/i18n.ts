/**
 * Bot i18n module.
 * Russian defaults are hardcoded. Other languages are loaded from the backend API
 * via publicConfig.translations and stored in memory.
 */

export const RU: Record<string, string> = {
  "back_to_menu": "🏠 Главное меню",
  "back": "◀️ Назад",
  "cancel": "Отмена",
  "cancel_button": "◀️ Отмена",
  "error_generic": "Ошибка",
  "unknown_error": "Неизвестная ошибка",
  "auth_failed": "Не удалось авторизоваться. Отправьте /start",
  "auth_error_start": "❌ Ошибка авторизации. Отправьте /start",

  "subscribe.channel_button": "📢 Подписаться на канал",
  "subscribe.check_button": "✅ Я подписался",
  "subscribe.default_message": "Для использования бота подпишитесь на наш канал:",
  "subscribe.cannot_verify": "Проверка подписки сейчас недоступна. Сообщите администратору: бот должен быть администратором канала, а в настройках должен быть указан корректный ID или @username.",
  "subscribe.not_subscribed": "❌ Вы ещё не подписались на канал",
  "subscribe.confirmed": "✅ Подписка подтверждена!",
  "subscribe.send_start": "Отлично! Отправьте /start чтобы открыть меню.",

  "menu.btn_tariffs": "📦 Тарифы",
  "menu.btn_proxy": "🌐 Прокси",
  "menu.btn_my_proxy": "📋 Мои прокси",
  "menu.btn_singbox": "🔑 Доступы",
  "menu.btn_my_singbox": "📋 Мои доступы",
  "menu.btn_profile": "👤 Профиль",
  "menu.btn_devices": "📱 Устройства",
  "menu.btn_topup": "💳 Пополнить баланс",
  "menu.btn_referral": "👥 Реферальная программа",
  "menu.btn_trial": "🎁 Бесплатный Тест",
  "menu.btn_vpn": "🌐 Подключиться к VPN",
  "menu.btn_cabinet": "🌐 Web Кабинет",
  "menu.btn_tickets": "🎫 Тикеты",
  "menu.btn_support": "⭕ Помощь",
  "menu.btn_promocode": "🎟️ Промокод",
  "menu.btn_extra_options": "➕ Доп. опции",
  "menu.btn_admin_panel": "⚙️ Панель админа",
  "menu.choose_action": "Выберите действие:",
  "menu.tariff_not_selected": "Тариф не выбран",

  "day.one": "день",
  "day.few": "дня",
  "day.many": "дней",

  "tariffs.not_configured": "Тарифы пока не настроены.",
  "tariffs.choose_category": "Тарифы\n\nВыберите категорию:",
  "tariffs.category_not_found": "Категория не найдена.",
  "tariffs.tariff_not_found": "Тариф не найден.",
  "tariffs.traffic_unlimited": "трафик без лимита",
  "tariffs.traffic_limit": "трафик {{gb}} GB",
  "tariffs.devices_unlimited": "устройства без лимита",
  "tariffs.devices_limit": "устройства {{count}}",
  "tariffs.reset_on_purchase": "сброс при покупке",
  "tariffs.reset_monthly": "сброс ежемесячно",
  "tariffs.reset_monthly_rolling": "скользящий месяц",

  "proxy.not_configured": "Тарифы прокси пока не настроены.",
  "proxy.choose_category": "🌐 Прокси\n\nВыберите категорию:",
  "proxy.no_active": "📋 Мои прокси\n\nУ вас пока нет активных прокси. Купите тариф в разделе «Прокси».",
  "proxy.copy_hint": "Скопируйте строку в настройки прокси приложения.",

  "singbox.not_configured": "Тарифы доступов пока не настроены.",
  "singbox.choose_category": "🔑 Доступы\n\nВыберите категорию:",
  "singbox.no_active": "У вас пока нет активных доступов. Купите тариф в разделе «Доступы».",
  "singbox.copy_hint": "Скопируйте ссылку в приложение (v2rayN, Nekoray и др.):",

  "topup.unavailable": "Пополнение временно недоступно.",
  "topup.title": "Пополнить баланс\n\nВыберите сумму или введите свою (числом):",
  "topup.invalid_amount": "Неверная сумма.",
  "topup.description": "Пополнение баланса",

  "payment.choose_method": "Выберите способ оплаты:",
  "payment.click_to_pay": "Нажмите для оплаты:",
  "payment.click_to_pay_button": "Нажмите кнопку ниже для оплаты:",
  "payment.invalid_method": "Неверный способ оплаты.",
  "payment.error_payment": "Ошибка оплаты",
  "payment.error_create": "Ошибка создания платежа",
  "payment.btn_pay": "💳 Оплатить",
  "payment.btn_yoomoney_card": "💳 ЮMoney — оплата картой",
  "payment.btn_yoomoney_short": "💳 ЮMoney — карта",
  "payment.btn_yookassa": "💳 ЮKassa — карта / СБП",
  "payment.btn_cryptopay": "💳 Crypto Bot — криптовалюта",
  "payment.btn_yookassa_fallback": "💳 Оплата (ЮKassa)",
  "payment.rub_only": "ЮKassa принимает только рубли (RUB).",

  "trial.error_activation": "Ошибка активации",

  "referral.link_unavailable": "Реферальная ссылка недоступна.",
  "referral.title": "Реферальная программа",
  "referral.description": "Поделитесь ссылкой с друзьями и получайте процент от их пополнений!",
  "referral.how_it_works": "Как это работает:",
  "referral.level1": "1 уровень — {{percent}}% от пополнений тех, кто перешёл по вашей ссылке.",
  "referral.level2": "2 уровень — {{percent}}% от пополнений рефералов ваших рефералов.",
  "referral.level3": "3 уровень — {{percent}}% от пополнений рефералов второго уровня.",
  "referral.earnings_info": "Начисления зачисляются на ваш баланс и могут быть использованы для оплаты тарифов.",
  "referral.your_links": "Ваши ссылки:",
  "referral.site": "Сайт:",
  "referral.bot": "Бот:",

  "profile.title": "Профиль",
  "profile.balance": "Баланс: ",
  "profile.lang": "Язык: ",
  "profile.currency": "Валюта: ",
  "profile.autorenew": "Автопродление с баланса: ",
  "profile.autorenew_on": "Включено ✅",
  "profile.autorenew_off": "Отключено ❌",
  "profile.change": "Изменить:",
  "profile.choose_lang": "Выберите язык:",
  "profile.lang_changed": "Язык изменён на {{lang}}",
  "profile.choose_currency": "Выберите валюту:",
  "profile.currency_changed": "Валюта изменена на {{currency}}",
  "profile.btn_autorenew_on": "♻️ Автопродление: ВКЛ",
  "profile.btn_autorenew_off": "♻️ Автопродление: ОТКЛ",
  "profile.btn_lang": "🌐 Язык",
  "profile.btn_currency": "💱 Валюта",

  "devices.title": "📱 Устройства",
  "devices.no_devices": "📱 Устройства\n\nПривязанных устройств пока нет. Подключитесь к VPN с приложения — устройство появится здесь. Удалять можно старые устройства, чтобы освободить слот для нового.",
  "devices.delete_hint": "📱 Устройства\n\nУдалите устройство, чтобы привязать другое (освободится слот):",
  "devices.btn_delete": "🗑 Удалить: {{label}}",
  "devices.session_expired": "Сессия истекла. Откройте «Устройства» снова.",
  "devices.deleted": "✅ Устройство удалено.",

  "vpn.link_unavailable": "Ссылка на VPN недоступна. Оформите подписку.",
  "vpn.connect_title": "Подключиться к VPN",
  "vpn.connect_hint": "Нажмите кнопку ниже — откроется страница подключения.",
  "vpn.btn_open_page": "📲 Открыть страницу подключения",

  "support.not_configured": "Раздел поддержки не настроен.",
  "support.title": "🆘 Поддержка\n\nВыберите раздел:",
  "support.btn_tech": "👤 Тех поддержка",
  "support.btn_agreement": "📜 Соглашения",
  "support.btn_offer": "📄 Оферта",
  "support.btn_instructions": "📋 Инструкции",
  "support.btn_video_instructions": "📹 Видео-инструкции",
  "support.video_not_added": "Инструкции пока не добавлены.",
  "support.video_title": "📹 Видео-инструкции\n\nВыберите инструкцию:",
  "support.video_not_found": "Инструкция не найдена.",
  "support.video_back": "« Назад к инструкциям",
  "support.video_send_error": "Не удалось отправить видео. Попробуйте позже.",
  "support.btn_main_menu": "🏠 Главное меню",

  "options.not_available": "Доп. опции пока не доступны. Оформите подписку в разделе «Тарифы».",
  "options.title": "Доп. опции\n\nТрафик, устройства или серверы — докупка к подписке. Выберите опцию:",
  "options.not_found": "Опция не найдена.",

  "promo.enter_title": "🎟️ Введите промокод\n\nОтправьте промокод сообщением в этот чат.",
  "promo.empty_code": "❌ Промокод не может быть пустым.",
  "promo.discount_applied": "Скидка будет автоматически применена при следующей оплате тарифа.",

  "auth.invalid_link": "❌ Некорректная ссылка авторизации.",
  "auth.confirmed": "✅ Авторизация подтверждена! Вернитесь на сайт — вход выполнится автоматически.",
  "auth.expired": "⏰ Ссылка авторизации истекла. Попробуйте снова на сайте.",
  "auth.already_used": "ℹ️ Эта ссылка уже была использована. Попробуйте снова на сайте.",

  "link.prompt": "Отправьте код из кабинета на сайте.\nПример: /link 123456",
  "link.success": "✅ Telegram успешно привязан к вашему аккаунту. Теперь вы можете входить через бота.",

  "admin.panel_title": "⚙️ Панель админа\n\nВыберите раздел:",
  "admin.access_denied": "Доступ запрещён",
  "admin.btn_stats": "📊 Статистика",
  "admin.btn_notifications": "🔔 Уведомления",
  "admin.btn_clients": "👥 Клиенты",
  "admin.btn_search": "🔍 Поиск пользователя",
  "admin.btn_pending_payments": "💳 Ожидают оплаты",
  "admin.btn_last_payments": "💰 Последние платежи",
  "admin.btn_broadcast": "📢 Рассылка",
  "admin.btn_back_to_admin": "◀️ В админку",
  "admin.btn_forward": "Вперёд ▶",
  "admin.btn_backward": "◀ Назад",
  "admin.page_label": "Стр.",
  "admin.search.title": "🔍 Поиск пользователя\n\nВведите Telegram ID, @username или email:",
  "admin.search.error": "Ошибка поиска",
  "admin.stats.title": "📊 Статистика",
  "admin.stats.users": "👥 Пользователи",
  "admin.clients.title": "👥 Клиенты",
  "admin.clients.btn_block": "🚫 Заблокировать",
  "admin.clients.btn_unblock": "✅ Разблокировать",
  "admin.clients.btn_topup": "💵 Пополнить баланс",
  "admin.notifications.title": "🔔 Настройки уведомлений",
  "admin.broadcast.title": "📢 Рассылка",
  "admin.broadcast.prompt": "Отправьте текст сообщения или фото с подписью (caption):",
  "admin.broadcast.completed": "✅ Рассылка завершена.",
  "admin.broadcast.btn_tg_only": "📱 Только Telegram",
  "admin.broadcast.btn_email_only": "📧 Только Email",
  "admin.broadcast.btn_both": "📱+📧 Telegram и Email",
  "admin.video.file_id_hint": "📹 file_id видео:\n\nСкопируйте и вставьте в админку при добавлении видео-инструкции.",
};

const EN: Record<string, string> = {
  "back_to_menu": "◀️ Back to menu",
  "back": "◀️ Back",
  "cancel": "Cancel",
  "cancel_button": "◀️ Cancel",
  "error_generic": "Error",
  "unknown_error": "Unknown error",
  "auth_failed": "Authentication failed. Send /start",
  "auth_error_start": "❌ Authorization error. Send /start",

  "subscribe.channel_button": "📢 Subscribe to channel",
  "subscribe.check_button": "✅ I subscribed",
  "subscribe.default_message": "To use the bot, subscribe to our channel:",
  "subscribe.cannot_verify": "Subscription verification is currently unavailable. Notify the administrator: the bot must be an admin of the channel, and the settings must contain a correct ID or @username.",
  "subscribe.not_subscribed": "❌ You haven't subscribed to the channel yet",
  "subscribe.confirmed": "✅ Subscription confirmed!",
  "subscribe.send_start": "Great! Send /start to open the menu.",

  "menu.btn_tariffs": "📦 Plans",
  "menu.btn_proxy": "🌐 Proxy",
  "menu.btn_my_proxy": "📋 My Proxies",
  "menu.btn_singbox": "🔑 Access Keys",
  "menu.btn_my_singbox": "📋 My Access Keys",
  "menu.btn_profile": "👤 Profile",
  "menu.btn_devices": "📱 Devices",
  "menu.btn_topup": "💳 Top Up Balance",
  "menu.btn_referral": "🔗 Referral Program",
  "menu.btn_trial": "🎁 Free Trial",
  "menu.btn_vpn": "🌐 Connect to VPN",
  "menu.btn_cabinet": "🌐 Web Dashboard",
  "menu.btn_tickets": "🎫 Tickets",
  "menu.btn_support": "⭕ Help",
  "menu.btn_promocode": "🎟️ Promo Code",
  "menu.btn_extra_options": "➕ Extra Options",
  "menu.btn_admin_panel": "⚙️ Admin Panel",
  "menu.choose_action": "Choose an action:",
  "menu.tariff_not_selected": "No plan selected",

  "day.one": "day",
  "day.few": "days",
  "day.many": "days",

  "tariffs.not_configured": "Plans are not configured yet.",
  "tariffs.choose_category": "Plans\n\nChoose a category:",
  "tariffs.category_not_found": "Category not found.",
  "tariffs.tariff_not_found": "Plan not found.",
  "tariffs.traffic_unlimited": "unlimited traffic",
  "tariffs.traffic_limit": "traffic {{gb}} GB",
  "tariffs.devices_unlimited": "unlimited devices",
  "tariffs.devices_limit": "devices {{count}}",
  "tariffs.reset_on_purchase": "reset on purchase",
  "tariffs.reset_monthly": "reset monthly",
  "tariffs.reset_monthly_rolling": "rolling month",

  "proxy.not_configured": "Proxy plans are not configured yet.",
  "proxy.choose_category": "🌐 Proxy\n\nChoose a category:",
  "proxy.no_active": "📋 My Proxies\n\nYou don't have any active proxies yet. Purchase a plan in the Proxy section.",
  "proxy.copy_hint": "Copy the string to your application's proxy settings.",

  "singbox.not_configured": "Access plans are not configured yet.",
  "singbox.choose_category": "🔑 Access Keys\n\nChoose a category:",
  "singbox.no_active": "You don't have any active access keys yet. Purchase a plan in the Access Keys section.",
  "singbox.copy_hint": "Copy the link to an app (v2rayN, Nekoray, etc.):",

  "topup.unavailable": "Top-up is temporarily unavailable.",
  "topup.title": "Top Up Balance\n\nChoose an amount or enter your own (number):",
  "topup.invalid_amount": "Invalid amount.",
  "topup.description": "Balance top-up",

  "payment.choose_method": "Choose a payment method:",
  "payment.click_to_pay": "Click to pay:",
  "payment.click_to_pay_button": "Click the button below to pay:",
  "payment.invalid_method": "Invalid payment method.",
  "payment.error_payment": "Payment error",
  "payment.error_create": "Error creating payment",
  "payment.btn_pay": "💳 Pay",
  "payment.btn_yoomoney_card": "💳 YooMoney — card payment",
  "payment.btn_yoomoney_short": "💳 YooMoney — card",
  "payment.btn_yookassa": "💳 YooKassa — card / SBP",
  "payment.btn_cryptopay": "💳 Crypto Bot — cryptocurrency",
  "payment.btn_yookassa_fallback": "💳 Payment (YooKassa)",
  "payment.rub_only": "YooKassa accepts only rubles (RUB).",

  "trial.error_activation": "Activation error",

  "referral.link_unavailable": "Referral link is unavailable.",
  "referral.title": "Referral Program",
  "referral.description": "Share the link with friends and earn a percentage of their top-ups!",
  "referral.how_it_works": "How it works:",
  "referral.level1": "Level 1 — {{percent}}% of top-ups from those who used your link.",
  "referral.level2": "Level 2 — {{percent}}% of top-ups from your referrals' referrals.",
  "referral.level3": "Level 3 — {{percent}}% of top-ups from second-level referrals.",
  "referral.earnings_info": "Earnings are credited to your balance and can be used to pay for plans.",
  "referral.your_links": "Your links:",
  "referral.site": "Website:",
  "referral.bot": "Bot:",

  "profile.title": "Profile",
  "profile.balance": "Balance: ",
  "profile.lang": "Language: ",
  "profile.currency": "Currency: ",
  "profile.autorenew": "Auto-renew from balance: ",
  "profile.autorenew_on": "Enabled ✅",
  "profile.autorenew_off": "Disabled ❌",
  "profile.change": "Change:",
  "profile.choose_lang": "Choose language:",
  "profile.lang_changed": "Language changed to {{lang}}",
  "profile.choose_currency": "Choose currency:",
  "profile.currency_changed": "Currency changed to {{currency}}",
  "profile.btn_autorenew_on": "♻️ Auto-renew: ON",
  "profile.btn_autorenew_off": "♻️ Auto-renew: OFF",
  "profile.btn_lang": "🌐 Language",
  "profile.btn_currency": "💱 Currency",

  "devices.title": "📱 Devices",
  "devices.no_devices": "📱 Devices\n\nNo linked devices yet. Connect to VPN from an app — the device will appear here. You can remove old devices to free a slot for a new one.",
  "devices.delete_hint": "📱 Devices\n\nDelete a device to link another one (frees a slot):",
  "devices.btn_delete": "🗑 Delete: {{label}}",
  "devices.session_expired": "Session expired. Open Devices again.",
  "devices.deleted": "✅ Device deleted.",

  "vpn.link_unavailable": "VPN link is unavailable. Get a subscription.",
  "vpn.connect_title": "Connect to VPN",
  "vpn.connect_hint": "Click the button below — the connection page will open.",
  "vpn.btn_open_page": "📲 Open connection page",

  "support.not_configured": "Support section is not configured.",
  "support.title": "🆘 Support\n\nChoose a section:",
  "support.btn_tech": "👤 Tech Support",
  "support.btn_agreement": "📜 Agreements",
  "support.btn_offer": "📄 Terms of Service",
  "support.btn_instructions": "📋 Instructions",
  "support.btn_video_instructions": "📹 Video Instructions",
  "support.video_not_added": "Instructions not added yet.",
  "support.video_title": "📹 Video Instructions\n\nChoose an instruction:",
  "support.video_not_found": "Instruction not found.",
  "support.video_back": "« Back to instructions",
  "support.video_send_error": "Failed to send video. Try again later.",
  "support.btn_main_menu": "🏠 Main Menu",

  "options.not_available": "Extra options are not available yet. Get a subscription in the Plans section.",
  "options.title": "Extra Options\n\nTraffic, devices, or servers — add-on to subscription. Choose an option:",
  "options.not_found": "Option not found.",

  "promo.enter_title": "🎟️ Enter Promo Code\n\nSend the promo code as a message in this chat.",
  "promo.empty_code": "❌ Promo code cannot be empty.",
  "promo.discount_applied": "The discount will be automatically applied to your next plan payment.",

  "auth.invalid_link": "❌ Invalid authorization link.",
  "auth.confirmed": "✅ Authorization confirmed! Return to the website — login will happen automatically.",
  "auth.expired": "⏰ Authorization link has expired. Try again on the website.",
  "auth.already_used": "ℹ️ This link has already been used. Try again on the website.",

  "link.prompt": "Send the code from your dashboard on the website.\nExample: /link 123456",
  "link.success": "✅ Telegram successfully linked to your account. You can now log in via the bot.",

  "admin.panel_title": "⚙️ Admin Panel\n\nChoose a section:",
  "admin.access_denied": "Access denied",
  "admin.btn_stats": "📊 Statistics",
  "admin.btn_notifications": "🔔 Notifications",
  "admin.btn_clients": "👥 Clients",
  "admin.btn_search": "🔍 Search User",
  "admin.btn_pending_payments": "💳 Pending Payments",
  "admin.btn_last_payments": "💰 Recent Payments",
  "admin.btn_broadcast": "📢 Broadcast",
  "admin.btn_back_to_admin": "◀️ Back to admin",
  "admin.btn_forward": "Forward ▶",
  "admin.btn_backward": "◀ Back",
  "admin.page_label": "Page",
  "admin.search.title": "🔍 Search User\n\nEnter Telegram ID, @username, or email:",
  "admin.search.error": "Search error",
  "admin.stats.title": "📊 Statistics",
  "admin.stats.users": "👥 Users",
  "admin.clients.title": "👥 Clients",
  "admin.clients.btn_block": "🚫 Block",
  "admin.clients.btn_unblock": "✅ Unblock",
  "admin.clients.btn_topup": "💵 Top Up Balance",
  "admin.notifications.title": "🔔 Notification Settings",
  "admin.broadcast.title": "📢 Broadcast",
  "admin.broadcast.prompt": "Send message text or a photo with caption:",
  "admin.broadcast.completed": "✅ Broadcast completed.",
  "admin.broadcast.btn_tg_only": "📱 Telegram only",
  "admin.broadcast.btn_email_only": "📧 Email only",
  "admin.broadcast.btn_both": "📱+📧 Telegram and Email",
  "admin.video.file_id_hint": "📹 Video file_id:\n\nCopy and paste into the admin panel when adding a video instruction.",
};

const BUILTIN_PACKS: Record<string, Record<string, string>> = { en: EN };
let _externalPacks: Record<string, Record<string, string>> = {};

export function setTranslations(translations: Record<string, Record<string, unknown>> | undefined) {
  if (!translations) { _externalPacks = {}; return; }
  const packs: Record<string, Record<string, string>> = {};
  for (const [lang, pack] of Object.entries(translations)) {
    if (lang === "ru") continue;
    const flat: Record<string, string> = {};
    flattenObj(pack, "", flat);
    packs[lang] = flat;
  }
  _externalPacks = packs;
}

function flattenObj(obj: Record<string, unknown>, prefix: string, out: Record<string, string>) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else if (typeof v === "object" && v !== null) flattenObj(v as Record<string, unknown>, key, out);
  }
}

export function t(key: string, lang = "ru", vars?: Record<string, string | number>): string {
  let val: string | undefined;
  if (lang !== "ru") {
    const extPack = _externalPacks[lang];
    if (extPack) {
      val = extPack[`bot.${key}`] ?? extPack[key];
    }
    if (!val) {
      const builtIn = BUILTIN_PACKS[lang];
      if (builtIn) val = builtIn[key];
    }
  }
  if (!val) val = RU[key] ?? key;
  if (vars) {
    for (const [vk, vv] of Object.entries(vars)) {
      val = val.split(`{{${vk}}}`).join(String(vv));
    }
  }
  return val;
}

export function formatDays(n: number, lang = "ru"): string {
  if (lang !== "ru") return `${n} ${n === 1 ? t("day.one", lang) : t("day.many", lang)}`;
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${n} ${t("day.many", lang)}`;
  if (last === 1) return `${n} ${t("day.one", lang)}`;
  if (last >= 2 && last <= 4) return `${n} ${t("day.few", lang)}`;
  return `${n} ${t("day.many", lang)}`;
}
