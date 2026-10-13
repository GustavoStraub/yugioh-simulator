"use client";

import { useCallback, useState } from "react";

import { invalidateClientSnapshot, useClientSnapshot } from "@/hooks/useClientSnapshot";
import {
  DEFAULT_DUEL_PREFS,
  DUEL_PREFS_KEY,
  parseDuelPrefs,
  readDuelPrefsRaw,
  writeDuelPrefs,
  type DuelPrefs,
} from "@/lib/duel/duel-prefs";

/**
 * As preferências da mesa (ver `duel-prefs.ts`), lidas do navegador e
 * graváveis.
 *
 * Quando o navegador não deixa gravar (aba anônima com armazenamento
 * bloqueado), a escolha ainda vale para esta aba: fica num estado local por
 * cima do que foi lido, em vez de o seletor "voltar sozinho" ao padrão.
 */
export function useDuelPrefs(): [DuelPrefs, (next: Partial<DuelPrefs>) => void] {
  const stored = useClientSnapshot<DuelPrefs>(
    DUEL_PREFS_KEY,
    readDuelPrefsRaw,
    parseDuelPrefs,
    DEFAULT_DUEL_PREFS,
  );
  const [override, setOverride] = useState<DuelPrefs | null>(null);
  const prefs = override ?? stored;

  const update = useCallback(
    (next: Partial<DuelPrefs>) => {
      const merged = { ...prefs, ...next };
      if (writeDuelPrefs(merged)) {
        setOverride(null);
        invalidateClientSnapshot(DUEL_PREFS_KEY);
      } else {
        setOverride(merged);
      }
    },
    [prefs],
  );

  return [prefs, update];
}
