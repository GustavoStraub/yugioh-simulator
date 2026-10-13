"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import { DuelBoard } from "@/components/duel/DuelBoard";
import { CardRegistryProvider, useCardRegistry } from "@/context/CardRegistryProvider";
import { useDuelEngine } from "@/hooks/useDuelEngine";
import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import {
  DUEL_SETUP_STORAGE_KEY,
  loadDuelSetup,
  type StoredDuelSetup,
} from "@/lib/duel/duel-storage";
import type { DuelSessionConfig } from "@/lib/duel/duel-session";
import { formatOf } from "@/lib/types";

function DuelLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-zinc-400">Preparando duelo...</p>
    </div>
  );
}

function DuelPlayInner() {
  const router = useRouter();
  const { registry, isLoading, error } = useCardRegistry();

  // `undefined` = ainda renderizando no servidor, onde não há sessionStorage;
  // `null` = já no navegador e não há duelo preparado. A distinção importa:
  // sem ela o redirecionamento dispararia durante a renderização do servidor.
  const setup = useClientSnapshot<StoredDuelSetup | null | undefined>(
    DUEL_SETUP_STORAGE_KEY,
    useCallback(() => sessionStorage.getItem(DUEL_SETUP_STORAGE_KEY), []),
    useCallback(() => loadDuelSetup(), []),
    undefined,
  );
  const mounted = setup !== undefined;

  useEffect(() => {
    if (mounted && !setup) {
      router.replace("/duel");
    }
  }, [mounted, setup, router]);

  const config: DuelSessionConfig | null = useMemo(
    () =>
      setup && registry
        ? {
            playerName: setup.playerName,
            playerDeck: setup.playerDeck,
            opponentName: setup.opponentName,
            opponentDeck: setup.opponentDeck,
            registry,
            format: formatOf(setup.format),
            scenario: setup.scenario,
          }
        : null,
    [setup, registry],
  );

  const { snapshot, respond, surrender, subscribeEvents } = useDuelEngine(
    mounted ? config : null,
  );

  if (!mounted || !setup) {
    return <DuelLoading />;
  }

  if (isLoading) {
    return <DuelLoading />;
  }

  if (error || !registry) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-sm text-red-300">{error ?? "Erro ao carregar cartas."}</p>
        <Link href="/duel" className="text-sm text-amber-400 hover:underline">
          Voltar ao lobby
        </Link>
      </div>
    );
  }

  return (
    <DuelBoard
      snapshot={snapshot}
      // Duelo local: você é sempre o assento 0, o bot é o 1.
      me={0}
      playerName={setup.playerName}
      opponentName={setup.opponentName}
      onRespond={(response) => void respond(response)}
      onSurrender={surrender}
      subscribeEvents={subscribeEvents}
    />
  );
}

export function DuelPlayApp() {
  return (
    <CardRegistryProvider>
      <DuelPlayInner />
    </CardRegistryProvider>
  );
}
