import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dentition,
  isValidToothCode,
  normalizeToothFinding,
  ToothFinding,
} from "@/lib/toothChart";

const STORAGE_KEY = "capdent:visit-drafts:v1";
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type VisitDraft = {
  patientId: string;
  draftId: string;
  dentition: Dentition;
  findings: Record<string, ToothFinding>;
  updatedAt: string;
};

type DraftStore = Record<string, VisitDraft>;

type VisitDraftContextValue = {
  loaded: boolean;
  drafts: DraftStore;
  updateDraft: (
    patientId: string,
    draftId: string,
    update: (current: VisitDraft) => VisitDraft
  ) => void;
  clearDraft: (patientId: string, draftId: string) => Promise<void>;
};

const VisitDraftContext = createContext<VisitDraftContextValue | null>(null);

function cleanId(value: string, label: string) {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function draftKey(patientId: string, draftId: string) {
  return `${cleanId(patientId, "patient id")}:${cleanId(draftId, "draft id")}`;
}

function emptyDraft(patientId: string, draftId: string): VisitDraft {
  return {
    patientId,
    draftId,
    dentition: "permanent",
    findings: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDraft(value: Partial<VisitDraft>): VisitDraft | null {
  try {
    const patientId = cleanId(String(value.patientId ?? ""), "patient id");
    const draftId = cleanId(String(value.draftId ?? ""), "draft id");
    const dentition: Dentition =
      value.dentition === "primary" ? "primary" : "permanent";
    const findings = Object.entries(value.findings ?? {}).reduce<
      Record<string, ToothFinding>
    >((result, [code, finding]) => {
      const findingDentition: Dentition =
        finding?.dentition === "primary" ? "primary" : "permanent";
      if (isValidToothCode(code, findingDentition)) {
        result[code] = normalizeToothFinding(
          finding,
          code,
          findingDentition
        );
      }
      return result;
    }, {});

    return {
      patientId,
      draftId,
      dentition,
      findings,
      updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function VisitDraftProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState<DraftStore>({});
  const draftsRef = useRef<DraftStore>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as DraftStore) : {};
        const normalized = Object.values(parsed).reduce<DraftStore>(
          (result, draft) => {
            const cleanDraft = normalizeDraft(draft);
            if (cleanDraft) {
              result[draftKey(cleanDraft.patientId, cleanDraft.draftId)] =
                cleanDraft;
            }
            return result;
          },
          {}
        );
        if (active) {
          draftsRef.current = normalized;
          setDrafts(normalized);
        }
      } catch (error) {
        console.warn(
          "Visit drafts could not be restored:",
          error instanceof Error ? error.message : error
        );
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)).catch(
      (error) => {
        console.warn(
          "Visit draft persistence failed:",
          error instanceof Error ? error.message : error
        );
      }
    );
  }, [drafts, loaded]);

  const updateDraft = useCallback<VisitDraftContextValue["updateDraft"]>(
    (patientId, draftId, update) => {
      const key = draftKey(patientId, draftId);
      setDrafts((current) => {
        const next = update(
          current[key] ?? emptyDraft(patientId, draftId)
        );
        const updated = {
          ...current,
          [key]: {
            ...next,
            patientId,
            draftId,
            updatedAt: new Date().toISOString(),
          },
        };
        draftsRef.current = updated;
        return updated;
      });
    },
    []
  );

  const clearDraft = useCallback(
    async (patientId: string, draftId: string) => {
      const key = draftKey(patientId, draftId);
      const next = { ...draftsRef.current };
      delete next[key];
      draftsRef.current = next;
      setDrafts(next);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    []
  );

  const value = useMemo(
    () => ({ loaded, drafts, updateDraft, clearDraft }),
    [clearDraft, drafts, loaded, updateDraft]
  );

  return (
    <VisitDraftContext.Provider value={value}>
      {children}
    </VisitDraftContext.Provider>
  );
}

export function useVisitDraft(patientId: string, draftId: string) {
  const context = useContext(VisitDraftContext);
  if (!context) {
    throw new Error("useVisitDraft must be used inside VisitDraftProvider");
  }

  const key =
    patientId && draftId && SAFE_ID.test(patientId) && SAFE_ID.test(draftId)
      ? `${patientId}:${draftId}`
      : "";
  const draft =
    (key ? context.drafts[key] : null) ??
    (patientId && draftId
      ? emptyDraft(patientId, draftId)
      : emptyDraft("unselected", "inactive"));

  const setDentition = useCallback(
    (dentition: Dentition) => {
      if (!patientId || !draftId) return;
      context.updateDraft(patientId, draftId, (current) => ({
        ...current,
        dentition,
        // Preserve the other dentition for mixed-dentition patients. FDI codes
        // do not overlap, so the active viewing mode can switch safely.
        findings: current.findings,
      }));
    },
    [context, draftId, patientId]
  );

  const applyFinding = useCallback(
    (codes: string[], finding: Partial<ToothFinding>) => {
      if (!patientId || !draftId) return;
      context.updateDraft(patientId, draftId, (current) => {
        const findings = { ...current.findings };
        for (const code of codes) {
          if (!isValidToothCode(code, current.dentition)) continue;
          const normalized = normalizeToothFinding(
            { ...(findings[code] ?? {}), ...finding },
            code,
            current.dentition
          );
          if (
            normalized.condition === "healthy" &&
            normalized.surfaces.length === 0 &&
            !normalized.notes &&
            !normalized.treatmentName
          ) {
            delete findings[code];
          } else {
            findings[code] = normalized;
          }
        }
        return { ...current, findings };
      });
    },
    [context, draftId, patientId]
  );

  const removeFindings = useCallback(
    (codes: string[]) => {
      if (!patientId || !draftId) return;
      context.updateDraft(patientId, draftId, (current) => {
        const findings = { ...current.findings };
        for (const code of codes) delete findings[code];
        return { ...current, findings };
      });
    },
    [context, draftId, patientId]
  );

  const clear = useCallback(
    () =>
      patientId && draftId
        ? context.clearDraft(patientId, draftId)
        : Promise.resolve(),
    [context, draftId, patientId]
  );

  return {
    loaded: context.loaded,
    draft,
    findings: Object.values(draft.findings),
    setDentition,
    applyFinding,
    removeFindings,
    clear,
  };
}
