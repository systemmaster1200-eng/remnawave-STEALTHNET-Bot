import type { TFunction } from "i18next";

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

const PLATEGA_METHOD_KEYS: Record<number, string> = {
  2: "sbp",
  3: "erip",
  11: "card_acquiring",
  12: "international",
  13: "crypto",
};

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  cryptopay: "cryptopay",
  heleket: "heleket",
  yookassa: "yookassa",
  yoomoney: "yoomoney",
  lava: "lava",
  lavatop: "lavatop",
  overpay: "overpay",
};

const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  "юкassa (сбп / карты)": "yookassa",
  "юkassa (сбп / карты)": "yookassa",
  "yookassa (сбп / карты)": "yookassa",
  "yookassa (sbp / cards)": "yookassa",
  "юmoney (карты)": "yoomoney",
  "yoomoney (карты)": "yoomoney",
  "yoomoney (cards)": "yoomoney",
  "lava (сбп / карты / сберpay)": "lava",
  "lava (sbp / cards / sberpay)": "lava",
  "lavatop (сбп / карты)": "lavatop",
  "lava.top (сбп / карты)": "lavatop",
  "lava.top (sbp / cards)": "lavatop",
  "overpay (карты / сбп)": "overpay",
  "overpay (cards / sbp)": "overpay",
};

const KNOWN_PLATEGA_LABELS: Record<string, string> = {
  "сбп": "sbp",
  "спб": "sbp",
  "сбп (qr-код)": "sbp",
  "sbp": "sbp",
  "sbp (qr code)": "sbp",
  "карты": "card_acquiring",
  "карточный эквайринг": "card_acquiring",
  "cards": "card_acquiring",
  "card acquiring": "card_acquiring",
  "международный": "international",
  "международная оплата": "international",
  "international": "international",
  "international payment": "international",
  "криптовалюта": "crypto",
  "crypto": "crypto",
  "cryptocurrency": "crypto",
};

export function localizePlategaMethodLabel(t: TFunction, method: { id: number; label: string }): string {
  const key = PLATEGA_METHOD_KEYS[method.id] ?? KNOWN_PLATEGA_LABELS[normalizeLabel(method.label)];
  return key ? t(`cabinet.payment_labels.platega_${key}`) : method.label;
}

export function localizePaymentProviderLabel(t: TFunction, id: string, label: string): string {
  const key = PROVIDER_LABEL_KEYS[id] ?? KNOWN_PROVIDER_LABELS[normalizeLabel(label)];
  return key ? t(`cabinet.payment_labels.provider_${key}`) : label;
}
