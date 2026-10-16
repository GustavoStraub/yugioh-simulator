"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { playSfx, type SfxName } from "@/lib/audio/sfx";
import type { ChainEffectNoticeState, ChainSpotlightState } from "@/components/duel/ChainSpotlight";
import type { DuelBanner } from "@/components/duel/MdBanners";
import type {
  CutInKind,
  DuelEvent,
  DuelEventListener,
  DuelZoneRef,
  LeaveReason,
} from "@/lib/duel/duel-events";
import { CUT_IN_MS, EFFECT_READ_MS, LEAVE_MS, LIFE_POINT_MS, TOSS_MS, TURN_BEAT } from "@/lib/duel/pacing";
import { mdPhaseBanner } from "@/lib/duel/phase-labels";

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
  /**
   * A virada de turno vira a faixa do Master Duel atravessando a mesa —
   * azul no seu turno, vermelha no do oponente — e não um texto solto.
   */
  band?: "mine" | "foe";
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
  /** Para onde foi — o voo termina na pilha de lá. */
  to: DuelZoneRef;
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

/** O corte de invocação em curso (ver `SummonCutIn`). */
export interface SummonCutInState {
  token: number;
  code: number;
  kind: CutInKind;
  /** Quem invocou é quem olha a mesa? */
  mine: boolean;
  /** Já na velocidade escolhida. */
  duration: number;
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
  phase: "banner",
  turn: "turn",
  chainLink: "chain",
  draw: "draw",
  position: "flip",
  coin: "coin",
  dice: "dice",
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
 * A fila das faixas do MD ("TURN CHANGE", "DRAW PHASE"…).
 *
 * Cada faixa fica pelo menos 55% do tempo dela antes de a seguinte entrar — a
 * virada de turno puxa três ou quatro fases em sequência; sem fila, ela
 * termina e some. Fila curta: se as fases correram na frente (turno do bot sem
 * nada a fazer), as faixas de fase que ficaram para trás saem — melhor pular
 * "STANDBY PHASE" do que mostrá-la com a mesa já na Main Phase.
 *
 * Um objeto com estado próprio, e não estado do React: é um relógio, não algo
 * que a tela desenha (quem desenha é a faixa que ela põe no ar).
 */
function criarFilaDeFaixas(
  mostrar: (faixa: DuelBanner | null | ((atual: DuelBanner | null) => DuelBanner | null)) => void,
) {
  let fila: DuelBanner[] = [];
  let relogio: ReturnType<typeof setTimeout> | null = null;
  let proximoId = 0;
  const tocar = () => {
    if (relogio) return;
    const proxima = fila.shift();
    if (!proxima) return;
    mostrar(proxima);
    relogio = setTimeout(() => {
      relogio = null;
      if (fila.length > 0) {
        tocar();
        return;
      }
      relogio = setTimeout(() => {
        relogio = null;
        mostrar((atual) => (atual?.id === proxima.id ? null : atual));
        tocar();
      }, Math.round(proxima.duration * 0.45));
    }, Math.round(proxima.duration * 0.55));
  };
  return {
    enfileirar(faixa: Omit<DuelBanner, "id">) {
      if (!faixa.big) fila = fila.filter((f) => f.big);
      fila.push({ ...faixa, id: proximoId++ });
      tocar();
    },
    parar() {
      if (relogio) clearTimeout(relogio);
      relogio = null;
      fila = [];
    },
  };
}

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
  /**
   * Quem só assiste bot × bot não tem turno: a faixa "TURN CHANGE" ganha uma
   * linha dizendo de quem é a vez, pelo nome ("VEZ DE FULANO").
   */
  spectateText?: { mine: string; foe: string },
) {
  const vezDeMim = spectateText?.mine;
  const vezDoOutro = spectateText?.foe;
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
  /** A leitura do canto tem seu próprio relógio e não segura o engine. */
  const [effectNotice, setEffectNotice] = useState<ChainEffectNoticeState | null>(null);
  const effectNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cartas saindo do campo agora — várias de uma vez num Raigeki. */
  const [leaves, setLeaves] = useState<LeaveGhost[]>([]);
  /** A faixa do MD atravessando a tela ("TURN CHANGE", "BATTLE PHASE"). */
  const [banner, setBanner] = useState<DuelBanner | null>(null);
  /** O corte de invocação no ar. */
  const [cutIn, setCutIn] = useState<SummonCutInState | null>(null);
  const cutInTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** De quem é o turno — a cor das faixas de fase. */
  const ladoDoTurno = useRef<"me" | "foe">("me");
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

  /** O clique que pula o corte de invocação. */
  const dismissCutIn = useCallback(() => {
    if (cutInTimer.current) clearTimeout(cutInTimer.current);
    setCutIn(null);
  }, []);

  /** A fila das faixas — um objeto só para a vida da mesa (ver `criarFilaDeFaixas`). */
  const [faixas] = useState(() => criarFilaDeFaixas(setBanner));

  const pushFlash = useCallback(
    (
      text: string,
      tone: DuelFlash["tone"],
      duration = 1100,
      anchor: DuelFlash["anchor"] = "center",
      band?: DuelFlash["band"],
    ) => {
      const id = nextId.current++;
      setFlashes((current) => [
        ...current,
        { id, text, tone, duration, anchor, band },
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
        playSfx(event.cutIn ? "cutIn" : event.special ? "specialSummon" : "summon");
        if (event.cutIn) {
          const duration = dur(CUT_IN_MS);
          const token = nextId.current++;
          setCutIn({ token, code: event.code, kind: event.cutIn, mine: event.player === me, duration });
          if (cutInTimer.current) clearTimeout(cutInTimer.current);
          cutInTimer.current = setTimeout(() => {
            setCutIn((atual) => (atual?.token === token ? null : atual));
          }, duration);
        }
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
            description: event.kind === "chainLink" ? (event.description ?? null) : null,
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
          if (!negated) {
            setEffectNotice({
              token,
              code: event.code,
              link: event.link,
              mine: event.player === me,
              description: event.description ?? null,
              duration: EFFECT_READ_MS,
            });
            // A ativação mais recente toma o lugar da anterior e ganha seus
            // próprios quatro segundos, inclusive nas velocidades rápidas.
            if (effectNoticeTimer.current) clearTimeout(effectNoticeTimer.current);
            effectNoticeTimer.current = setTimeout(() => {
              setEffectNotice((current) => (current?.token === token ? null : current));
            }, EFFECT_READ_MS);
          }
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
          setTimeout(() => setReveal(null), dur(EFFECT_READ_MS));
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
            { token, code: event.code, from: event.from, to: event.to, why: event.why, duration },
          ]);
          setTimeout(() => {
            setLeaves((current) => current.filter((leave) => leave.token !== token));
          }, duration + 40);
          break;
        }
        case "turn": {
          const lado = event.player === me ? "me" : "foe";
          ladoDoTurno.current = lado;
          faixas.enfileirar({
            text: event.count === 1 ? "DUEL START" : "TURN CHANGE",
            side: lado,
            sub: lado === "me" ? vezDeMim : vezDoOutro,
            duration: dur(TURN_BEAT + 520),
            big: true,
          });
          break;
        }
        case "phase": {
          const texto = mdPhaseBanner(event.phase);
          if (texto) {
            faixas.enfileirar({
              text: texto,
              side: ladoDoTurno.current,
              duration: dur(texto === "BATTLE PHASE" ? 1100 : 820),
              big: texto === "BATTLE PHASE",
            });
          }
          break;
        }
        case "damage":
          pushFlash(
            `${event.amount}`,
            event.player === me ? "bad" : "good",
            dur(LIFE_POINT_MS),
            event.player === me ? "player" : "opponent",
          );
          setShake(event.player === me ? "mine" : "theirs");
          setTimeout(() => setShake(null), 420);
          break;
        case "recover":
          pushFlash(
            `+${event.amount}`,
            "good",
            dur(LIFE_POINT_MS),
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
          break;
        default:
          break;
      }
    });
  }, [subscribe, pushFlash, faixas, me, vezDeMim, vezDoOutro]);

  // Os relógios das faixas e do corte morrem com a mesa.
  useEffect(
    () => () => {
      faixas.parar();
      if (cutInTimer.current) clearTimeout(cutInTimer.current);
      if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
      if (effectNoticeTimer.current) clearTimeout(effectNoticeTimer.current);
    },
    [faixas],
  );

  return {
    flashes,
    shake,
    toss,
    flight,
    reveal,
    draw,
    spotlight,
    effectNotice,
    leaves,
    banner,
    cutIn,
    dismissSpotlight,
    dismissCutIn,
  };
}
