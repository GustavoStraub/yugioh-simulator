/**
 * Servidor da aplicação.
 *
 * O Next sozinho já serviria as páginas; ele existe por causa do duelo online.
 * Um route handler do App Router não aceita upgrade de WebSocket (a conexão é
 * encerrada quando a resposta termina), e o duelo precisa de um canal
 * bidirecional para saber, entre outras coisas, quando o adversário fechou a
 * aba — sem isso o outro jogador fica olhando um tabuleiro parado sem saber
 * por quê.
 *
 * Há um segundo motivo, que só aparece em desenvolvimento: o estado das salas
 * mora neste processo, FORA do grafo de módulos do Next. Dentro de um route
 * handler o `next dev` reavaliaria o módulo a cada arquivo salvo e todas as
 * partidas em andamento sumiriam.
 *
 * Roda com o resolvedor de `@/...` (`tools/harness/ts-loader.mjs`); o Node 26
 * apaga os tipos sozinho. É o que deixa o servidor usar a MESMA `DuelSession`
 * que o navegador, em vez de uma segunda implementação do laço de mensagens.
 */
import { createServer } from "node:http";
import { join } from "node:path";

import next from "next";

import { WS_PATH } from "@/lib/net/duel-protocol";
import { createDuelSocket } from "@/server/duel/socket";
import { acharPorta } from "@/server/free-port";
import { lanUrls } from "@/server/net-info";

const dev = process.env.NODE_ENV !== "production";
// 0.0.0.0 é o ponto do exercício: em `localhost` ninguém da rede alcança.
const hostname = process.env.HOST ?? "0.0.0.0";

// Sem PORT, a 3000 é só a preferência: se estiver ocupada (outro `npm run dev`,
// outro projeto), sobe na próxima livre e diz qual. Com PORT explícito, a porta
// é exigência — quem fixou 3100 para um teste com APP_URL apontando para ela
// quer um erro, não um servidor em 3101 que o teste nunca vai achar.
const portaFixa = process.env.PORT !== undefined;
const pedida = Number.parseInt(process.env.PORT ?? "3000", 10);
const port = portaFixa ? pedida : await acharPorta(pedida, hostname);
if (port === null) {
  console.error(`  nenhuma porta livre entre ${pedida} e ${pedida + 19}.`);
  process.exit(1);
}
if (port !== pedida) {
  console.log(`  a porta ${pedida} está ocupada — usando ${port}.`);
}

// A rota `/api/duel/net-info` lê a porta daqui para montar o link de convite.
// Escrita ANTES do `next(...)`: é a porta escolhida, não a pedida.
process.env.PORT = String(port);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

// Depois do `prepare`, e não antes: o `getUpgradeHandler` só existe com o
// servidor interno já montado, e pedi-lo cedo estoura com
// "prepare() must be called before performing this operation".
const handleNextUpgrade = app.getUpgradeHandler();

const server = createServer((request, response) => {
  handle(request, response);
});

const duelSocket = createDuelSocket(server);

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (pathname === WS_PATH) {
    duelSocket.handleUpgrade(request, socket, head);
    return;
  }
  // Todo o resto continua sendo do Next — inclusive o socket de HMR do
  // `next dev`, que quebraria silenciosamente se fosse engolido aqui.
  handleNextUpgrade(request, socket, head);
});

// A janela entre a sondagem e este `listen` é pequena, mas existe — e com PORT
// fixo não houve sondagem. Sem este handler o erro sai como stack trace cru.
server.on("error", (erro) => {
  if (erro.code === "EADDRINUSE") {
    console.error(`  a porta ${port} está ocupada.`);
    process.exit(1);
  }
  throw erro;
});

server.listen(port, hostname, () => {
  const rede = lanUrls(port);
  console.log(`  ▲ Yu-Gi-Oh! Goat — ${dev ? "desenvolvimento" : "produção"}`);
  console.log(`    http://localhost:${port}`);
  for (const url of rede) console.log(`    ${url}`);
  // O mesmo endereço que a tela oferece como convite (o primeiro da lista, que
  // é o da placa física) — dois valores diferentes só confundiriam.
  console.log(`    convite: ${rede[0] ?? `http://localhost:${port}`}/duel/online`);
  // Onde os decks moram. Impresso porque a pergunta "onde ficam salvos?" é
  // inevitável e a resposta depende de onde o processo foi iniciado (ou de
  // DECKS_DIR) — deixar isso implícito é deixar o jogador procurar.
  console.log(`    decks: ${process.env.DECKS_DIR ?? join(process.cwd(), ".data", "decks")}`);
});
