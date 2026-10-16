"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A janela casa com uma media query agora?
 *
 * `useSyncExternalStore` pelo mesmo motivo de `useClientSnapshot`: o servidor
 * renderiza sem `window` (devolve `serverValue`), o navegador responde de
 * verdade, e o React reconcilia sem render extra nem aviso de hidratação.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const lista = window.matchMedia(query);
      lista.addEventListener("change", notify);
      return () => lista.removeEventListener("change", notify);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/**
 * Mesa compacta: tablet e celular, inclusive os telefones largos deitados.
 * Os dois trilhos laterais comeriam a mesa; com pouca largura OU altura,
 * o histórico vira um painel que se abre por um botão. A leitura fica na
 * lateral na horizontal; na vertical, sobe numa folha por toque longo.
 */
export const NARROW_TABLE_QUERY = "(max-width: 1180px), (max-height: 600px)";

/** Na horizontal a leitura ocupa a sobra lateral, sem reduzir a altura da mesa. */
export const LANDSCAPE_READER_QUERY = "(min-width: 560px) and (orientation: landscape)";

/**
 * Mesa baixa: celular deitado. A altura some antes da largura — os painéis por
 * cima da mesa (objetivo do problema) começam fechados.
 */
export const SHORT_TABLE_QUERY = "(max-height: 500px)";
