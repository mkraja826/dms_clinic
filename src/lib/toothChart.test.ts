import {
  createHealthyFinding,
  FDI_ARCHES,
  getToothDefinition,
  isValidToothCode,
  normalizeToothFinding,
  summarizeToothFindings,
} from "./toothChart";

declare const Deno: {
  test(name: string, test: () => void | Promise<void>): void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("FDI arches include 32 permanent and 20 primary teeth", () => {
  assert(
    FDI_ARCHES.permanent.upper.length +
      FDI_ARCHES.permanent.lower.length ===
      32,
    "Permanent chart must include 32 teeth"
  );
  assert(
    FDI_ARCHES.primary.upper.length + FDI_ARCHES.primary.lower.length === 20,
    "Primary chart must include 20 teeth"
  );
});

Deno.test("FDI validation rejects mismatched dentition", () => {
  assert(isValidToothCode("18", "permanent"), "18 should be permanent");
  assert(!isValidToothCode("18", "primary"), "18 should not be primary");
  assert(isValidToothCode("55", "primary"), "55 should be primary");
  assert(!isValidToothCode("99"), "99 is not an FDI tooth");
});

Deno.test("tooth families are derived from FDI position", () => {
  assert(
    getToothDefinition("11", "permanent")?.family === "incisor",
    "11 should be an incisor"
  );
  assert(
    getToothDefinition("13", "permanent")?.family === "canine",
    "13 should be a canine"
  );
  assert(
    getToothDefinition("14", "permanent")?.family === "premolar",
    "14 should be a premolar"
  );
  assert(
    getToothDefinition("16", "permanent")?.family === "molar",
    "16 should be a molar"
  );
});

Deno.test("normalization removes invalid surfaces and bounds notes", () => {
  const normalized = normalizeToothFinding(
    {
      condition: "caries",
      surfaces: ["mesial", "mesial", "invalid" as never],
      notes: "x".repeat(1200),
    },
    "16",
    "permanent"
  );
  assert(normalized.surfaces.length === 1, "Surfaces should be unique");
  assert(normalized.notes.length === 1000, "Notes should be bounded");
});

Deno.test("summaries distinguish charted and affected teeth", () => {
  const healthy = createHealthyFinding("11", "permanent");
  const caries = {
    ...createHealthyFinding("16", "permanent"),
    condition: "caries" as const,
    treatmentName: "Filling",
  };
  const summary = summarizeToothFindings([healthy, caries]);
  assert(summary.total === 2, "Two findings should be charted");
  assert(summary.affected === 1, "Only caries should be affected");
  assert(summary.treatmentLinked === 1, "One finding links a treatment");
});
