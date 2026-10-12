"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Lê um valor que só existe no navegador (localStorage, sessionStorage).
 *
 * O caminho ingênuo — `useState` vazio e um `useEffect` que faz `setState` com
 * o valor lido — funciona, mas força um render a mais logo depois da
 * montagem, e é o que a regra `react-hooks/set-state-in-effect` aponta. Pior:
 * ler direto no inicializador do `useState` também não serve, porque o
 * servidor renderiza sem `localStorage` e o cliente renderiza com ele — e o
 * React acusa divergência de hidratação.
 *
 * `useSyncExternalStore` existe exatamente para esse par de problemas: o
 * `getServerSnapshot` devolve o valor que o servidor pode renderizar, o
 * `getSnapshot` devolve o do navegador, e o React reconcilia sem cascata.
 *
 * A leitura é **memoizada por chave**: `getSnapshot` precisa devolver a mesma
 * referência enquanto nada mudou, senão o React entra em laço de render. O
 * cache é invalidado por `invalidateClientSnapshot`, que quem escreve chama
 * depois de gravar.
 */
const cache = new Map<string, { raw: string | null; value: unknown }>();
const listeners = new Map<string, Set<() => void>>();

/** Avisa que o valor guardado sob `key` mudou — chame depois de gravar. */
export function invalidateClientSnapshot(key: string): void {
  cache.delete(key);
  listeners.get(key)?.forEach((notify) => notify());
}

function read<T>(key: string, readRaw: () => string | null, parse: (raw: string | null) => T): T {
  const raw = readRaw();
  const cached = cache.get(key);
  // Só reprocessa quando o texto bruto mudou: assim a referência devolvida
  // continua estável e o `useSyncExternalStore` não re-renderiza à toa.
  if (cached && cached.raw === raw) return cached.value as T;
  const value = parse(raw);
  cache.set(key, { raw, value });
  return value;
}

/**
 * @param key chave do armazenamento — identifica o valor no cache.
 * @param readRaw devolve o texto cru guardado (ou null).
 * @param parse converte o texto cru no valor usado pela tela.
 * @param serverValue o que renderizar no servidor, onde não há armazenamento.
 */
export function useClientSnapshot<T>(
  key: string,
  readRaw: () => string | null,
  parse: (raw: string | null) => T,
  serverValue: T,
): T {
  const subscribe = useCallback(
    (notify: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(notify);

      // Outra aba mexendo no mesmo armazenamento também conta como mudança.
      const onStorage = (event: StorageEvent) => {
        if (!event.key || event.key === key) invalidateClientSnapshot(key);
      };
      window.addEventListener("storage", onStorage);

      return () => {
        set?.delete(notify);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(
    () => read(key, readRaw, parse),
    [key, readRaw, parse],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}
