import { existsSync, readFileSync } from "node:fs";

import {
  hologramList,
  hologramPasscode,
  hologramPath,
  readHologramIndex,
} from "@/server/catalog/holograms";

/**
 * `/card-images/holo/index.json` — quais monstros têm holograma — e
 * `/card-images/holo/<passcode>.webp` — as fatias de um deles (ver
 * `holograms.ts`).
 *
 * Só serve o que `npm run build:holograms` gerou; não gera nada aqui (são
 * dois modelos de IA de ~270 MB, coisa para rodar fora do servidor). Um
 * segmento fixo (`holo`) vence o dinâmico `[size]` vizinho, então as imagens
 * normais das cartas continuam na outra rota.
 *
 * A lista revalida a cada partida (ETag): gerar mais hologramas tem de
 * aparecer na próxima. A imagem fica em cache — a URL leva o `generatedAt`
 * do índice, e uma geração nova é uma URL nova.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;

  if (file === "index.json") {
    const lista = hologramList(readHologramIndex());
    // Revalida a cada partida, mas só baixa de novo quando a geração mudou
    // (durante um `--all` o índice cresce a cada 50 cartas).
    const etag = `"${lista.generatedAt}-${lista.cutout.length}-${lista.projection.length}"`;
    const headers = { "Cache-Control": "no-cache", ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(lista, { headers });
  }

  const passcode = hologramPasscode(file);
  if (passcode === null) return new Response("Holograma inválido.", { status: 400 });
  const path = hologramPath(passcode);
  if (!existsSync(path)) return new Response("Sem holograma.", { status: 404 });
  return new Response(new Uint8Array(readFileSync(path)), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
