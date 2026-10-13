"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DuelBoard } from "@/components/duel/DuelBoard";
import { CardRegistryProvider, useCardRegistry } from "@/context/CardRegistryProvider";
import { useDuelEngine } from "@/hooks/useDuelEngine";
import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import { useDuelPrefs } from "@/hooks/useDuelPrefs";
import { SPEED_SCALE } from "@/lib/duel/duel-prefs";
import {
  DUEL_SETUP_STORAGE_KEY,
  loadDuelSetup,
  resolveFirstTurn,
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

/** Quem começa nesta partida, quando a revanche sorteou de novo. */
interface Partida {
  n: number;
  humanSeat?: 0 | 1;
  openingNote?: string;
}

function DuelPlayInner({
  partida,
  onRematch,
}: {
  partida: Partida;
  onRematch: (next: Omit<Partida, "n">) => void;
}) {
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
            humanSeat: partida.humanSeat ?? setup.humanSeat ?? 0,
            openingNote: partida.n > 0 ? partida.openingNote : setup.openingNote,
          }
        : null,
    [setup, registry, partida],
  );
  /** O assento de quem joga — 1 quando o bot começa. */
  const me: 0 | 1 = config?.humanSeat === 1 ? 1 : 0;

  const { snapshot, respond, surrender, subscribeEvents, setChainPreference, setPace, hurry } =
    useDuelEngine(mounted ? config : null);

  // Preferências da mesa → sessão: o modo de resposta e o ritmo valem já na
  // próxima janela/pausa, sem recomeçar o duelo.
  const [prefs, setPrefs] = useDuelPrefs();
  useEffect(() => {
    setChainPreference({ mode: prefs.chainMode });
  }, [prefs.chainMode, setChainPreference]);
  useEffect(() => {
    setPace(SPEED_SCALE[prefs.speed]);
  }, [prefs.speed, setPace]);
  const forceAsk = useCallback(
    (held: boolean) => setChainPreference({ forceAsk: held }),
    [setChainPreference],
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
      // Duelo local: você é o assento 0, ou o 1 quando o bot começa.
      me={me}
      playerName={setup.playerName}
      opponentName={setup.opponentName}
      onRespond={(response) => void respond(response)}
      onSurrender={surrender}
      subscribeEvents={subscribeEvents}
      prefs={prefs}
      onPrefsChange={setPrefs}
      onForceAsk={forceAsk}
      onHurry={hurry}
      pacing="local"
      ending={{
        backHref: "/duel",
        backLabel: "Voltar ao lobby",
        // Revanche: com "moeda" a moeda cai de novo; senão, a mesma ordem.
        onRematch: () =>
          onRematch(
            setup.firstTurn === "coin"
              ? resolveFirstTurn("coin")
              : { humanSeat: me, openingNote: undefined },
          ),
      }}
    />
  );
}

export function DuelPlayApp() {
  /**
   * Número da partida — a revanche troca a `key` e remonta a mesa, o que dá
   * uma sessão nova com os mesmos decks (o preparo do lobby continua no
   * sessionStorage). Mais simples e mais seguro do que "zerar" uma sessão
   * do engine que já terminou.
   */
  const [partida, setPartida] = useState<Partida>({ n: 0 });
  return (
    <CardRegistryProvider>
      <DuelPlayInner
        key={partida.n}
        partida={partida}
        onRematch={(next) => setPartida((atual) => ({ n: atual.n + 1, ...next }))}
      />
    </CardRegistryProvider>
  );
}
