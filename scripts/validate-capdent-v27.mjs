import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V27_RC === "true";

try {
  execFileSync(process.execPath, ["scripts/validate-capdent-v26-frozen.mjs"], {
    stdio: "inherit",
  });
} catch {
  failures.push("The certified frozen V26 baseline must validate independently before V27 changes can ship.");
}

const patientsScreen = readText("src/app/(tabs)/patients.tsx");
const addPatientScreen = readText("src/app/patient/add.tsx");
const uploadScreen = readText("src/app/patient/upload.tsx");
const loginScreen = readText("src/app/login.tsx");
const subscriptionScreen = readText("src/app/settings/subscription.tsx");
const recoveryScreen = readText("src/app/settings/subscription-recovery.tsx");
const recoveryService = readText("src/lib/googlePlayRecovery.ts");
const notificationHealthScreen = readText("src/app/settings/notification-health.tsx");
const notificationHealthService = readText("src/lib/paymentNotificationHealth.ts");
const paymentNotifications = readText("src/lib/paymentNotifications.ts");
const notificationCoordinator = readText("src/components/PaymentNotificationCoordinator.tsx");
const paymentNotificationDispatcher = readText("supabase/functions/send-payment-notification/index.ts");
const analyticsCoordinator = readText("src/components/FirebaseAnalyticsCoordinator.tsx");
const firebaseAnalytics = readText("src/lib/firebaseAnalytics.ts");
const pricingV25 = readText("src/lib/pricingV25.ts");
const ownerReviewScreen = readText("src/app/reports/owner-review.tsx");
const headMore = readText("src/app/(head)/more.tsx");
const headDashboard = readText("src/app/(head)/dashboard.tsx");
const limits = readText("src/lib/v25Limits.ts");
const eas = JSON.parse(readText("eas.json"));

expect(
  patientsScreen.includes("Plan & Patient Capacity"),
  "V27 Patients must expose the clinic plan and patient-capacity status."
);
expect(
  patientsScreen.includes("getCapDentEntitlementsV25") &&
    patientsScreen.includes("Patient Limit Reached"),
  "V27 Patients must use the existing server-authoritative entitlement service and show a blocked state."
);
expect(
  !addPatientScreen.includes("V25 Pricing Observation"),
  "V27 must not expose V25 pricing diagnostics in patient registration."
);
expect(
  addPatientScreen.includes("getCapDentEntitlementsV25") &&
    addPatientScreen.includes("patientQuotaMessage"),
  "V27 patient registration must preserve the server-authoritative patient quota check."
);
expect(
  uploadScreen.includes("getCapDentEntitlementsV25") &&
    uploadScreen.includes("uploadQuotaMessage"),
  "V27 clinical uploads must preserve the server-authoritative upload/storage quota check."
);
expect(
  uploadScreen.includes("Plan & Upload Capacity") &&
    uploadScreen.includes("formatStorageBytes"),
  "V27 clinical uploads must show proactive upload and storage usage before file selection."
);
expect(
  uploadScreen.includes("CAPDENT_V25_LIMITS.free.uploadWarningAt") &&
    uploadScreen.includes("upload capacity is running low"),
  "V27 Free upload UX must warn from the finalized upload-warning threshold."
);
expect(
  uploadScreen.includes("uploadBlocked || uploading || done") &&
    uploadScreen.includes("View Plans"),
  "V27 upload UX must disable new upload submission when live entitlements block uploads and provide a plan action."
);
expect(
  subscriptionScreen.includes("Clinic Usage") &&
    subscriptionScreen.includes("getCapDentEntitlementsV25") &&
    subscriptionScreen.includes("formatStorageBytes"),
  "V27 plan screen must show live patient, upload, and storage usage from server entitlements."
);
expect(
  subscriptionScreen.includes("Patient capacity available") &&
    subscriptionScreen.includes("Upload capacity reached") &&
    subscriptionScreen.includes("Capacity action needed"),
  "V27 plan screen must clearly expose available and blocked clinic-capacity states."
);
expect(
  headDashboard.includes("Needs Owner Attention") &&
    headDashboard.includes("getOwnerReviewReport") &&
    headDashboard.includes("ownerReview.cards.map"),
  "V27 owner dashboard must surface live owner-review exceptions with actionable rows."
);
expect(
  headDashboard.includes("Missed") || headDashboard.includes("ownerReviewIcon"),
  "V27 owner attention UI must provide review-specific visual routing."
);
expect(
  headDashboard.includes("Owner review load failed") &&
    headDashboard.includes("Core dashboard data is still available") &&
    headDashboard.includes("Pull down to retry"),
  "V27 owner-review loading must fail soft without blocking the core dashboard."
);
expect(
  headDashboard.includes("void loadOwnerReview();") &&
    headDashboard.includes("Open full owner review and operational exceptions"),
  "V27 owner dashboard must refresh owner review after relevant workflow actions and keep a route to the full review."
);
expect(
  recoveryService.includes("getAvailablePurchases") &&
    recoveryService.includes("verify-google-play-subscription") &&
    recoveryService.includes("finishGooglePlaySubscriptionPurchase"),
  "V27 billing recovery must restore Google Play purchases through the existing server-authoritative verifier and finish only verified entitlements."
);
expect(
  recoveryService.includes("No CapDent subscription was found") &&
    recoveryService.includes("recheckLinkedGooglePlaySubscription"),
  "V27 billing recovery must support both no-purchase handling and rechecking an already linked purchase."
);
expect(
  recoveryScreen.includes("Billing Recovery") &&
    recoveryScreen.includes("Restore Purchase") &&
    recoveryScreen.includes("Recheck Linked Purchase") &&
    recoveryScreen.includes("Manage in Google Play"),
  "V27 owner billing recovery UI must expose restore, recheck, and Google Play management actions."
);
expect(
  recoveryScreen.includes("account hold") &&
    recoveryScreen.includes("grace period") &&
    (recoveryScreen.includes("Expired") || recoveryScreen.includes("expired")),
  "V27 billing recovery must explain non-active Google Play lifecycle states without treating them as paid access."
);
expect(
  headMore.includes("Billing Recovery") &&
    headMore.includes("/settings/subscription-recovery"),
  "V27 owner tools must provide a visible route to billing recovery."
);
expect(
  notificationHealthScreen.includes("Notification Health") &&
    notificationHealthScreen.includes("Repair Registration") &&
    notificationHealthScreen.includes("Open Notification Settings") &&
    notificationHealthScreen.includes("Linking.openSettings"),
  "V27 notification health UI must expose device readiness, registration repair, and OS permission recovery."
);
expect(
  notificationHealthService.includes("Notifications.getPermissionsAsync") &&
    notificationHealthService.includes("device_push_tokens") &&
    notificationHealthService.includes("payment_notification_jobs") &&
    notificationHealthService.includes("payment_notification_deliveries"),
  "V27 notification health must diagnose local permission plus server token, outbox, and delivery state."
);
expect(
  notificationHealthService.includes("getCurrentPaymentPushInstallId") &&
    notificationHealthService.includes("registerPaymentPushToken") &&
    paymentNotifications.includes("export async function getCurrentPaymentPushInstallId"),
  "V27 push recovery must repair the current installation through the existing authenticated registration path."
);
expect(
  !notificationHealthScreen.includes("expo_push_token"),
  "V27 notification health UI must never display the raw Expo push token."
);
expect(
  notificationCoordinator.includes("Notifications.addPushTokenListener") &&
    notificationCoordinator.includes("registerPaymentPushToken(profile)"),
  "V27 must preserve automatic payment-push re-registration when the Expo token rotates."
);
expect(
  paymentNotifications.includes('PAYMENT_NOTIFICATION_CHANNEL_ID = "payments_coin_drop_v1"') &&
    paymentNotificationDispatcher.includes("function supportsCoinDropChannel") &&
    paymentNotificationDispatcher.includes("function paymentChannelId") &&
    paymentNotificationDispatcher.includes('"payments_coin_drop_v1"') &&
    paymentNotificationDispatcher.includes('"payments"') &&
    paymentNotificationDispatcher.includes("channelId: paymentChannelId(token)") &&
    paymentNotificationDispatcher.includes("id,user_id,expo_push_token,app_version"),
  "V27 payment push dispatch must route 1.2.6+ devices to payments_coin_drop_v1 while preserving the legacy payments channel for frozen V24 registrations."
);
expect(
  headMore.includes("Notification Health") &&
    headMore.includes("/settings/notification-health"),
  "V27 owner tools must provide a visible route to notification health."
);

expect(
  eas.build?.production?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true" &&
    eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true" &&
    eas.build?.development?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "false" &&
    eas.build?.preview?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "false",
  "V27 Firebase Analytics must be enabled only for Play Internal and Production release profiles."
);
expect(
  firebaseAnalytics.includes("capdent_auth_result") &&
    firebaseAnalytics.includes("capdent_quota_blocked") &&
    firebaseAnalytics.includes("capdent_plan_viewed") &&
    firebaseAnalytics.includes("capdent_billing_recovery") &&
    firebaseAnalytics.includes("capdent_notification_health") &&
    firebaseAnalytics.includes("capdent_owner_review"),
  "V27 analytics must keep an explicit allowlist for authentication, quota, plan, billing-recovery, notification-health, and owner-review events."
);
expect(
  firebaseAnalytics.includes("analytics_storage: FIREBASE_ANALYTICS_ENABLED") &&
    firebaseAnalytics.includes("ad_storage: false") &&
    firebaseAnalytics.includes("ad_user_data: false") &&
    firebaseAnalytics.includes("ad_personalization: false"),
  "V27 analytics consent must enable only analytics storage and keep advertising consent disabled."
);
expect(
  !firebaseAnalytics.includes("patient_name") &&
    !firebaseAnalytics.includes("patient_phone") &&
    !firebaseAnalytics.includes("diagnosis") &&
    !firebaseAnalytics.includes("purchase_token") &&
    !firebaseAnalytics.includes("order_id") &&
    !firebaseAnalytics.includes("clinic_id"),
  "V27 analytics schema must not accept patient, clinical, purchase-token, order, or clinic identifiers."
);
expect(
  loginScreen.includes("analyticsAuthFailureCategory") &&
    loginScreen.includes('"capdent_auth_result"') &&
    loginScreen.includes('failure_category: "none"'),
  "V27 login analytics must record only safe success/failure categories without credentials or email values."
);
expect(
  pricingV25.includes('"capdent_quota_blocked"') &&
    pricingV25.includes('resource: "patient"') &&
    pricingV25.includes('resource: "upload"') &&
    pricingV25.includes('resource: "storage"'),
  "V27 quota analytics must distinguish patient, upload-count, and storage blocks through the server-authoritative quota helpers."
);
expect(
  addPatientScreen.includes('"capdent_patient_registered"') &&
    addPatientScreen.includes("profile_photo_requested"),
  "V27 patient-registration analytics must record only the non-identifying profile-photo-requested flag."
);
expect(
  analyticsCoordinator.includes('"capdent_plan_viewed"') &&
    analyticsCoordinator.includes('pathname === "/settings/subscription"') &&
    analyticsCoordinator.includes('"capdent_billing_recovery"') &&
    analyticsCoordinator.includes('action: "view"') &&
    analyticsCoordinator.includes('outcome: "viewed"'),
  "V27 analytics coordinator must count plan and billing-recovery screen views without reading billing tokens."
);
expect(
  notificationHealthScreen.includes('"capdent_notification_health"') &&
    notificationHealthScreen.includes('outcome: "permission_denied"') &&
    notificationHealthScreen.includes('outcome: "unavailable"'),
  "V27 notification-health analytics must expose safe health and repair outcomes without raw tokens."
);
expect(
  ownerReviewScreen.includes('"capdent_owner_review"') &&
    ownerReviewScreen.includes("analyticsAttentionBucket") &&
    ownerReviewScreen.includes("analyticsOwnerReviewItem"),
  "V27 owner-review analytics must use bucketed attention levels and fixed review categories instead of patient details."
);

expect(
  limits.includes("patientLimit: 100") &&
    limits.includes("uploadLimit: 150") &&
    limits.includes("uploadWarningAt: 120") &&
    limits.includes("storageLimitBytes: 1024 * 1024 * 1024"),
  "V27 must preserve the finalized Free limits: 100 patients, warning at 120 uploads, 150 uploads, and 1 GB storage."
);
expect(
  existsSync("scripts/validate-capdent-v26.mjs"),
  "V26 baseline validator must remain present and unchanged in responsibility."
);

if (rcMode) {
  let localBranch = "";
  try {
    localBranch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
    }).trim();
  } catch {
    notes.push("Could not determine the local Git branch.");
  }

  const githubRefName = process.env.GITHUB_REF_NAME?.trim() || "";
  const githubHeadRef = process.env.GITHUB_HEAD_REF?.trim() || "";
  const branchMatches =
    localBranch === "release/capdent-v27" ||
    githubRefName === "release/capdent-v27" ||
    githubHeadRef === "release/capdent-v27";

  expect(
    branchMatches,
    `V27 RC validation must run from release/capdent-v27 (local: ${localBranch || "detached"}, GitHub ref: ${githubRefName || "none"}, GitHub head: ${githubHeadRef || "none"}).`
  );
}

if (failures.length > 0) {
  console.error(`CapDent V27 validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V27 feature validation passed${rcMode ? " (RC mode)" : ""}.`);
for (const note of notes) console.log(`Note: ${note}`);
