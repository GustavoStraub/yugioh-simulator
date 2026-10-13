"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { playSfx, type SfxName } from "@/lib/audio/sfx";
import type { ChainSpotlightState } from "@/components/duel/ChainSpotlight";
import type {
  DuelEvent,
  DuelEventListener,
  DuelZoneRef,
  LeaveReason,
} from "@/lib/duel/duel-events";
import { LEAVE_MS, TOSS_MS } from "@/lib/duel/pacing";

/** Quanto o destaque de uma ativação fica no centro. */
const SPOTLIGHT_ACTIVATE_MS = 1000;
/** E o de uma negação — o desfecho, um pouco mais. */
const SPOTLIGHT_NEGATED_MS = 1200;

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
  /** Velocidade escolhida — multiplica a duração do voo. */
  scale: number;
}

/** Uma carta saindo do campo (ver `LeaveFlightLayer`). */
export interface LeaveGhost {
  token: number;
  code: number | null;
  from: DuelZoneRef;
  why: LeaveReason;
  /** Já com a velocidade aplicada. */
  duration: number;
}

/**
 * O sistema pediu menos movimento?
 *
 * O CSS já corta as animações declaradas lá; as que rodam pela Web Animations
 * API (o voo do ataque, a compra, a saída do campo) não passam pelo CSS e
 * precisavam desta pergunta — antes elas voavam mesmo assim.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  /** Velocidade escolhida — multiplica a duração da investida. */
  scale: number;
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

/** Som de cada saída do campo: estilhaço, sumiço ou o baque de carta. */
const SFX_BY_LEAVE: Record<LeaveReason, SfxName> = {
  battle: "destroy",
  destroy: "destroy",
  banish: "banish",
  tribute: "place",
  material: "place",
  grave: "place",
  hand: "draw",
  deck: "draw",
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
  /**
   * Multiplicador das durações (a velocidade escolhida — ver `duel-prefs.ts`).
   * Precisa ser o mesmo das pausas da sessão: se a animação durar mais que a
   * pausa, o tabuleiro muda com ela ainda no ar.
   */
  scale = 1,
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
    /** Quanto a moeda gira — a pausa da sessão espera o mesmo. */
    duration: number;
  } | null>(null);
  /** A carta em destaque no centro (ativação ou negação de um elo). */
  const [spotlight, setSpotlight] = useState<ChainSpotlightState | null>(null);
  /** Cartas saindo do campo agora — várias de uma vez num Raigeki. */
  const [leaves, setLeaves] = useState<LeaveGhost[]>([]);
  const nextId = useRef(0);
  const lastLeaveSfx = useRef<{ name: SfxName | null; at: number }>({ name: null, at: 0 });
  const spotlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Num ref: a velocidade muda no meio do duelo e a assinatura dos eventos não
  // deve ser refeita por isso (perderia eventos no meio da troca).
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  /** O clique que pula: tira o destaque da ativação antes da hora. */
  const dismissSpotlight = useCallback(() => {
    if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
    setSpotlight(null);
  }, []);

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
      const veloc = scaleRef.current;
      const dur = (ms: number) => Math.max(1, Math.round(ms * veloc));
      // Som: invocação tem variantes; o resto é mapeamento direto.
      if (event.kind === "summon") {
        playSfx(event.special ? "specialSummon" : "summon");
      } else if (event.kind === "win") {
        playSfx(event.player === me ? "victory" : "defeat");
      } else if (event.kind === "leave") {
        // Um Raigeki tira cinco cartas no mesmo instante: cinco estalos
        // somados viram ruído. Um por motivo a cada instante basta.
        const agora = Date.now();
        const sfx = SFX_BY_LEAVE[event.why];
        if (lastLeaveSfx.current.name !== sfx || agora - lastLeaveSfx.current.at > 90) {
          playSfx(sfx);
          lastLeaveSfx.current = { name: sfx, at: agora };
        }
      } else {
        const sfx = SFX_BY_EVENT[event.kind];
        if (sfx) playSfx(sfx);
      }

      // Visual.
      switch (event.kind) {
        case "chainLink":
        case "chainNegated": {
          const negated = event.kind === "chainNegated";
          const duration = dur(negated ? SPOTLIGHT_NEGATED_MS : SPOTLIGHT_ACTIVATE_MS);
          const token = nextId.current++;
          setSpotlight({
            token,
            code: event.code,
            mine: event.player === me,
            link: event.link,
            from: event.kind === "chainLink" ? event.from : 0,
            kind: negated ? "negated" : "activate",
            what: event.kind === "chainNegated" ? event.what : undefined,
            duration,
          });
          // Um elo novo substitui o destaque anterior; o timer só apaga o
          // destaque que ele mesmo criou.
          if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
          spotlightTimer.current = setTimeout(() => {
            setSpotlight((current) => (current?.token === token ? null : current));
          }, duration);
          break;
        }
        case "draw":
          if (prefersReducedMotion()) break;
          setDraw({
            token: nextId.current++,
            player: event.player,
            count: event.count,
            scale: veloc,
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
          setToss({ kind: event.kind, results: event.results, duration: dur(TOSS_MS) });
          setTimeout(() => setToss(null), dur(TOSS_MS));
          break;
        case "leave": {
          if (prefersReducedMotion()) break;
          const token = nextId.current++;
          const duration = dur(LEAVE_MS[event.why]);
          setLeaves((current) => [
            ...current,
            { token, code: event.code, from: event.from, why: event.why, duration },
          ]);
          setTimeout(() => {
            setLeaves((current) => current.filter((leave) => leave.token !== token));
          }, duration + 40);
          break;
        }
        case "turn":
          pushFlash(
            event.player === me ? "SEU TURNO" : "TURNO DO OPONENTE",
            "neutral",
            dur(1200),
          );
          break;
        case "damage":
          pushFlash(
            `-${event.amount}`,
            event.player === me ? "bad" : "good",
            dur(900),
            event.player === me ? "player" : "opponent",
          );
          setShake(event.player === me ? "mine" : "theirs");
          setTimeout(() => setShake(null), 420);
          break;
        case "recover":
          pushFlash(
            `+${event.amount}`,
            "good",
            dur(900),
            event.player === me ? "player" : "opponent",
          );
          break;
        case "attack":
          if (prefersReducedMotion()) break;
          setFlight({
            token: nextId.current++,
            from: event.from,
            to: event.to,
            mine: event.player === me,
            scale: veloc,
          });
          if (event.direct) {
            pushFlash("ATAQUE DIRETO", event.player === me ? "good" : "bad", dur(850));
          }
          break;
        default:
          break;
      }
    });
  }, [subscribe, pushFlash, me]);

  return { flashes, shake, toss, flight, reveal, draw, spotlight, leaves, dismissSpotlight };
}
