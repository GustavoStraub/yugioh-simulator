"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CardRegistry } from "@/lib/domain/card-registry";
import type { CardDefinition, YgoProDeckCard } from "@/lib/types";

interface CardRegistryContextValue {
  registry: CardRegistry | null;
  cards: CardDefinition[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const CardRegistryContext = createContext<CardRegistryContextValue | null>(
  null,
);

export function CardRegistryProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<CardRegistry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Busca o catálogo e aplica o resultado.
   *
   * Não mexe em `isLoading`/`error` de forma síncrona: o estado inicial já
   * nasce "carregando", e um `setState` síncrono dentro do efeito provoca o
   * render em cascata que a regra `react-hooks/set-state-in-effect` aponta.
   * Quem recarrega de propósito usa `reload`, que marca o estado antes.
   */
  const buscar = useCallback(async () => {
    try {
      const response = await fetch("/api/cards");
      const payload = (await response.json()) as {
        data?: YgoProDeckCard[];
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Falha ao carregar cartas.");
      }

      setRegistry(CardRegistry.fromApiResponse(payload.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setRegistry(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // A regra segue para dentro de `buscar` e vê os `setState` dela, mas não
    // distingue síncrono de pós-`await`: o corpo de `buscar` começa em
    // `await fetch(...)`, então nenhum estado é alterado no mesmo tick do
    // efeito e a cascata que a regra evita não existe aqui. Verificado lendo
    // a função — se alguém puser um `setState` antes do primeiro `await`,
    // este comentário deixa de valer e a supressão precisa sair.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar();
  }, [buscar]);

  /** Recarga pedida pelo usuário: aí sim o estado volta para "carregando". */
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await buscar();
  }, [buscar]);

  const value = useMemo<CardRegistryContextValue>(
    () => ({
      registry,
      cards: registry?.getAll() ?? [],
      isLoading,
      error,
      reload: load,
    }),
    [registry, isLoading, error, load],
  );

  return (
    <CardRegistryContext.Provider value={value}>
      {children}
    </CardRegistryContext.Provider>
  );
}

export function useCardRegistry(): CardRegistryContextValue {
  const context = useContext(CardRegistryContext);
  if (!context) {
    throw new Error("useCardRegistry deve ser usado dentro de CardRegistryProvider.");
  }
  return context;
}
