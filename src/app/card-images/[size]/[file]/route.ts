import {
  cardImage,
  fallbackCardSvg,
  isCardImageSize,
  passcodeFromFile,
} from "@/server/catalog/card-images";
import { loadCatalogRegistry } from "@/server/catalog/catalog-store";

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
    if (!bytes) {
      // Sem arte na YGOPRODeck (fichas modernas, carta recém-anunciada): a
      // face desenhada no lugar da imagem quebrada. Cache curto, não
      // imutável — quando a arte existir, ela substitui esta.
      const registry = await loadCatalogRegistry().catch(() => null);
      const card = registry?.get(passcode) ?? null;
      return new Response(fallbackCardSvg(card, passcode), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
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
