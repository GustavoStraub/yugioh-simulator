import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

import {
  decodeMessage,
  encodeMessage,
  isRoomCode,
  normalizeRoomCode,
  type ClientMessage,
  type ServerMessage,
} from "@/lib/net/duel-protocol";
import type { DuelRoom } from "@/server/duel/room";
import { joinRoom, sweepRooms } from "@/server/duel/rooms";

/** Intervalo da faxina de salas vazias. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Intervalo do batimento (ping) em cada conexão.
 *
 * Resolve dois problemas de uma vez, e os dois só aparecem em uso real:
 *
 * 1. **O socket fica mudo enquanto o jogador pensa.** O servidor só fala
 *    quando o estado muda, então entre uma jogada e outra a conexão passa
 *    minutos em silêncio — e proxy nenhum tolera isso: a Cloudflare encerra
 *    WebSocket ocioso. O ping é tráfego, e mantém a conexão viva.
 * 2. **Conexão que morre sem avisar.** Notebook que dorme, Wi-Fi que some sem
 *    fechar o TCP: o socket fica meio-aberto, o servidor continua achando que
 *    a pessoa está lá, e quem ficou nunca vê o aviso de queda nem consegue
 *    encerrar. Sem pong, a conexão é derrubada e a sala trata como saída.
 *
 * Os quadros de ping são do protocolo: o navegador responde sozinho, sem uma
 * linha de código no cliente.
 */
const HEARTBEAT_MS = Number(process.env.DUEL_HEARTBEAT_MS ?? 30_000);

/** Tamanho máximo de uma mensagem do cliente — um deck cabe folgado em 64 KB. */
const MAX_PAYLOAD = 256 * 1024;

interface Connection {
  room: DuelRoom;
  token: string;
}

/**
 * Instala o servidor de WebSocket do duelo.
 *
 * O `noServer: true` é o que permite conviver com o Next: quem decide a qual
 * servidor cada upgrade pertence é o `server.mjs`, olhando o caminho. Deixar o
 * `ws` escutar o servidor HTTP inteiro roubaria o socket de HMR do `next dev`.
 */
export function createDuelSocket(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const conexoes = new Map<WebSocket, Connection>();
  /** Respondeu ao último ping? Quem não responder na próxima rodada cai. */
  const respondeu = new WeakMap<WebSocket, boolean>();

  const faxina = setInterval(() => sweepRooms(), SWEEP_INTERVAL_MS);
  faxina.unref?.();

  const batimento = setInterval(() => {
    for (const socket of wss.clients) {
      if (respondeu.get(socket) === false) {
        // `terminate` e não `close`: o outro lado não está respondendo, então
        // esperar o aperto de mão educado seria esperar para sempre.
        socket.terminate();
        continue;
      }
      respondeu.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  batimento.unref?.();

  httpServer.on("close", () => {
    clearInterval(faxina);
    clearInterval(batimento);
  });

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(encodeMessage(message));
  }

  function recusar(socket: WebSocket, message: string): void {
    send(socket, { t: "error", message, fatal: true });
    socket.close();
  }

  wss.on("connection", (socket: WebSocket) => {
    respondeu.set(socket, true);
    socket.on("pong", () => respondeu.set(socket, true));

    socket.on("message", (raw) => {
      const parsed = decodeMessage<ClientMessage>(String(raw));
      if (!parsed) return;

      const atual = conexoes.get(socket);

      if (parsed.t === "join") {
        // Reentrar num socket que já entrou seria trocar de sala por baixo do
        // estado da sala anterior — recusar é mais simples do que desfazer.
        if (atual) return;

        const code = normalizeRoomCode(parsed.room);
        if (!isRoomCode(code)) {
          recusar(socket, "Código de sala inválido.");
          return;
        }
        if (typeof parsed.token !== "string" || parsed.token.length < 8) {
          recusar(socket, "Identificação de jogador inválida.");
          return;
        }

        const room = joinRoom(code);
        const nome = String(parsed.name ?? "").trim().slice(0, 24) || "Duelista";
        const resultado = room.join({
          token: parsed.token,
          name: nome,
          deck: parsed.deck,
          deckName: parsed.deckName,
          send: (message) => send(socket, message),
        });

        if (!resultado.ok) {
          recusar(socket, resultado.error);
          return;
        }

        conexoes.set(socket, { room, token: parsed.token });
        return;
      }

      if (!atual) return;

      switch (parsed.t) {
        case "ready":
          atual.room.setReady(atual.token, parsed.ready === true);
          break;
        case "jokenpo":
          atual.room.jogarJokenpo(atual.token, parsed.jogada);
          break;
        case "firstGo":
          atual.room.escolherOrdem(atual.token, parsed.first === true);
          break;
        case "respond":
          atual.room.respond(atual.token, parsed.promptId, parsed.response);
          break;
        case "rematch":
          atual.room.rematch(atual.token);
          break;
        case "claimWin":
          atual.room.claimWin(atual.token);
          break;
        case "prefs":
          atual.room.setPrefs(atual.token, parsed.chainMode, parsed.forceAsk === true);
          break;
        case "surrender":
          atual.room.surrender(atual.token);
          break;
        case "deck":
          atual.room.setDeck(
            atual.token,
            parsed.deck,
            String(parsed.deckName ?? "Deck"),
          );
          break;
      }
    });

    socket.on("close", () => {
      const atual = conexoes.get(socket);
      conexoes.delete(socket);
      atual?.room.disconnect(atual.token);
    });

    // Um erro de socket já vem seguido de `close`; engolir aqui evita derrubar
    // o processo inteiro por uma conexão que caiu feio.
    socket.on("error", () => {});
  });

  return {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    },
  };
}
