import { cardImage, isCardImageSize, passcodeFromFile } from "@/server/catalog/card-images";

/**
 * `/card-images/<small|full|cropped>/<passcode>.jpg` — a imagem da carta,
 * servida do nosso disco (ver `card-images.ts`: cada imagem vem da YGOPRODeck
 * uma vez só).
 *
 * Imutável: um passcode é sempre a mesma arte, então o navegador guarda a
 * imagem por um ano e nem pergunta de novo.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string; file: string }> },
) {
  const { size, file } = await context.params;
  const passcode = passcodeFromFile(file);
  if (!isCardImageSize(size) || passcode === null) {
    return new Response("Imagem inválida.", { status: 400 });
  }

  try {
    const bytes = await cardImage(size, passcode);
    if (!bytes) return new Response("Imagem não encontrada.", { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // A origem falhou (rede, limite): sem cache, para a próxima tentar de novo.
    return new Response("Imagem indisponível agora.", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
