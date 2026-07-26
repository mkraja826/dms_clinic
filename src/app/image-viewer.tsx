import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { useResolvedStorageUrl } from "@/lib/storageUrls";

export default function ImageViewerScreen() {
  const params = useLocalSearchParams<{
    url?: string;
    name?: string;
    type?: string;
  }>();

  const originalUrl = typeof params.url === "string" ? params.url : "";
  const url = useResolvedStorageUrl(originalUrl);
  const name = typeof params.name === "string" ? params.name : "File";
  const type = typeof params.type === "string" ? params.type : "";

  const cleanUrl = url.toLowerCase().split("?")[0];

  const looksLikeImage =
    type.startsWith("image") ||
    /\.(png|jpg|jpeg|webp|gif|heic)$/i.test(cleanUrl) ||
    /\.(png|jpg|jpeg|webp|gif|heic)$/i.test(name) ||
    cleanUrl.includes("/object/public/");

  async function openExternally() {
    if (!url) return;
    await Linking.openURL(url);
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#050505" }}>
      <View
        style={{
          paddingTop: 52,
          paddingHorizontal: 14,
          paddingBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: "rgba(0,0,0,0.75)",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}>
            {name}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
            {looksLikeImage ? "Image preview" : "Open document"}
          </Text>
        </View>

        {url ? (
          <Pressable
            onPress={openExternally}
            style={{
              width: 42,
              height: 42,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.12)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="open-outline" size={21} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {url && looksLikeImage ? (
          <SecureStorageImage
            uri={url}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
          />
        ) : (
          <View style={{ alignItems: "center", gap: 12, padding: 24 }}>
            <Ionicons name="document-text-outline" size={58} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900", textAlign: "center" }}>
              Preview unavailable
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 21 }}>
              This file type may need to be opened externally.
            </Text>

            {url ? (
              <Pressable
                onPress={openExternally}
                style={{
                  minHeight: 48,
                  borderRadius: 999,
                  paddingHorizontal: 18,
                  backgroundColor: "#FFFFFF",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#000000", fontWeight: "900" }}>
                  Open File
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
