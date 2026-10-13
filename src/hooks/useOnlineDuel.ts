"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OcgResponse } from "@n1xx1/ocgcore-wasm";

import type { ChainResponseMode } from "@/lib/duel/chain-mode";
import type { DuelEvent, DuelEventListener } from "@/lib/duel/duel-events";
import type { DuelSnapshot } from "@/lib/duel/duel-session";
import { playerToken } from "@/lib/duel/online-storage";
import type { JokenpoJogada } from "@/lib/duel/jokenpo";
import {
  decodeMessage,
  encodeMessage,
  WS_PATH,
  type ClientMessage,
  type JokenpoState,
  type SeatInfo,
  type ServerMessage,
} from "@/lib/net/duel-protocol";
import type { DuelDeckPayload } from "@/lib/types";

export type OnlineStatus = "conectando" | "conectado" | "recusado" | "caiu";

/** Espera antes de tentar reconectar — o servidor pode estar recarregando. */
const RECONNECT_DELAY_MS = 1500;

/**
 * Quantas tentativas frustradas antes de dizer o que provavelmente está errado.
 *
 * Uma queda solta se resolve sozinha e não merece alarme; nunca chegar a abrir
 * é outra coisa — quase sempre significa que o app está no `next dev`, que
 * serve as páginas normalmente mas não tem o WebSocket. Sem esta mensagem o
 * sintoma é uma sala que fica "Conectando…" para sempre, sem nada no console.
 */
const TENTATIVAS_ATE_EXPLICAR = 2;

/**
 * Quanto esperar pelo handshake antes de desistir da tentativa.
 *
 * Existe porque o caso comum de falha não devolve erro nenhum — ver o
 * comentário no `prazo`, abaixo.
 */
const CONNECT_TIMEOUT_MS = 5000;

const SEM_CANAL =
  "Não foi possível abrir o canal do duelo (/api/duel-ws). " +
  "Se o app está rodando com `next dev`, pare e use `npm run dev` — " +
  "o duelo online precisa do servidor `server.mjs`.";

export interface OnlineDuel {
  status: OnlineStatus;
  /** Assento deste jogador; `null` até o servidor responder. */
  me: 0 | 1 | null;
  snapshot: DuelSnapshot | null;
  seats: SeatInfo[];
  started: boolean;
  /** O duelo acabou; a sala aceita revanche. */
  finished: boolean;
  /** O adversário caiu e ainda não voltou. */
  opponentAway: boolean;
  /** Ele sumiu tempo bastante: dá para encerrar o duelo a meu favor. */
  claimable: boolean;
  claimWin: () => void;
  /** Desistir do duelo em andamento — o adversário vence. */
  surrender: () => void;
  /**
   * Quando perguntar "deseja responder?" a este jogador. Vai para o servidor,
   * que é quem roda o engine — e é reenviado a cada (re)conexão.
   */
  setChainPreference: (preference: { mode?: ChainResponseMode; forceAsk?: boolean }) => void;
  error: string | null;
  ready: boolean;
  /**
   * O jokenpô que decide o primeiro turno, ou `null` fora dele.
   *
   * Vive entre "os dois prontos" e o começo do duelo (ver `DuelRoom`).
   */
  jokenpo: JokenpoState | null;
  /** Joga uma rodada do jokenpô. */
  jogarJokenpo: (jogada: JokenpoJogada) => void;
  /** Ganhou o jokenpô: escolhe começar (`true`) ou não. */
  escolherOrdem: (primeiro: boolean) => void;
  /**
   * "Estou pronto" — antes da primeira partida e entre partidas.
   *
   * É o único caminho para a próxima partida: a sala trata querer jogar de novo
   * como querer jogar a primeira (ver `DuelRoom.setReady`), e um segundo botão
   * de "revanche" era o que dessincronizava os dois lados.
   */
  setReady: (ready: boolean) => void;
  /** Troca o deck para a próxima partida (aceito só fora de duelo). */
  setDeck: (deck: DuelDeckPayload, deckName: string) => void;
  respond: (response: OcgResponse) => void;
  subscribeEvents: (listener: DuelEventListener) => () => void;
}

/**
 * Liga esta aba a uma sala e devolve o estado do duelo.
 *
 * A forma do retorno acompanha a do `useDuelEngine` de propósito: o
 * `DuelBoard` é o mesmo componente nos dois modos, e uma segunda mesa "só para
 * o online" seria a garantia de que uma delas fica para trás.
 */
export function useOnlineDuel(params: {
  code: string;
  name: string;
  deck: DuelDeckPayload | null;
  deckName: string;
}): OnlineDuel {
  const { code, name, deck, deckName } = params;

  const [status, setStatus] = useState<OnlineStatus>("conectando");
  const [me, setMe] = useState<0 | 1 | null>(null);
  const [snapshot, setSnapshot] = useState<DuelSnapshot | null>(null);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [claimable, setClaimable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReadyState] = useState(false);
  const [jokenpo, setJokenpo] = useState<JokenpoState | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  /**
   * O assento, também num ref.
   *
   * O `onmessage` é criado uma vez por conexão e enxerga o `me` daquele
   * momento — que é `null`, porque o assento chega depois. Sem o ref, a
   * sincronização do "pronto" com o servidor (abaixo) nunca encontrava o
   * próprio assento e silenciosamente não fazia nada.
   */
  const meRef = useRef<0 | 1 | null>(null);
  /** Tentativas de conexão que nunca chegaram a abrir — ver `SEM_CANAL`. */
  const tentativasRef = useRef(0);
  /** Já abriu alguma vez? Separa "caiu" (passa) de "não existe" (não passa). */
  const jaAbriuRef = useRef(false);
  /**
   * Ouvintes dos eventos transitórios (som e animação).
   *
   * Num ref, e não em state: a identidade de `subscribeEvents` precisa ser
   * estável ou o `useDuelFeedback` refaz a inscrição a cada render e perde
   * eventos no meio.
   */
  const listenersRef = useRef(new Set<DuelEventListener>());

  const subscribeEvents = useCallback((listener: DuelEventListener) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(encodeMessage(message));
  }, []);

  /**
   * Preferência de resposta corrente. Num ref porque precisa ser reenviada de
   * dentro do `onmessage` (ao entrar na sala), que não re-renderiza.
   */
  const prefsRef = useRef<{ chainMode: ChainResponseMode; forceAsk: boolean }>({
    chainMode: "auto",
    forceAsk: false,
  });

  useEffect(() => {
    if (!code || !deck) return;

    let cancelado = false;
    let reconectar: ReturnType<typeof setTimeout> | null = null;
    /** Uma recusa é definitiva; insistir seria bater numa porta que não abre. */
    let recusado = false;
    let atual: WebSocket | null = null;

    const conectar = () => {
      if (cancelado || recusado) return;

      const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocolo}//${window.location.host}${WS_PATH}`);
      atual = socket;
      socketRef.current = socket;

      let encerrado = false;

      /** Chamado uma única vez por tentativa, por qualquer caminho de falha. */
      const falhou = () => {
        if (encerrado || cancelado) return;
        encerrado = true;
        clearTimeout(prazo);
        if (socketRef.current === socket) socketRef.current = null;

        if (!jaAbriuRef.current) {
          tentativasRef.current += 1;
          if (tentativasRef.current >= TENTATIVAS_ATE_EXPLICAR) setError(SEM_CANAL);
        }

        setStatus(recusado ? "recusado" : "caiu");
        if (!recusado) reconectar = setTimeout(conectar, RECONNECT_DELAY_MS);
      };

      /**
       * Prazo para o handshake.
       *
       * Sem ele a tela fica "Conectando…" para sempre e sem um único evento:
       * o `next dev` puro (sem o `server.mjs`) aceita o upgrade de
       * `/api/duel-ws`, não completa o handshake e **não fecha** — não chega
       * `open`, `error` nem `close`. Foi exatamente esse o sintoma relatado.
       */
      const prazo = setTimeout(() => {
        socket.close();
        falhou();
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (cancelado) return;
        clearTimeout(prazo);
        jaAbriuRef.current = true;
        tentativasRef.current = 0;
        setStatus("conectado");
        setError(null);
        socket.send(
          encodeMessage({
            t: "join",
            room: code,
            token: playerToken(),
            name,
            deck,
            deckName,
          }),
        );
      };

      socket.onmessage = (raw) => {
        const message = decodeMessage<ServerMessage>(String(raw.data));
        if (!message) return;

        switch (message.t) {
          case "joined":
            meRef.current = message.me;
            setMe(message.me);
            // A sala guarda a preferência no jogador; numa reconexão ela já
            // está lá, mas reenviar é barato e cobre a sala que reiniciou.
            socket.send(encodeMessage({ t: "prefs", ...prefsRef.current }));
            break;
          case "lobby": {
            setSeats(message.seats);
            setStarted(message.started);
            setFinished(message.finished);
            setClaimable(message.claimable);
            setJokenpo(message.jokenpo);
            // O servidor é dono do "pronto": depois de reconectar, o estado
            // local pode estar desatualizado, e mostrar um botão que discorda
            // do servidor é pior do que não mostrar nada.
            const meu = message.seats.find((seat) => seat.seat === meRef.current);
            if (meu) setReadyState(meu.ready);
            break;
          }
          case "snapshot":
            setSnapshot(message.snapshot);
            break;
          case "event":
            for (const listener of listenersRef.current) {
              listener(message.event as DuelEvent);
            }
            break;
          case "error":
            setError(message.message);
            if (message.fatal) recusado = true;
            break;
        }
      };

      socket.onclose = () => falhou();
      socket.onerror = () => socket.close();
    };

    conectar();

    return () => {
      cancelado = true;
      if (reconectar) clearTimeout(reconectar);
      socketRef.current = null;
      atual?.close();
    };
    // `deckName` de propósito fora das dependências: ele acompanha o `deck`, e
    // incluí-lo faria a troca de deck derrubar e reabrir o socket em vez de
    // mandar a mensagem `deck` pela conexão que já está de pé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, name, deck]);

  const setReady = useCallback(
    (valor: boolean) => {
      setReadyState(valor);
      send({ t: "ready", ready: valor });
    },
    [send],
  );

  const setDeck = useCallback(
    (novo: DuelDeckPayload, nome: string) => {
      send({ t: "deck", deck: novo, deckName: nome });
    },
    [send],
  );

  const jogarJokenpo = useCallback(
    (jogada: JokenpoJogada) => {
      send({ t: "jokenpo", jogada });
    },
    [send],
  );

  const escolherOrdem = useCallback(
    (primeiro: boolean) => {
      send({ t: "firstGo", first: primeiro });
    },
    [send],
  );

  const claimWin = useCallback(() => {
    send({ t: "claimWin" });
  }, [send]);

  const surrender = useCallback(() => {
    send({ t: "surrender" });
  }, [send]);

  const setChainPreference = useCallback(
    (preference: { mode?: ChainResponseMode; forceAsk?: boolean }) => {
      const atual = prefsRef.current;
      const proximo = {
        chainMode: preference.mode ?? atual.chainMode,
        forceAsk: preference.forceAsk ?? atual.forceAsk,
      };
      if (proximo.chainMode === atual.chainMode && proximo.forceAsk === atual.forceAsk) return;
      prefsRef.current = proximo;
      send({ t: "prefs", ...proximo });
    },
    [send],
  );

  const respond = useCallback(
    (response: OcgResponse) => {
      const promptId = snapshot?.promptId ?? 0;
      send({ t: "respond", promptId, response });
    },
    [send, snapshot?.promptId],
  );

  // O adversário é o assento que não é o meu; antes do sorteio não há
  // adversário identificável, e aí nada disto se aplica.
  const opponentAway =
    me !== null &&
    started &&
    seats.some((seat) => seat.seat !== me && !seat.connected);

  return useMemo(
    () => ({
      status,
      me,
      snapshot,
      seats,
      started,
      finished,
      opponentAway,
      claimable,
      claimWin,
      surrender,
      setChainPreference,
      error,
      ready,
      setReady,
      jokenpo,
      jogarJokenpo,
      escolherOrdem,
      setDeck,
      respond,
      subscribeEvents,
    }),
    [
      status,
      me,
      snapshot,
      seats,
      started,
      finished,
      opponentAway,
      claimable,
      claimWin,
      surrender,
      setChainPreference,
      error,
      ready,
      setReady,
      jokenpo,
      jogarJokenpo,
      escolherOrdem,
      setDeck,
      respond,
      subscribeEvents,
    ],
  );
}
