import { Image, type ImageProps } from "expo-image";
import { useResolvedStorageUrl } from "@/lib/storageUrls";

type SecureStorageImageProps = Omit<ImageProps, "source"> & {
  uri: string;
};

export function SecureStorageImage({
  uri,
  cachePolicy = "memory-disk",
  transition = 120,
  ...props
}: SecureStorageImageProps) {
  const resolvedUri = useResolvedStorageUrl(uri);

  return (
    <Image
      {...props}
      source={resolvedUri ? { uri: resolvedUri } : undefined}
      cachePolicy={cachePolicy}
      transition={transition}
    />
  );
}
