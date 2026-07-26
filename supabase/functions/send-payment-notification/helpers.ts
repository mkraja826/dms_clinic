export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_ENDPOINT =
  "https://exp.host/--/api/v2/push/getReceipts";

export function truncateError(value: unknown, maxLength = 800) {
  const message = value instanceof Error
    ? value.message
    : typeof value === "string"
    ? value
    : JSON.stringify(value);
  return String(message ?? "Unknown error").slice(0, maxLength);
}

export function retryAt(attempts: number, now = Date.now()) {
  const boundedAttempt = Math.min(Math.max(attempts, 1), 8);
  const delayMinutes = Math.min(2 ** boundedAttempt, 60);
  return new Date(now + delayMinutes * 60_000).toISOString();
}

export function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function formatPaymentAmount(
  amount: number,
  currencyCode: string | null | undefined,
) {
  const currency = /^[A-Z]{3}$/.test(currencyCode ?? "")
    ? String(currencyCode)
    : "INR";

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function isInvalidExpoTokenError(code: unknown) {
  return code === "DeviceNotRegistered";
}

export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value)
  );
}
