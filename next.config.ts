import { networkInterfaces } from "node:os";

import type { NextConfig } from "next";

/**
 * Origens liberadas para os recursos de desenvolvimento do Next (`/_next/*`,
 * inclusive o socket de HMR).
 *
 * Em dev o Next só aceita esses recursos vindos da origem com que subiu, e o
 * `server.mjs` sobe em `0.0.0.0` de propósito — é o que faz o amigo alcançar o
 * duelo online. O efeito colateral é que **tudo** vira origem cruzada: o
 * `192.168.x.y` do convidado e também o `localhost` de quem hospeda. Sem esta
 * lista, o convidado não carrega a página e o anfitrião perde o HMR.
 *
 * Calcular em vez de fixar evita ter que reeditar isto toda vez que o IP da
 * máquina muda; os endereços de loopback entram sempre.
 *
 * Os domínios de túnel entram porque publicar o jogo pela internet (ver
 * `npm run public`) faz TODA requisição virar origem cruzada. Em produção esta
 * lista nem é consultada — ela existe para quem preferir manter o `next dev`
 * rodando atrás do túnel em vez de buildar a cada ajuste. `DEV_ORIGINS`
 * (separado por vírgula) cobre qualquer outro domínio, como um túnel nomeado
 * com domínio próprio.
 */
const TUNEIS = ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.io"];

function origensDeDesenvolvimento(): string[] {
  const rede = Object.values(networkInterfaces())
    .flat()
    .filter((nic) => nic && nic.family === "IPv4" && !nic.internal)
    .map((nic) => nic!.address);

  const extras = (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((origem) => origem.trim())
    .filter(Boolean);

  return ["localhost", "127.0.0.1", "[::1]", ...rede, ...TUNEIS, ...extras];
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@n1xx1/ocgcore-wasm"],
  allowedDevOrigins: origensDeDesenvolvimento(),
};

export default nextConfig;
