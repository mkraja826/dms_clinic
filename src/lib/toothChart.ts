export type Dentition = "permanent" | "primary";

export type ToothCondition =
  | "healthy"
  | "caries"
  | "filled"
  | "missing"
  | "crown"
  | "root_canal"
  | "implant"
  | "extraction_planned"
  | "unerupted";

export type ToothSurface =
  | "mesial"
  | "distal"
  | "occlusal"
  | "buccal"
  | "lingual";

export type DentalTreatmentStatus = "planned" | "ongoing" | "completed";

export type ToothFinding = {
  toothCode: string;
  dentition: Dentition;
  condition: ToothCondition;
  surfaces: ToothSurface[];
  notes: string;
  treatmentName: string;
  treatmentStatus: DentalTreatmentStatus;
};

export type ToothDefinition = {
  code: string;
  dentition: Dentition;
  arch: "upper" | "lower";
  side: "right" | "left";
  family: "incisor" | "canine" | "premolar" | "molar";
};

export const TOOTH_CONDITIONS: {
  value: ToothCondition;
  label: string;
  shortLabel: string;
  color: string;
}[] = [
  {
    value: "healthy",
    label: "Healthy",
    shortLabel: "H",
    color: "#FFFFFF",
  },
  {
    value: "caries",
    label: "Caries",
    shortLabel: "C",
    color: "#FCA5A5",
  },
  {
    value: "filled",
    label: "Filled",
    shortLabel: "F",
    color: "#93C5FD",
  },
  {
    value: "missing",
    label: "Missing",
    shortLabel: "M",
    color: "#D1D5DB",
  },
  {
    value: "crown",
    label: "Crown",
    shortLabel: "Cr",
    color: "#C4B5FD",
  },
  {
    value: "root_canal",
    label: "Root canal",
    shortLabel: "RCT",
    color: "#FDBA74",
  },
  {
    value: "implant",
    label: "Implant",
    shortLabel: "I",
    color: "#5EEAD4",
  },
  {
    value: "extraction_planned",
    label: "Extraction planned",
    shortLabel: "X",
    color: "#FECACA",
  },
  {
    value: "unerupted",
    label: "Unerupted",
    shortLabel: "U",
    color: "#E5E7EB",
  },
];

export const TOOTH_SURFACES: {
  value: ToothSurface;
  label: string;
  shortLabel: string;
}[] = [
  { value: "mesial", label: "Mesial", shortLabel: "M" },
  { value: "distal", label: "Distal", shortLabel: "D" },
  { value: "occlusal", label: "Occlusal / incisal", shortLabel: "O/I" },
  { value: "buccal", label: "Buccal / facial", shortLabel: "B/F" },
  { value: "lingual", label: "Lingual / palatal", shortLabel: "L/P" },
];

const PERMANENT_UPPER = [
  "18",
  "17",
  "16",
  "15",
  "14",
  "13",
  "12",
  "11",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
];
const PERMANENT_LOWER = [
  "48",
  "47",
  "46",
  "45",
  "44",
  "43",
  "42",
  "41",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
];
const PRIMARY_UPPER = [
  "55",
  "54",
  "53",
  "52",
  "51",
  "61",
  "62",
  "63",
  "64",
  "65",
];
const PRIMARY_LOWER = [
  "85",
  "84",
  "83",
  "82",
  "81",
  "71",
  "72",
  "73",
  "74",
  "75",
];

export const FDI_ARCHES: Record<
  Dentition,
  { upper: string[]; lower: string[] }
> = {
  permanent: { upper: PERMANENT_UPPER, lower: PERMANENT_LOWER },
  primary: { upper: PRIMARY_UPPER, lower: PRIMARY_LOWER },
};

export function isValidToothCode(
  code: string,
  dentition?: Dentition
): boolean {
  const cleanCode = String(code);
  const modes = dentition ? [dentition] : (["permanent", "primary"] as const);
  return modes.some(
    (mode) =>
      FDI_ARCHES[mode].upper.includes(cleanCode) ||
      FDI_ARCHES[mode].lower.includes(cleanCode)
  );
}

export function getToothDefinition(
  code: string,
  dentition: Dentition
): ToothDefinition | null {
  if (!isValidToothCode(code, dentition)) return null;

  const quadrant = Number(code[0]);
  const position = Number(code[1]);
  const arch = [1, 2, 5, 6].includes(quadrant) ? "upper" : "lower";
  const side = [1, 4, 5, 8].includes(quadrant) ? "right" : "left";
  const family =
    position <= 2
      ? "incisor"
      : position === 3
        ? "canine"
        : dentition === "permanent" && position <= 5
          ? "premolar"
          : "molar";

  return { code, dentition, arch, side, family };
}

export function createHealthyFinding(
  toothCode: string,
  dentition: Dentition
): ToothFinding {
  if (!isValidToothCode(toothCode, dentition)) {
    throw new Error(`Invalid ${dentition} FDI tooth code: ${toothCode}`);
  }
  return {
    toothCode,
    dentition,
    condition: "healthy",
    surfaces: [],
    notes: "",
    treatmentName: "",
    treatmentStatus: "planned",
  };
}

export function normalizeToothFinding(
  value: Partial<ToothFinding>,
  toothCode: string,
  dentition: Dentition
): ToothFinding {
  const base = createHealthyFinding(toothCode, dentition);
  const validConditions = new Set(
    TOOTH_CONDITIONS.map((condition) => condition.value)
  );
  const validSurfaces = new Set(
    TOOTH_SURFACES.map((surface) => surface.value)
  );
  const validStatuses = new Set<DentalTreatmentStatus>([
    "planned",
    "ongoing",
    "completed",
  ]);

  return {
    ...base,
    condition: validConditions.has(value.condition as ToothCondition)
      ? (value.condition as ToothCondition)
      : base.condition,
    surfaces: Array.from(
      new Set(
        (Array.isArray(value.surfaces) ? value.surfaces : []).filter(
          (surface): surface is ToothSurface =>
            validSurfaces.has(surface as ToothSurface)
        )
      )
    ),
    notes: String(value.notes ?? "").trim().slice(0, 1000),
    treatmentName: String(value.treatmentName ?? "").trim().slice(0, 160),
    treatmentStatus: validStatuses.has(
      value.treatmentStatus as DentalTreatmentStatus
    )
      ? (value.treatmentStatus as DentalTreatmentStatus)
      : base.treatmentStatus,
  };
}

export function conditionLabel(condition: ToothCondition) {
  return (
    TOOTH_CONDITIONS.find((item) => item.value === condition)?.label ??
    condition
  );
}

export function summarizeToothFindings(findings: ToothFinding[]) {
  const byCondition = findings.reduce<Record<string, number>>(
    (summary, finding) => {
      summary[finding.condition] = (summary[finding.condition] ?? 0) + 1;
      return summary;
    },
    {}
  );

  return {
    total: findings.length,
    affected: findings.filter((finding) => finding.condition !== "healthy")
      .length,
    treatmentLinked: findings.filter((finding) =>
      Boolean(finding.treatmentName)
    ).length,
    byCondition,
  };
}

function normalizedRole(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function canEditDentalChart(role?: string | null) {
  return ["owner", "head_doctor", "working_doctor", "doctor"].includes(
    normalizedRole(role)
  );
}

export function canViewFullDentalChart(role?: string | null) {
  return canEditDentalChart(role);
}

export function serializeToothFindings(findings: ToothFinding[]) {
  return findings.map((finding) => ({
    tooth_code: finding.toothCode,
    dentition: finding.dentition,
    condition: finding.condition,
    surfaces: finding.surfaces,
    notes: finding.notes || null,
    treatment_name: finding.treatmentName || null,
    treatment_status: finding.treatmentStatus,
  }));
}