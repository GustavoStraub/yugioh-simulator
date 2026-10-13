"use client";

import { useEffect, useMemo, useState } from "react";

import type { DuelEventListener } from "@/lib/duel/duel-events";
import {
  createDuelSession,
  type DuelSessionConfig,
  type DuelSnapshot,
} from "@/lib/duel/duel-session";

export function useDuelEngine(config: DuelSessionConfig | null) {
  // A sessão vive em state (criada uma única vez) e não num ref: assim ela
  // pode ser lida durante o render para semear o snapshot inicial.
  const [session] = useState(createDuelSession);
  const [snapshot, setSnapshot] = useState<DuelSnapshot>(() =>
    session.getSnapshot(),
  );

  useEffect(() => session.subscribe(setSnapshot), [session]);

  useEffect(() => {
    if (!config) return;
    void session.start(config);
  }, [config, session]);

  const actions = useMemo(
    () => ({
      respond: (response: Parameters<typeof session.respond>[0]) =>
        session.respond(response),
      /** Assinatura estável dos eventos transitórios (animação e som). */
      subscribeEvents: (listener: DuelEventListener) =>
        session.subscribeEvents(listener),
      /** Desistir — no duelo local quem desiste é sempre o assento 0. */
      surrender: () => session.surrender(0),
      /** Modo de resposta e "Ctrl segurado" do jogador (assento 0). */
      setChainPreference: (preference: Parameters<typeof session.setChainPreference>[1]) =>
        session.setChainPreference(0, preference),
      /** Ritmo das pausas entre jogadas (1 = normal). */
      setPace: (scale: number) => session.setPace(scale),
      /** Encerra a pausa em curso — o clique que pula a animação. */
      hurry: () => session.hurry(),
    }),
    [session],
  );

  return { snapshot, ...actions };
}
