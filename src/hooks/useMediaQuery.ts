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
 * Mesa estreita: tablet em pé, celular. Os dois trilhos laterais (330 + 300
 * px) comeriam a mesa inteira; abaixo disto a leitura da carta vira uma folha
 * que sobe de baixo (toque longo numa carta) e o histórico vira um painel que
 * se abre por um botão, deixando a largura para as cartas.
 */
export const NARROW_TABLE_QUERY = "(max-width: 900px)";
