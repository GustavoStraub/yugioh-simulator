import type { OcgResponse } from "@n1xx1/ocgcore-wasm";

import type { ChainResponseMode } from "@/lib/duel/chain-mode";
import type { DuelEvent } from "@/lib/duel/duel-events";
import type { DuelSnapshot } from "@/lib/duel/duel-session";
import type { JokenpoJogada } from "@/lib/duel/jokenpo";
import type { DuelDeckPayload, DuelFormat } from "@/lib/types";

/** Caminho do WebSocket, servido fora do Next (ver `server.mjs`). */
export const WS_PATH = "/api/duel-ws";

/** Alfabeto do código de sala — sem 0/O/1/I, que se confundem ao ditar. */
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw);
  return (
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((character) => ROOM_ALPHABET.includes(character))
  );
}

/**
 * O jokenpô que decide o primeiro turno, na ótica de UM jogador.
 *
 * Recortado por destinatário como o resto do lobby, e por um motivo que é o
 * coração da disputa: a jogada do adversário **não** pode aparecer antes de os
 * dois terem jogado. Se aparecesse, bastava esperar para ganhar sempre — daí
 * `opponentChose` dizer só que ele já jogou, e `last` só existir depois de a
 * rodada ter sido resolvida.
 */
export interface JokenpoState {
  /** Rodada atual; sobe a cada empate. */
  round: number;
  /** O que EU joguei nesta rodada, ou `null` se ainda não joguei. */
  mine: JokenpoJogada | null;
  /** O adversário já jogou (sem dizer o quê). */
  opponentChose: boolean;
  /** A rodada que acabou de ser resolvida — é o que a tela narra. */
  last: {
    mine: JokenpoJogada;
    theirs: JokenpoJogada;
    outcome: "empate" | "ganhei" | "perdi";
  } | null;
  /** Eu ganhei: escolho começar ou não. */
  chooseFirst: boolean;
  /** O outro ganhou e está escolhendo a ordem. */
  waitingChoice: boolean;
}

/** Como cada assento aparece no lobby da sala. */
export interface SeatInfo {
  seat: 0 | 1;
  name: string;
  connected: boolean;
  ready: boolean;
  /** O deck já chegou e passou na validação. */
  hasDeck: boolean;
  /**
   * Nome do deck escolhido, **só para o próprio dono** (`null` no assento do
   * adversário).
   *
   * Saber com o que o outro vai jogar antes de começar é vantagem de verdade —
   * dá para escolher o deck que ganha do dele. O servidor recorta este campo
   * por destinatário; a tela nunca chega a receber o do oponente.
   */
  deckName: string | null;
  /**
   * Formato do deck escolhido (Goat ou TCG), público: os dois decks precisam
   * ser do mesmo formato para o duelo começar, e é isto que deixa a tela dizer
   * por que ele não começa.
   */
  format: DuelFormat | null;
}

export type ClientMessage =
  | {
      t: "join";
      room: string;
      /** Identidade por ABA (sessionStorage) — é o que permite reconectar. */
      token: string;
      name: string;
      deck: DuelDeckPayload;
      deckName: string;
    }
  | { t: "ready"; ready: boolean }
  /** Jogada do jokenpô que decide quem começa. */
  | { t: "jokenpo"; jogada: JokenpoJogada }
  /** Quem ganhou o jokenpô escolhe começar (`true`) ou não. */
  | { t: "firstGo"; first: boolean }
  /** Troca de deck; aceito antes da primeira partida e entre partidas. */
  | { t: "deck"; deck: DuelDeckPayload; deckName: string }
  /** "Jogar de novo" na mesma sala — vale só com o duelo terminado. */
  | { t: "rematch" }
  /** Desistir: o adversário vence na hora. */
  | { t: "surrender" }
  /**
   * Encerra o duelo a favor de quem pede, porque o adversário sumiu.
   *
   * Só é aceito depois de um tempo de tolerância: uma oscilação de Wi-Fi não
   * pode custar a partida, mas quem ficou também não pode ficar preso a um
   * tabuleiro que nunca mais anda.
   */
  | { t: "claimWin" }
  /**
   * Quando perguntar "deseja responder?" a este jogador (ver `chain-mode.ts`).
   *
   * Atravessa a rede porque é o servidor quem roda o engine e decide pular a
   * janela; `forceAsk` é o Ctrl segurado. Mandado ao entrar e a cada troca.
   */
  | { t: "prefs"; chainMode: ChainResponseMode; forceAsk: boolean }
  | { t: "respond"; promptId: number; response: OcgResponse };

export type ServerMessage =
  | { t: "joined"; me: 0 | 1; room: string }
  | {
      t: "lobby";
      seats: SeatInfo[];
      started: boolean;
      /** O duelo desta sala acabou e ela aceita revanche. */
      finished: boolean;
      /**
       * O adversário DESTE destinatário está fora há tempo demais, e ele já
       * pode encerrar o duelo a seu favor.
       */
      claimable: boolean;
      /**
       * Jokenpô em andamento, ou `null` fora dele.
       *
       * Vem no lobby, e não numa mensagem própria, porque é um ESTADO da sala
       * como `started` e `finished`: quem reconecta no meio dele precisa
       * receber a fase junto com o resto, e não depender de um evento perdido.
       */
      jokenpo: JokenpoState | null;
    }
  | { t: "snapshot"; snapshot: DuelSnapshot }
  | { t: "event"; event: DuelEvent }
  | { t: "error"; message: string; fatal: boolean };

/**
 * Envelope de um BigInt no JSON.
 *
 * As mensagens do ocgcore carregam BigInt em vários campos — `HINT.hint`,
 * `SELECT_OPTION.options`, `SELECT_CHAIN.description`, os opcodes de
 * `ANNOUNCE_CARD` — e `ANNOUNCE_RACE.races` faz o mesmo na RESPOSTA, então o
 * envelope vale nas duas direções. Sem ele, `JSON.stringify` de um prompt
 * qualquer estoura com "Do not know how to serialize a BigInt" e o duelo morre
 * na primeira pergunta.
 */
interface BigIntEnvelope {
  $b: string;
}

function isEnvelope(value: unknown): value is BigIntEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BigIntEnvelope).$b === "string"
  );
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message, (_key, value) =>
    typeof value === "bigint" ? { $b: value.toString() } : value,
  );
}

export function decodeMessage<T extends ClientMessage | ServerMessage>(
  raw: string,
): T | null {
  try {
    return JSON.parse(raw, (_key, value) =>
      isEnvelope(value) ? BigInt(value.$b) : value,
    ) as T;
  } catch {
    return null;
  }
}
