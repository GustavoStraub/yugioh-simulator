"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DuelEventListener } from "@/lib/duel/duel-events";
import {
  createDuelSession,
  type DuelSessionConfig,
  type DuelSnapshot,
} from "@/lib/duel/duel-session";

export function useDuelEngine(config: DuelSessionConfig | null, observe?: (snapshot: DuelSnapshot) => void) {
  /**
   * O assento de quem joga — 1 quando o bot começa (ver
   * `DuelSessionConfig.humanSeat`). Num ref: as ações abaixo são estáveis e
   * precisam ler o assento do duelo que está de pé.
   */
  const humanSeatRef = useRef<0 | 1>(0);
  useEffect(() => {
    humanSeatRef.current = config?.humanSeat === 1 ? 1 : 0;
  }, [config]);
  // A sessão vive em state (criada uma única vez) e não num ref: assim ela
  // pode ser lida durante o render para semear o snapshot inicial.
  const [session] = useState(createDuelSession);
  const generation = useRef({ value: 0 });
  const [snapshot, setSnapshot] = useState<DuelSnapshot>(() =>
    session.getSnapshot(),
  );

  useEffect(() => session.subscribe((next) => {
    setSnapshot(next);
    observe?.(next);
  }), [session, observe]);

  useEffect(() => {
    if (!config) return;
    void session.start(config);
  }, [config, session]);

  useEffect(() => {
    const lifecycle = generation.current;
    const mounted = ++lifecycle.value;
    return () => {
      // O segundo setup do Strict Mode ocorre antes desta microtask.
      queueMicrotask(() => { if (lifecycle.value === mounted) session.dispose(); });
    };
  }, [session]);

  const actions = useMemo(
    () => ({
      respond: (response: Parameters<typeof session.respond>[0]) =>
        session.respond(response),
      /** Assinatura estável dos eventos transitórios (animação e som). */
      subscribeEvents: (listener: DuelEventListener) =>
        session.subscribeEvents(listener),
      /** Desistir — quem desiste é o assento de quem joga. */
      surrender: () => session.surrender(humanSeatRef.current),
      /** Modo de resposta e "Ctrl segurado" de quem joga. */
      setChainPreference: (preference: Parameters<typeof session.setChainPreference>[1]) =>
        session.setChainPreference(humanSeatRef.current, preference),
      /** Ritmo das pausas entre jogadas (1 = normal). */
      setPace: (scale: number) => session.setPace(scale),
      /** Cortes de invocação (a arte em tela cheia) ligados ou não. */
      setCutIns: (on: boolean) => session.setCutIns(on),
      /** Encerra a pausa em curso — o clique que pula a animação. */
      hurry: () => session.hurry(),
    }),
    [session],
  );

  return { snapshot, ...actions };
}
