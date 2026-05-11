const DEFAULT_CURRENCY_FORMAT = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: string | number | null | undefined, fallback = "0.00") {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return fallback;
  return DEFAULT_CURRENCY_FORMAT.format(numeric);
}

export function formatMoneyWithSymbol(
  value: string | number | null | undefined,
  symbol = "USDT",
  fallback = "0.00"
) {
  return `${formatMoney(value, fallback)} ${symbol}`;
}
