export const CAPDENT_V25_LIMITS = {
  free: {
    patientLimit: 100,
    uploadLimit: 150,
    uploadWarningAt: 120,
    storageLimitBytes: 1024 * 1024 * 1024,
  },
} as const;

export type CapDentV25UsageSnapshot = {
  patientCount: number;
  uploadCount: number;
  storageUsedBytes: number;
};

export type CapDentV25UsageState = {
  patientCount: number;
  patientLimit: number;
  patientsRemaining: number;
  patientLimitReached: boolean;
  uploadCount: number;
  uploadLimit: number;
  uploadsRemaining: number;
  uploadWarning: boolean;
  uploadLimitReached: boolean;
  storageUsedBytes: number;
  storageLimitBytes: number;
  storageRemainingBytes: number;
  storageLimitReached: boolean;
};

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getFreeTierUsageState(snapshot: CapDentV25UsageSnapshot): CapDentV25UsageState {
  const limits = CAPDENT_V25_LIMITS.free;
  const patientCount = safeCount(snapshot.patientCount);
  const uploadCount = safeCount(snapshot.uploadCount);
  const storageUsedBytes = safeCount(snapshot.storageUsedBytes);

  return {
    patientCount,
    patientLimit: limits.patientLimit,
    patientsRemaining: Math.max(limits.patientLimit - patientCount, 0),
    patientLimitReached: patientCount >= limits.patientLimit,
    uploadCount,
    uploadLimit: limits.uploadLimit,
    uploadsRemaining: Math.max(limits.uploadLimit - uploadCount, 0),
    uploadWarning: uploadCount >= limits.uploadWarningAt,
    uploadLimitReached: uploadCount >= limits.uploadLimit,
    storageUsedBytes,
    storageLimitBytes: limits.storageLimitBytes,
    storageRemainingBytes: Math.max(limits.storageLimitBytes - storageUsedBytes, 0),
    storageLimitReached: storageUsedBytes >= limits.storageLimitBytes,
  };
}

export function formatStorageBytes(bytes: number) {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safeBytes >= 1024 * 1024 * 1024) return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (safeBytes >= 1024 * 1024) return `${Math.round(safeBytes / (1024 * 1024))} MB`;
  if (safeBytes >= 1024) return `${Math.round(safeBytes / 1024)} KB`;
  return `${Math.round(safeBytes)} B`;
}
