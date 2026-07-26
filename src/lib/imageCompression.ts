import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";

export type UploadImageKind =
  | "patient_profile"
  | "clinic_logo"
  | "xray"
  | "prescription"
  | "before_photo"
  | "after_photo"
  | "report"
  | "other";

type CompressionPreset = {
  maxDimension: number;
  initialQuality: number;
  minimumQuality: number;
  targetRatio: number;
  minimumTargetBytes: number;
  maxUploadBytes: number;
};

export type OptimizedUploadImage = {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/webp";
  extension: "webp";
  originalSizeBytes: number | null;
  storedSizeBytes: number | null;
};

const PRESETS: Record<UploadImageKind, CompressionPreset> = {
  patient_profile: {
    maxDimension: 768,
    initialQuality: 0.94,
    minimumQuality: 0.9,
    targetRatio: 0.3,
    minimumTargetBytes: 160 * 1024,
    maxUploadBytes: 5 * 1024 * 1024,
  },
  clinic_logo: {
    maxDimension: 768,
    initialQuality: 0.96,
    minimumQuality: 0.92,
    targetRatio: 0.3,
    minimumTargetBytes: 160 * 1024,
    maxUploadBytes: 5 * 1024 * 1024,
  },
  xray: {
    maxDimension: 3072,
    initialQuality: 0.99,
    minimumQuality: 0.96,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 25 * 1024 * 1024,
  },
  prescription: {
    maxDimension: 3072,
    initialQuality: 0.99,
    minimumQuality: 0.95,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
  },
  before_photo: {
    maxDimension: 2560,
    initialQuality: 0.99,
    minimumQuality: 0.95,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
  },
  after_photo: {
    maxDimension: 2560,
    initialQuality: 0.99,
    minimumQuality: 0.95,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
  },
  report: {
    maxDimension: 3072,
    initialQuality: 0.99,
    minimumQuality: 0.95,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
  },
  other: {
    maxDimension: 2560,
    initialQuality: 0.96,
    minimumQuality: 0.92,
    targetRatio: 0.3,
    minimumTargetBytes: 300 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
  },
};

const QUALITY_STEP = 0.01;
const TARGET_TOLERANCE = 1.1;

async function fileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return info?.exists && typeof info.size === "number" ? info.size : null;
}

function resizedDimensions(width: number, height: number, maxDimension: number) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxDimension) return { width, height };

  const scale = maxDimension / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function targetStoredBytes(originalSizeBytes: number | null, preset: CompressionPreset) {
  if (originalSizeBytes === null) return null;

  return Math.min(
    originalSizeBytes,
    Math.max(preset.minimumTargetBytes, Math.round(originalSizeBytes * preset.targetRatio))
  );
}

export async function optimizeUploadImage(
  uri: string,
  kind: UploadImageKind
): Promise<OptimizedUploadImage> {
  if (!uri) throw new Error("Image file is missing");

  const preset = PRESETS[kind];
  const originalSizeBytes = await fileSize(uri);
  const sourceContext = ImageManipulator.ImageManipulator.manipulate(uri);
  const source = await sourceContext.renderAsync();
  const dimensions = resizedDimensions(source.width, source.height, preset.maxDimension);
  const outputContext = ImageManipulator.ImageManipulator.manipulate(source);

  if (dimensions.width !== source.width || dimensions.height !== source.height) {
    outputContext.resize(dimensions);
  }

  const rendered = await outputContext.renderAsync();
  let quality = preset.initialQuality;
  let saved = await rendered.saveAsync({
    compress: quality,
    format: ImageManipulator.SaveFormat.WEBP,
  });
  let storedSizeBytes = await fileSize(saved.uri);
  const targetBytes = targetStoredBytes(originalSizeBytes, preset);

  while (
    targetBytes !== null &&
    storedSizeBytes !== null &&
    storedSizeBytes > targetBytes * TARGET_TOLERANCE &&
    quality - QUALITY_STEP >= preset.minimumQuality
  ) {
    quality = Math.max(preset.minimumQuality, Number((quality - QUALITY_STEP).toFixed(2)));
    const previousUri = saved.uri;
    saved = await rendered.saveAsync({
      compress: quality,
      format: ImageManipulator.SaveFormat.WEBP,
    });
    storedSizeBytes = await fileSize(saved.uri);
    await FileSystem.deleteAsync(previousUri, { idempotent: true }).catch(() => undefined);
  }

  if (storedSizeBytes !== null && storedSizeBytes > preset.maxUploadBytes) {
    throw new Error(
      `Optimized image is still too large (${Math.ceil(storedSizeBytes / 1024 / 1024)} MB). Please choose a smaller image.`
    );
  }

  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    mimeType: "image/webp",
    extension: "webp",
    originalSizeBytes,
    storedSizeBytes,
  };
}

export function withImageExtension(fileName: string, extension: string) {
  const normalized = fileName.trim() || `image-${Date.now()}`;
  return /\.[a-z0-9]{1,8}$/i.test(normalized)
    ? normalized.replace(/\.[a-z0-9]{1,8}$/i, `.${extension}`)
    : `${normalized}.${extension}`;
}
