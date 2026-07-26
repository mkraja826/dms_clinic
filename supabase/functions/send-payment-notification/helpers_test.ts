import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chunk,
  formatPaymentAmount,
  isExpoPushToken,
  isInvalidExpoTokenError,
  retryAt,
  truncateError,
} from "./helpers.ts";

Deno.test("chunks Expo messages without dropping devices", () => {
  const input = Array.from({ length: 205 }, (_, index) => index);
  const result = chunk(input, 100);
  assertEquals(result.map((part) => part.length), [100, 100, 5]);
  assertEquals(result.flat(), input);
});

Deno.test("uses bounded retry backoff", () => {
  const baseline = Date.UTC(2026, 6, 27, 10, 0, 0);
  assertEquals(
    retryAt(1, baseline),
    new Date(baseline + 2 * 60_000).toISOString(),
  );
  assertEquals(
    retryAt(20, baseline),
    new Date(baseline + 60 * 60_000).toISOString(),
  );
});

Deno.test("validates Expo push-token formats", () => {
  assertEquals(isExpoPushToken("ExpoPushToken[abc_123-XYZ]"), true);
  assertEquals(isExpoPushToken("ExponentPushToken[abc_123-XYZ]"), true);
  assertEquals(isExpoPushToken("not-a-token"), false);
});

Deno.test("recognizes terminal unregistered devices", () => {
  assertEquals(isInvalidExpoTokenError("DeviceNotRegistered"), true);
  assertEquals(isInvalidExpoTokenError("MessageTooBig"), false);
});

Deno.test("formats money and bounds stored errors", () => {
  assertMatch(formatPaymentAmount(1234.5, "INR"), /1,234\.50/);
  assertEquals(truncateError("abcdef", 4), "abcd");
});
