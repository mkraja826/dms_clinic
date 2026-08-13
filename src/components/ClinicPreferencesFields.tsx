import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppInput } from "@/components/AppInput";
import { colors, radius } from "@/constants/colors";
import {
  ClinicPreferences,
  COUNTRY_CURRENCY_OPTIONS,
  formatClinicTime,
  getCountryCurrencyOption,
  normalizeClinicTime,
} from "@/lib/clinicLocale";

type Props = {
  value: ClinicPreferences;
  onChange: (value: ClinicPreferences) => void;
};

export function ClinicPreferencesFields({ value, onChange }: Props) {
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  const selectedCountry = getCountryCurrencyOption(value.countryCode);

  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return COUNTRY_CURRENCY_OPTIONS;

    return COUNTRY_CURRENCY_OPTIONS.filter(
      (option) =>
        option.countryName.toLowerCase().includes(query) ||
        option.countryCode.toLowerCase().includes(query) ||
        option.currencyCode.toLowerCase().includes(query)
    );
  }, [countrySearch]);

  function selectCountry(countryCode: string) {
    const option = getCountryCurrencyOption(countryCode);
    onChange({
      ...value,
      countryCode: option.countryCode,
      currencyCode: option.currencyCode,
    });
    setCountryPickerOpen(false);
    setCountrySearch("");
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800" }}>
          Country / Region
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Country or region. ${selectedCountry.countryName}. Suggested currency ${selectedCountry.currencyCode}`}
          accessibilityState={{ expanded: countryPickerOpen }}
          onPress={() => setCountryPickerOpen(true)}
          style={({ pressed }) => ({
            minHeight: 56,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.primarySoft : colors.background,
            paddingHorizontal: 15,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          })}
        >
          <Ionicons name="earth-outline" size={22} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
              {selectedCountry.countryName}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {selectedCountry.countryCode} · Suggested currency {selectedCountry.currencyCode}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={20} color={colors.muted} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>

        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
          Suggested automatically from this phone. Change it when the clinic uses another country.
        </Text>
      </View>

      <AppInput
        label="Clinic Currency"
        value={value.currencyCode}
        onChangeText={(currencyCode) =>
          onChange({
            ...value,
            currencyCode: currencyCode.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3),
          })
        }
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={3}
        placeholder="INR"
        helper="Three-letter currency code. Amounts are labelled in this currency; existing values are never converted."
      />

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <AppInput
            label="Usual Opening Time"
            value={value.openingTime}
            onChangeText={(openingTime) => onChange({ ...value, openingTime })}
            onBlur={() =>
              onChange({
                ...value,
                openingTime: normalizeClinicTime(value.openingTime, "09:00"),
              })
            }
            placeholder="09:00"
            helper={formatClinicTime(value.openingTime)}
          />
        </View>

        <View style={{ flex: 1 }}>
          <AppInput
            label="Usual Closing Time"
            value={value.closingTime}
            onChangeText={(closingTime) => onChange({ ...value, closingTime })}
            onBlur={() =>
              onChange({
                ...value,
                closingTime: normalizeClinicTime(value.closingTime, "21:00"),
              })
            }
            placeholder="21:00"
            helper={formatClinicTime(value.closingTime)}
          />
        </View>
      </View>

      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
        These are usual hours only. CapDent will still allow emergency visits, walk-ins, and appointments outside these times.
      </Text>

      <Modal
        visible={countryPickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 24, fontWeight: "900" }}>
                  Select Country
                </Text>
                <Text style={{ color: colors.muted }}>
                  Currency is suggested automatically and remains editable.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close country picker"
                onPress={() => setCountryPickerOpen(false)}
                hitSlop={10}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="close" size={24} color={colors.text} accessibilityElementsHidden importantForAccessibility="no" />
              </Pressable>
            </View>

            <View
              style={{
                minHeight: 50,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                gap: 10,
              }}
            >
              <Ionicons name="search-outline" size={20} color={colors.muted} accessibilityElementsHidden importantForAccessibility="no" />
              <TextInput
                accessibilityLabel="Search country or currency"
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder="Search country or currency"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                style={{ flex: 1, color: colors.text, fontSize: 16 }}
              />
            </View>
          </View>

          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.countryCode}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12, gap: 8 }}
            renderItem={({ item }) => {
              const selected = item.countryCode === value.countryCode;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.countryName}. ${item.countryCode}. Currency ${item.currencyCode}`}
                  accessibilityState={{ selected }}
                  onPress={() => selectCountry(item.countryCode)}
                  style={({ pressed }) => ({
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor:
                      selected || pressed ? colors.primarySoft : colors.surface,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  })}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {item.countryName}
                    </Text>
                    <Text style={{ color: colors.muted }}>
                      {item.countryCode} · {item.currencyCode}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={24} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
