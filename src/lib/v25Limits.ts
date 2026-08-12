export const CAPDENT_V25_LIMITS = {
  free: {
    patientLimit: 100,
    uploadLimit: 150,
    uploadWarningAt: 120,
    storageLimitBytes: 1024 * 1024 * 1024,
  },
} as const;

export type CapDentV25EffectiveLimits = {
  patientLimit?: number | null;
  uploadLimit?: number | null;
  storageLimitBytes?: number | null;
  grandfathered?: boolean;
};

export type CapDentV25UsageSnapshot = {
  patientCount: number;
  uploadCount: number;
  storageUsedBytes: number;
  effectiveLimits?: CapDentV25EffectiveLimits | null;
};

export type CapDentV25UsageState = {
  patientCount: number;
  patientBaseLimit: number;
  patientLimit: number;
  patientsRemaining: number;
  patientLimitReached: boolean;
  uploadCount: number;
  uploadBaseLimit: number;
  uploadLimit: number;
  uploadsRemaining: number;
  uploadWarningAt: number;
  uploadWarning: boolean;
  uploadLimitReached: boolean;
  storageUsedBytes: number;
  storageBaseLimitBytes: number;
  storageLimitBytes: number;
  storageRemainingBytes: number;
  storageLimitReached: boolean;
  grandfathered: boolean;
};

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeEffectiveLimit(value: number | null | undefined, fallback: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(fallback, safeCount(value));
}

export function getFreeTierUsageState(snapshot: CapDentV25UsageSnapshot): CapDentV25UsageState {
  const baseLimits = CAPDENT_V25_LIMITS.free;
  const patientCount = safeCount(snapshot.patientCount);
  const uploadCount = safeCount(snapshot.uploadCount);
  const storageUsedBytes = safeCount(snapshot.storageUsedBytes);
  const patientLimit = safeEffectiveLimit(
    snapshot.effectiveLimits?.patientLimit,
    baseLimits.patientLimit
  );
  const uploadLimit = safeEffectiveLimit(
    snapshot.effectiveLimits?.uploadLimit,
    baseLimits.uploadLimit
  );
  const storageLimitBytes = safeEffectiveLimit(
    snapshot.effectiveLimits?.storageLimitBytes,
    baseLimits.storageLimitBytes
  );
  const uploadWarningAt = Math.min(baseLimits.uploadWarningAt, uploadLimit);

  return {
    patientCount,
    patientBaseLimit: baseLimits.patientLimit,
    patientLimit,
    patientsRemaining: Math.max(patientLimit - patientCount, 0),
    patientLimitReached: patientCount >= patientLimit,
    uploadCount,
    uploadBaseLimit: baseLimits.uploadLimit,
    uploadLimit,
    uploadsRemaining: Math.max(uploadLimit - uploadCount, 0),
    uploadWarningAt,
    uploadWarning: uploadCount >= uploadWarningAt,
    uploadLimitReached: uploadCount >= uploadLimit,
    storageUsedBytes,
    storageBaseLimitBytes: baseLimits.storageLimitBytes,
    storageLimitBytes,
    storageRemainingBytes: Math.max(storageLimitBytes - storageUsedBytes, 0),
    storageLimitReached: storageUsedBytes >= storageLimitBytes,
    grandfathered: snapshot.effectiveLimits?.grandfathered === true,
  };
}

export function formatStorageBytes(bytes: number) {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safeBytes >= 1024 * 1024 * 1024) return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (safeBytes >= 1024 * 1024) return `${Math.round(safeBytes / (1024 * 1024))} MB`;
  if (safeBytes >= 1024) return `${Math.round(safeBytes / 1024)} KB`;
  return `${Math.round(safeBytes)} B`;
}
