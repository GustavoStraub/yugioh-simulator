/**
 * Saúde da conexão: batimento e conexão meio-aberta.
 *
 * Dois problemas que só aparecem em uso real, e nenhum dos dois dá erro:
 *
 * 1. **O socket fica mudo enquanto o jogador pensa.** O servidor só fala
 *    quando o estado muda, então a conexão passa minutos em silêncio. Proxy
 *    nenhum tolera isso — a Cloudflare encerra WebSocket ocioso —, e jogar
 *    pela internet significa jogar atrás de um proxy.
 * 2. **A conexão que morre sem fechar.** Notebook que dorme, Wi-Fi que some
 *    sem mandar FIN: o socket fica meio-aberto e o servidor segue achando que
 *    a pessoa está lá. Quem ficou nunca vê o aviso de queda nem consegue
 *    encerrar o duelo — fica preso a um tabuleiro que não anda.
 *
 * Uso (o servidor precisa estar de pé, com batimento curto):
 *   DUEL_HEARTBEAT_MS=1000 PORT=3210 npm run start
 *   PORT=3210 npm run test:connection
 */
import { connect } from "node:net";
import { randomBytes } from "node:crypto";

import { WebSocket } from "ws";

import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import { presetToDuelPayload } from "@/lib/domain/preset-decks";
import { decodeMessage, encodeMessage, WS_PATH } from "@/lib/net/duel-protocol";

const PORTA = Number(process.env.PORT ?? 3000);
const BASE = `ws://127.0.0.1:${PORTA}${WS_PATH}`;

const falhas = [];
function conferir(condicao, descricao) {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}`);
  if (!condicao) falhas.push(descricao);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, ms) {
  const fim = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > fim) return false;
    await espera(50);
  }
}

/**
 * Quadro de texto do cliente para o servidor.
 *
 * Escrito à mão porque o teste precisa de um socket que faça o handshake e
 * depois **não responda a nada** — uma biblioteca de WebSocket responde ao
 * ping sozinha, que é justamente o que se quer evitar aqui.
 */
function quadroDeTexto(texto) {
  const dados = Buffer.from(texto, "utf8");
  const mascara = randomBytes(4);

  let cabecalho;
  if (dados.length < 126) {
    cabecalho = Buffer.from([0x81, 0x80 | dados.length]);
  } else {
    const tamanho = Buffer.alloc(2);
    tamanho.writeUInt16BE(dados.length);
    cabecalho = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), tamanho]);
  }

  const corpo = Buffer.from(dados);
  for (let i = 0; i < corpo.length; i += 1) corpo[i] ^= mascara[i % 4];
  return Buffer.concat([cabecalho, mascara, corpo]);
}

const entrada = (nome, preset, sala) =>
  encodeMessage({
    t: "join",
    room: sala,
    token: `tok-${nome}-abcdefgh`,
    name: nome,
    deck: presetToDuelPayload(preset),
    deckName: preset.namePt,
  });

// ---------------------------------------------------------------------------
console.log("Batimento numa conexão parada...");
{
  const socket = new WebSocket(BASE);
  let pings = 0;
  socket.on("ping", () => (pings += 1));

  const abriu = await new Promise((resolve) => {
    socket.on("open", () => resolve(true));
    socket.on("error", () => resolve(false));
  });
  conferir(abriu, "o servidor aceita a conexão");

  // De propósito sem mandar nada: é o jogador olhando o tabuleiro e pensando.
  await espera(3500);
  conferir(pings > 0, `o servidor manda ping mesmo sem tráfego (${pings} em 3,5 s)`);
  socket.close();
}

// ---------------------------------------------------------------------------
console.log("\nConexão que morre sem fechar, no meio do duelo...");
{
  const sala = "HBTC";
  const fica = { ws: new WebSocket(BASE), lobby: null };
  fica.ws.on("open", () => fica.ws.send(entrada("Fica", PRESET_DECKS[0], sala)));
  fica.ws.on("message", (raw) => {
    const message = decodeMessage(String(raw));
    if (message?.t === "lobby") fica.lobby = message;
  });

  // O que trava: socket cru, que entra e depois emudece.
  const cru = connect(PORTA, "127.0.0.1");
  await new Promise((resolve) => cru.on("connect", resolve));
  cru.write(
    `GET ${WS_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${PORTA}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise((resolve) => {
    const olhar = (bloco) => {
      if (String(bloco).includes("101")) {
        cru.off("data", olhar);
        resolve();
      }
    };
    cru.on("data", olhar);
  });
  cru.write(quadroDeTexto(entrada("Trava", PRESET_DECKS[1], sala)));

  conferir(await until(() => fica.lobby?.seats.length === 2, 10_000), "os dois entram na sala");

  // Precisa ser no MEIO do duelo: antes de começar, sair libera o assento em
  // vez de guardá-lo, e não haveria "caído" para detectar.
  fica.ws.send(encodeMessage({ t: "ready", ready: true }));
  cru.write(quadroDeTexto(encodeMessage({ t: "ready", ready: true })));
  conferir(await until(() => fica.lobby?.started === true, 120_000), "o duelo começa");

  const percebeu = await until(
    () => fica.lobby?.seats.some((seat) => seat.name === "Trava" && !seat.connected),
    25_000,
  );
  conferir(percebeu, "o servidor derruba a conexão morta e avisa quem ficou");

  fica.ws.close();
  cru.destroy();
}

console.log("");
if (falhas.length > 0) {
  console.log(`${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("Tudo certo.");
process.exit(0);
