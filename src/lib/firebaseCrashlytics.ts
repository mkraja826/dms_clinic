type FirebaseCrashlyticsAdapter = {
  setCollectionEnabled: (enabled: boolean) => Promise<unknown>;
};

const NOOP_ADAPTER: FirebaseCrashlyticsAdapter = {
  setCollectionEnabled: async () => undefined,
};

let adapter: FirebaseCrashlyticsAdapter = NOOP_ADAPTER;
let initialized = false;

export const FIREBASE_CRASHLYTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_CRASHLYTICS === "true";

export function configureFirebaseCrashlyticsAdapter(
  nextAdapter: FirebaseCrashlyticsAdapter
) {
  adapter = nextAdapter;
}

export async function initializeFirebaseCrashlytics() {
  if (initialized) return;
  initialized = true;

  try {
    // Native auto-collection is disabled in firebase.json. Release profiles
    // must opt in explicitly through this coarse public build flag.
    await adapter.setCollectionEnabled(FIREBASE_CRASHLYTICS_ENABLED);
  } catch (error) {
    // Do not attach user, clinic, patient, payment, or clinical context here.
    // Initialization failure must never block the clinic workflow.
    console.warn(
      "Firebase Crashlytics initialization failed:",
      error instanceof Error ? error.name : "unknown"
    );
  }
}
