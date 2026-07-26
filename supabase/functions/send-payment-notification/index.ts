import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import {
  chunk,
  EXPO_PUSH_ENDPOINT,
  EXPO_RECEIPTS_ENDPOINT,
  formatPaymentAmount,
  isExpoPushToken,
  isInvalidExpoTokenError,
  retryAt,
  truncateError,
} from "./helpers.ts";

type NotificationRequest = {
  type?: string;
  table?: string;
  record?: { id?: string };
  job_id?: string;
  mode?: "dispatch" | "maintenance" | "receipts";
};

type Job = {
  id: string;
  clinic_id: string;
  payment_id: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
};

type DeviceToken = {
  id: string;
  user_id: string;
  expo_push_token: string;
};

type Delivery = {
  id: string;
  expo_push_token: string;
  status: string;
  attempt_count: number;
  device_token_id: string | null;
  expo_ticket_id: string | null;
};

type ExpoTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = requiredEnv("PAYMENT_NOTIFICATION_WEBHOOK_SECRET");
const pushEnabled =
  String(Deno.env.get("PAYMENT_PUSH_ENABLED") ?? "false").toLowerCase() ===
    "true";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function secretsMatch(actual: string | null, expected: string) {
  if (!actual) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function updateJob(
  jobId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("payment_notification_jobs")
    .update(values)
    .eq("id", jobId);
  if (error) throw error;
}

async function updateDelivery(
  deliveryId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("payment_notification_deliveries")
    .update(values)
    .eq("id", deliveryId);
  if (error) throw error;
}

async function scheduleJobRetry(job: Job, error: unknown) {
  const attempts = job.attempts + 1;
  const terminal = attempts >= 8;
  await updateJob(job.id, {
    status: terminal ? "failed" : "retry",
    attempts,
    next_attempt_at: retryAt(attempts),
    locked_at: null,
    processed_at: terminal ? new Date().toISOString() : null,
    last_error: truncateError(error),
  });
}

async function deactivateToken(
  token: Pick<DeviceToken, "id">,
  error: unknown,
) {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("device_push_tokens")
    .update({
      active: false,
      disabled_at: now,
      last_error: truncateError(error),
      updated_at: now,
    })
    .eq("id", token.id);

  if (updateError) {
    console.error(
      "Push token deactivation failed",
      token.id,
      updateError.message,
    );
  }
}

async function claimJob(jobId: string): Promise<Job | null> {
  const now = new Date().toISOString();
  const { data: candidate, error: readError } = await supabase
    .from("payment_notification_jobs")
    .select("id,clinic_id,payment_id,status,attempts,next_attempt_at")
    .eq("id", jobId)
    .maybeSingle();

  if (readError) throw readError;
  if (!candidate || !["queued", "retry"].includes(candidate.status)) {
    return null;
  }
  if (
    candidate.status === "retry" &&
    new Date(candidate.next_attempt_at).getTime() > Date.now()
  ) {
    return null;
  }

  const { data: claimed, error: claimError } = await supabase
    .from("payment_notification_jobs")
    .update({ status: "processing", locked_at: now, last_error: null })
    .eq("id", jobId)
    .in("status", ["queued", "retry"])
    .select("id,clinic_id,payment_id,status,attempts,next_attempt_at")
    .maybeSingle();

  if (claimError) throw claimError;
  return claimed as Job | null;
}

async function loadEligibleTokens(
  clinicId: string,
  collectorId: string | null,
) {
  const { data: recipients, error: recipientError } = await supabase
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .in("role", ["owner", "head_doctor"])
    .neq("id", collectorId ?? "00000000-0000-0000-0000-000000000000");

  if (recipientError) throw recipientError;
  const recipientIds = (recipients ?? []).map((recipient) => recipient.id);
  if (recipientIds.length === 0) return [] as DeviceToken[];

  const { data: tokens, error: tokenError } = await supabase
    .from("device_push_tokens")
    .select("id,user_id,expo_push_token")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .in("user_id", recipientIds);

  if (tokenError) throw tokenError;
  return (tokens ?? []).filter((token) =>
    isExpoPushToken(token.expo_push_token)
  ) as DeviceToken[];
}

async function upsertPendingDelivery(
  job: Job,
  token: DeviceToken,
  existing: Delivery | undefined,
) {
  const attemptCount = (existing?.attempt_count ?? 0) + 1;
  const { data, error } = await supabase
    .from("payment_notification_deliveries")
    .upsert(
      {
        job_id: job.id,
        clinic_id: job.clinic_id,
        recipient_user_id: token.user_id,
        device_token_id: token.id,
        expo_push_token: token.expo_push_token,
        status: "pending",
        attempt_count: attemptCount,
        error_code: null,
        error_detail: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,expo_push_token" },
    )
    .select(
      "id,expo_push_token,status,attempt_count,device_token_id,expo_ticket_id",
    )
    .single();

  if (error) throw error;
  return data as Delivery;
}

async function dispatchJob(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return { jobId, status: "already-claimed-or-not-due" };

  try {
    const [
      { data: payment, error: paymentError },
      { data: clinic, error: clinicError },
    ] = await Promise.all([
      supabase
        .from("payments")
        .select(
          "id,clinic_id,amount,collected_by,payment_category,payment_method,created_at",
        )
        .eq("id", job.payment_id)
        .eq("clinic_id", job.clinic_id)
        .maybeSingle(),
      supabase
        .from("clinics")
        .select("id,name,currency_code,payment_push_enabled")
        .eq("id", job.clinic_id)
        .maybeSingle(),
    ]);

    if (paymentError) throw paymentError;
    if (clinicError) throw clinicError;
    if (!payment || !clinic) throw new Error("Payment or clinic not found");

    if (!clinic.payment_push_enabled) {
      await updateJob(job.id, {
        status: "skipped",
        locked_at: null,
        processed_at: new Date().toISOString(),
        last_error: "Clinic payment notifications are disabled.",
      });
      return { jobId, status: "clinic-disabled" };
    }

    const tokens = await loadEligibleTokens(
      job.clinic_id,
      payment.collected_by,
    );
    if (tokens.length === 0) {
      await updateJob(job.id, {
        status: "skipped",
        locked_at: null,
        processed_at: new Date().toISOString(),
        last_error: "No eligible recipient device.",
      });
      return { jobId, status: "no-recipient" };
    }

    const { data: previous, error: previousError } = await supabase
      .from("payment_notification_deliveries")
      .select(
        "id,expo_push_token,status,attempt_count,device_token_id,expo_ticket_id",
      )
      .eq("job_id", job.id);
    if (previousError) throw previousError;

    const priorByToken = new Map<string, Delivery>(
      ((previous ?? []) as Delivery[]).map((delivery) => [
        delivery.expo_push_token,
        delivery,
      ]),
    );
    const pendingTokens = tokens.filter((token) => {
      const prior = priorByToken.get(token.expo_push_token);
      return !prior ||
        !["ticket_ok", "delivered", "invalid"].includes(prior.status);
    });

    if (pendingTokens.length === 0) {
      await updateJob(job.id, {
        status: "sent",
        attempts: job.attempts + 1,
        locked_at: null,
        processed_at: new Date().toISOString(),
        last_error: null,
      });
      return { jobId, status: "already-sent" };
    }

    let transientFailures = 0;
    let accepted = 0;

    for (const tokenChunk of chunk(pendingTokens, 100)) {
      const deliveries = await Promise.all(
        tokenChunk.map((token) =>
          upsertPendingDelivery(
            job,
            token,
            priorByToken.get(token.expo_push_token),
          )
        ),
      );

      const messages = tokenChunk.map((token) => ({
        to: token.expo_push_token,
        sound: "default",
        channelId: "payments",
        priority: "high",
        title: "Payment received",
        body: `${
          formatPaymentAmount(
            Number(payment.amount),
            clinic.currency_code,
          )
        } was recorded at ${clinic.name}.`,
        data: {
          type: "payment_received",
          route: "/reports/payments",
          payment_id: payment.id,
          job_id: job.id,
        },
      }));

      let response: Response;
      try {
        response = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messages),
        });
      } catch (error) {
        transientFailures += tokenChunk.length;
        await Promise.all(
          deliveries.map((delivery) =>
            updateDelivery(delivery.id, {
              status: "retry",
              error_detail: truncateError(error),
            })
          ),
        );
        continue;
      }

      if (!response.ok) {
        const detail = truncateError(await response.text());
        transientFailures += tokenChunk.length;
        await Promise.all(
          deliveries.map((delivery) =>
            updateDelivery(delivery.id, {
              status: "retry",
              error_detail: detail,
            })
          ),
        );
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = Array.isArray(payload.data) ? payload.data : [];

      for (let index = 0; index < tokenChunk.length; index += 1) {
        const token = tokenChunk[index];
        const delivery = deliveries[index];
        const ticket = tickets[index];
        const errorCode = ticket?.details?.error ?? null;
        const invalid = isInvalidExpoTokenError(errorCode);

        if (ticket?.status === "ok" && ticket.id) {
          accepted += 1;
          await updateDelivery(delivery.id, {
            status: "ticket_ok",
            expo_ticket_id: ticket.id,
            sent_at: new Date().toISOString(),
            error_code: null,
            error_detail: null,
          });
        } else {
          if (!invalid) transientFailures += 1;
          await updateDelivery(delivery.id, {
            status: invalid ? "invalid" : "retry",
            error_code: errorCode,
            error_detail: truncateError(
              ticket?.message ?? "Expo did not return a push ticket.",
            ),
          });
          if (invalid) await deactivateToken(token, errorCode);
        }
      }
    }

    const attempts = job.attempts + 1;
    if (transientFailures > 0 && attempts < 8) {
      await updateJob(job.id, {
        status: "retry",
        attempts,
        next_attempt_at: retryAt(attempts),
        locked_at: null,
        last_error:
          `${transientFailures} device delivery attempt(s) need retry.`,
      });
      return { jobId, status: "retry", accepted, transientFailures };
    }

    await updateJob(job.id, {
      status: accepted > 0 ? "sent" : "failed",
      attempts,
      locked_at: null,
      processed_at: new Date().toISOString(),
      last_error: accepted > 0 ? null : "No device accepted the notification.",
    });
    return {
      jobId,
      status: accepted > 0 ? "sent" : "failed",
      accepted,
    };
  } catch (error) {
    await scheduleJobRetry(job, error);
    console.error(
      "Payment notification dispatch failed",
      job.id,
      truncateError(error),
    );
    return { jobId, status: "retry-or-failed" };
  }
}

async function checkReceipts() {
  const { data: deliveries, error } = await supabase
    .from("payment_notification_deliveries")
    .select(
      "id,expo_ticket_id,device_token_id,status,sent_at,receipt_checked_at",
    )
    .eq("status", "ticket_ok")
    .not("expo_ticket_id", "is", null)
    .order("sent_at", { ascending: true })
    .limit(300);

  if (error) throw error;
  if (!deliveries?.length) return { checked: 0 };

  let checked = 0;
  for (const deliveryChunk of chunk(deliveries, 300)) {
    const ids = deliveryChunk
      .map((delivery) => delivery.expo_ticket_id)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) continue;

    const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      throw new Error(`Expo receipt request failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Record<string, ExpoReceipt>;
    };
    for (const delivery of deliveryChunk) {
      const receipt = payload.data?.[delivery.expo_ticket_id];
      if (!receipt) continue;
      checked += 1;
      const errorCode = receipt.details?.error ?? null;
      const invalid = isInvalidExpoTokenError(errorCode);
      const now = new Date().toISOString();

      await updateDelivery(delivery.id, {
        status: receipt.status === "ok"
          ? "delivered"
          : invalid
          ? "invalid"
          : "receipt_error",
        expo_receipt_status: receipt.status ?? "error",
        error_code: errorCode,
        error_detail: receipt.status === "ok"
          ? null
          : truncateError(receipt.message),
        receipt_checked_at: now,
      });

      if (invalid && delivery.device_token_id) {
        await deactivateToken(
          { id: delivery.device_token_id },
          errorCode,
        );
      }
    }
  }

  return { checked };
}

async function runMaintenance() {
  const now = new Date().toISOString();
  const staleLockCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { error: recoveryError } = await supabase
    .from("payment_notification_jobs")
    .update({
      status: "retry",
      locked_at: null,
      next_attempt_at: now,
      last_error: "Recovered a stale processing lock.",
    })
    .eq("status", "processing")
    .lt("locked_at", staleLockCutoff);
  if (recoveryError) throw recoveryError;

  const { data: jobs, error } = await supabase
    .from("payment_notification_jobs")
    .select("id")
    .in("status", ["queued", "retry"])
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  const dispatchResults = [];
  for (const job of jobs ?? []) {
    dispatchResults.push(await dispatchJob(job.id));
  }

  return {
    dispatched: dispatchResults,
    receipts: await checkReceipts(),
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (
    !(await secretsMatch(
      request.headers.get("x-capdent-webhook-secret"),
      webhookSecret,
    ))
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!pushEnabled) {
    return json({
      ok: true,
      disabled: true,
      message: "PAYMENT_PUSH_ENABLED is false.",
    });
  }

  try {
    const body = (await request.json()) as NotificationRequest;
    if (body.mode === "receipts") {
      return json({ ok: true, ...(await checkReceipts()) });
    }
    if (body.mode === "maintenance") {
      return json({ ok: true, ...(await runMaintenance()) });
    }

    const jobId = body.job_id ?? body.record?.id;
    if (!jobId) return json({ error: "Notification job id is required" }, 400);
    if (
      body.record?.id &&
      (body.type !== "INSERT" ||
        body.table !== "payment_notification_jobs")
    ) {
      return json({ error: "Unexpected webhook payload" }, 400);
    }

    return json({ ok: true, result: await dispatchJob(jobId) });
  } catch (error) {
    console.error("Payment notification request failed", truncateError(error));
    return json({ error: "Notification processing failed" }, 500);
  }
});
