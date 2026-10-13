"use client";

import { useCallback, useState } from "react";

import { invalidateClientSnapshot, useClientSnapshot } from "@/hooks/useClientSnapshot";
import { DEFAULT_TIPS, parseTips, TIPS_KEY, type TipsState } from "@/lib/duel/tips";

function lerCru(): string | null {
  try {
    return localStorage.getItem(TIPS_KEY);
  } catch {
    return null;
  }
}

/**
 * Quais dicas o jogador já viu, e se ele as desligou (ver `tips.ts`).
 *
 * No navegador, como as outras preferências da mesa. Sem armazenamento
 * (aba anônima bloqueada) o estado vale só para esta aba.
 */
export function useTips() {
  const guardado = useClientSnapshot<TipsState>(TIPS_KEY, lerCru, parseTips, DEFAULT_TIPS);
  const [local, setLocal] = useState<TipsState | null>(null);
  const tips = local ?? guardado;

  const gravar = useCallback((proximo: TipsState) => {
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify(proximo));
      setLocal(null);
      invalidateClientSnapshot(TIPS_KEY);
    } catch {
      setLocal(proximo);
    }
  }, []);

  const markSeen = useCallback(
    (id: string) => gravar({ ...tips, seen: [...new Set([...tips.seen, id])] }),
    [tips, gravar],
  );
  const setOff = useCallback((off: boolean) => gravar({ ...tips, off }), [tips, gravar]);
  const reset = useCallback(() => gravar({ off: false, seen: [] }), [gravar]);

  return { tips, markSeen, setOff, reset };
}
