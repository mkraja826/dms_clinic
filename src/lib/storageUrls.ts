import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type StorageObjectReference = {
  bucket: string;
  path: string;
};

type CachedSignedUrl = {
  url: string;
  refreshAt: number;
};

const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_MS = 45 * 60 * 1000;
const useSignedStorageUrls =
  process.env.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS !== "false";

const signedUrlCache = new Map<string, CachedSignedUrl>();
const signedUrlRequests = new Map<string, Promise<string>>();

function safelyDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cacheKey(reference: StorageObjectReference) {
  return `${reference.bucket}/${reference.path}`;
}

export function parseStorageObjectUrl(
  value?: string | null
): StorageObjectReference | null {
  const url = value?.trim();
  if (!url) return null;

  if (url.startsWith("supabase://")) {
    const withoutScheme = url.slice("supabase://".length);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex <= 0) return null;

    return {
      bucket: safelyDecode(withoutScheme.slice(0, slashIndex)),
      path: safelyDecode(withoutScheme.slice(slashIndex + 1).split("?")[0]),
    };
  }

  const markers = [
    "/storage/v1/object/public/",
    "/storage/v1/object/sign/",
    "/storage/v1/object/authenticated/",
  ];

  for (const marker of markers) {
    const markerIndex = url.indexOf(marker);
    if (markerIndex === -1) continue;

    const objectPart = url.slice(markerIndex + marker.length).split("?")[0];
    const slashIndex = objectPart.indexOf("/");
    if (slashIndex <= 0) return null;

    return {
      bucket: safelyDecode(objectPart.slice(0, slashIndex)),
      path: safelyDecode(objectPart.slice(slashIndex + 1)),
    };
  }

  return null;
}

export function storageObjectUri(reference: StorageObjectReference) {
  return `supabase://${encodeURIComponent(reference.bucket)}/${reference.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function resolveStorageUrl(value?: string | null) {
  const originalUrl = value?.trim() || "";
  const reference = parseStorageObjectUrl(originalUrl);
  if (!reference || !useSignedStorageUrls) return originalUrl;

  const key = cacheKey(reference);
  const cached = signedUrlCache.get(key);
  if (cached && cached.refreshAt > Date.now()) return cached.url;

  const existingRequest = signedUrlRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const { data, error } = await supabase.storage
      .from(reference.bucket)
      .createSignedUrl(reference.path, SIGNED_URL_LIFETIME_SECONDS);

    if (error || !data?.signedUrl) {
      if (error) console.warn("Unable to sign Storage URL:", error.message);
      return originalUrl;
    }

    signedUrlCache.set(key, {
      url: data.signedUrl,
      refreshAt: Date.now() + SIGNED_URL_REFRESH_MS,
    });

    return data.signedUrl;
  })().finally(() => {
    signedUrlRequests.delete(key);
  });

  signedUrlRequests.set(key, request);
  return request;
}

export async function resolveStorageUrls(values: Array<string | null | undefined>) {
  const uniqueValues = [...new Set(values.map((value) => value?.trim() || "").filter(Boolean))];
  const resolved = new Map<string, string>();

  for (const value of uniqueValues) resolved.set(value, value);
  if (!useSignedStorageUrls || uniqueValues.length === 0) return resolved;

  const pendingByBucket = new Map<string, Map<string, string[]>>();

  for (const value of uniqueValues) {
    const reference = parseStorageObjectUrl(value);
    if (!reference) continue;

    const key = cacheKey(reference);
    const cached = signedUrlCache.get(key);
    if (cached && cached.refreshAt > Date.now()) {
      resolved.set(value, cached.url);
      continue;
    }

    const bucketPaths = pendingByBucket.get(reference.bucket) ?? new Map<string, string[]>();
    const originalValues = bucketPaths.get(reference.path) ?? [];
    originalValues.push(value);
    bucketPaths.set(reference.path, originalValues);
    pendingByBucket.set(reference.bucket, bucketPaths);
  }

  await Promise.all(
    [...pendingByBucket.entries()].map(async ([bucket, pathMap]) => {
      const paths = [...pathMap.keys()];
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(paths, SIGNED_URL_LIFETIME_SECONDS);

      if (error || !data) {
        if (error) console.warn(`Unable to sign ${bucket} Storage URLs:`, error.message);
        return;
      }

      for (const item of data) {
        if (!item.signedUrl || !item.path) continue;
        const originals = pathMap.get(item.path) ?? [];
        const key = cacheKey({ bucket, path: item.path });
        signedUrlCache.set(key, {
          url: item.signedUrl,
          refreshAt: Date.now() + SIGNED_URL_REFRESH_MS,
        });
        for (const original of originals) resolved.set(original, item.signedUrl);
      }
    })
  );

  return resolved;
}

export function useResolvedStorageUrl(value?: string | null) {
  const originalUrl = value?.trim() || "";
  const [resolvedUrl, setResolvedUrl] = useState(originalUrl);

  useEffect(() => {
    let active = true;
    setResolvedUrl(originalUrl);

    resolveStorageUrl(originalUrl)
      .then((nextUrl) => {
        if (active) setResolvedUrl(nextUrl);
      })
      .catch((error) => {
        console.warn("Unable to resolve Storage URL:", error);
        if (active) setResolvedUrl(originalUrl);
      });

    return () => {
      active = false;
    };
  }, [originalUrl]);

  return resolvedUrl;
}

export function clearSignedStorageUrlCache() {
  signedUrlCache.clear();
  signedUrlRequests.clear();
}
