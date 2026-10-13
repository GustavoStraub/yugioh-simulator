/**
 * Acha uma porta livre a partir da pedida.
 *
 * Existe porque "a 3000 está ocupada" é o caso comum, não a exceção: o
 * `npm run dev` já aberto noutro terminal, outro projeto Next, um teste que
 * ficou de pé. Sem isto o servidor morre com EADDRINUSE e o `npm run public`
 * tinha um jeito pior de falhar (ver `scripts/publicar.mjs`).
 *
 * "Ocupada" é testado de dois jeitos, e os dois são necessários:
 *
 * - **escutar** no mesmo host do servidor e ver se dá EADDRINUSE — o caso
 *   óbvio;
 * - **conectar** em 127.0.0.1 e ::1. No macOS (BSD) o Node liga
 *   SO_REUSEADDR, e com ele um `listen` em 0.0.0.0 CONSEGUE se o outro
 *   processo só escuta em 127.0.0.1 (o `next dev` puro faz isso). As duas
 *   escutas convivem e `localhost:3000` continua caindo no outro processo —
 *   o nosso servidor "subiria" numa porta em que ninguém o alcança pelo
 *   endereço que ele mesmo anuncia.
 *
 * Entre a sondagem e o `listen` de verdade há uma janela em que outro
 * processo pode pegar a porta; aí o `listen` falha com EADDRINUSE e a
 * mensagem de erro do `server.mjs` explica. Não vale complicar por isso.
 */
import { connect, createServer } from "node:net";

function consegueEscutar(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sonda = createServer();
    sonda.once("error", () => resolve(false));
    sonda.once("listening", () => sonda.close(() => resolve(true)));
    sonda.listen(port, host);
  });
}

function alguemAtende(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const fim = (atendeu: boolean) => {
      socket.destroy();
      resolve(atendeu);
    };
    socket.setTimeout(500, () => fim(false));
    socket.once("connect", () => fim(true));
    // ECONNREFUSED (ninguém ali) e EADDRNOTAVAIL (sem IPv6) dão no mesmo.
    socket.once("error", () => fim(false));
  });
}

export async function portaLivre(port: number, host: string): Promise<boolean> {
  const [v4, v6] = await Promise.all([
    alguemAtende(port, "127.0.0.1"),
    alguemAtende(port, "::1"),
  ]);
  if (v4 || v6) return false;
  return consegueEscutar(port, host);
}

/**
 * A primeira porta livre em `inicio`, `inicio + 1`, … — ou `null` depois de
 * `tentativas` portas ocupadas seguidas (algo está errado demais para seguir
 * procurando em silêncio).
 */
export async function acharPorta(
  inicio: number,
  host: string,
  tentativas = 20,
): Promise<number | null> {
  for (let port = inicio; port < inicio + tentativas && port <= 65535; port++) {
    if (await portaLivre(port, host)) return port;
  }
  return null;
}
