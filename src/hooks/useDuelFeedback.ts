"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { playSfx, type SfxName } from "@/lib/audio/sfx";
import type {
  DuelEvent,
  DuelEventListener,
  DuelZoneRef,
} from "@/lib/duel/duel-events";

/** Efeito visual momentâneo disparado por um evento do duelo. */
export interface DuelFlash {
  id: number;
  /** Texto do aviso (ex.: "SEU TURNO", "-1800"). */
  text: string;
  tone: "neutral" | "good" | "bad";
  /** Quanto tempo o elemento fica montado, em ms. */
  duration: number;
  /**
   * Onde o aviso aparece. Números de LP vão para o lado de quem foi afetado —
   * um "-1800" sempre no centro faz parecer que o dano foi seu mesmo quando o
   * oponente é que levou.
   */
  anchor: "center" | "player" | "opponent";
}

/** Uma compra a ser animada; `token` muda a cada evento para reanimar. */
export interface DrawFlight {
  token: number;
  player: number;
  count: number;
}

/** Um ataque a ser animado; `token` muda a cada evento para reanimar. */
export interface AttackFlight {
  token: number;
  from: DuelZoneRef;
  to: DuelZoneRef | null;
  /**
   * O atacante sou eu?
   *
   * Já resolvido aqui, e não um índice absoluto de jogador, porque quem anima
   * precisa saber para que **lado da tela** o ataque direto avança — e o lado
   * depende de qual assento está sendo assistido. Traduzir uma vez, onde o
   * assento é conhecido, evita espalhar `me` por dentro das animações.
   */
  mine: boolean;
}

const SFX_BY_EVENT: Partial<Record<DuelEvent["kind"], SfxName>> = {
  set: "place",
  flip: "flip",
  activate: "activate",
  attack: "attack",
  damage: "damage",
  recover: "recover",
  phase: "phase",
  turn: "turn",
  draw: "draw",
  position: "flip",
  coin: "flip",
  dice: "flip",
  reveal: "draw",
};

/**
 * Traduz os eventos do duelo em som e em feedback visual.
 *
 * Devolve o que a tela precisa para reagir: os avisos flutuantes, se o
 * tabuleiro deve tremer e de quem é o lado que levou dano.
 */
/**
 * @param me assento que está assistindo — decide o que é "meu" e o que é "do
 *   oponente" em som, aviso e animação.
 */
export function useDuelFeedback(
  subscribe: ((listener: DuelEventListener) => () => void) | null,
  me: 0 | 1 = 0,
) {
  const [flashes, setFlashes] = useState<DuelFlash[]>([]);
  /** Que metade da tela treme — já em coordenadas de quem assiste. */
  const [shake, setShake] = useState<"mine" | "theirs" | null>(null);
  /** Moeda/dado em rolagem — a tela mostra o resultado depois de girar. */
  const [flight, setFlight] = useState<AttackFlight | null>(null);
  const [draw, setDraw] = useState<DrawFlight | null>(null);
  /** Cartas reveladas por um efeito, exibidas por alguns segundos. */
  const [reveal, setReveal] = useState<{
    codes: number[];
    title: string;
  } | null>(null);
  const [toss, setToss] = useState<{
    kind: "coin" | "dice";
    results: (boolean | number)[];
  } | null>(null);
  const nextId = useRef(0);

  const pushFlash = useCallback(
    (
      text: string,
      tone: DuelFlash["tone"],
      duration = 1100,
      anchor: DuelFlash["anchor"] = "center",
    ) => {
      const id = nextId.current++;
      setFlashes((current) => [
        ...current,
        { id, text, tone, duration, anchor },
      ]);
      // O elemento se remove sozinho ao fim da animação para não acumular.
      setTimeout(() => {
        setFlashes((current) => current.filter((flash) => flash.id !== id));
      }, duration);
    },
    [],
  );

  useEffect(() => {
    if (!subscribe) return;

    return subscribe((event) => {
      // Som: invocação tem variantes; o resto é mapeamento direto.
      if (event.kind === "summon") {
        playSfx(event.special ? "specialSummon" : "summon");
      } else if (event.kind === "win") {
        playSfx(event.player === me ? "victory" : "defeat");
      } else {
        const sfx = SFX_BY_EVENT[event.kind];
        if (sfx) playSfx(sfx);
      }

      // Visual.
      switch (event.kind) {
        case "draw":
          setDraw({
            token: nextId.current++,
            player: event.player,
            count: event.count,
          });
          break;
        case "reveal":
          // A revelação é dirigida a um assento. Numa sessão local o outro é o
          // bot e o evento nem chega aqui; num duelo online chegar não basta —
          // mostrar a lista a quem não tinha direito é entregar a carta.
          if (event.visibleTo !== me) break;
          setReveal({ codes: event.codes, title: event.title });
          setTimeout(() => setReveal(null), 3200);
          break;
        case "coin":
        case "dice":
          setToss({ kind: event.kind, results: event.results });
          setTimeout(() => setToss(null), 1900);
          break;
        case "turn":
          pushFlash(
            event.player === me ? "SEU TURNO" : "TURNO DO OPONENTE",
            "neutral",
            1200,
          );
          break;
        case "damage":
          pushFlash(
            `-${event.amount}`,
            event.player === me ? "bad" : "good",
            900,
            event.player === me ? "player" : "opponent",
          );
          setShake(event.player === me ? "mine" : "theirs");
          setTimeout(() => setShake(null), 420);
          break;
        case "recover":
          pushFlash(
            `+${event.amount}`,
            "good",
            900,
            event.player === me ? "player" : "opponent",
          );
          break;
        case "attack":
          setFlight({
            token: nextId.current++,
            from: event.from,
            to: event.to,
            mine: event.player === me,
          });
          if (event.direct) {
            pushFlash("ATAQUE DIRETO", event.player === me ? "good" : "bad", 850);
          }
          break;
        default:
          break;
      }
    });
  }, [subscribe, pushFlash, me]);

  return { flashes, shake, toss, flight, reveal, draw };
}
