import { useCallback, useRef } from "react";

export function useImmediateMutationLock() {
  const inFlightRef = useRef(false);

  const tryLock = useCallback(() => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    return true;
  }, []);

  const release = useCallback(() => {
    inFlightRef.current = false;
  }, []);

  return { tryLock, release } as const;
}
