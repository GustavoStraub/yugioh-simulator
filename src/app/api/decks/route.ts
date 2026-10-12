import { NextResponse } from "next/server";

import { deckLimits } from "@/lib/domain/deck-rules";
import { formatOf } from "@/lib/types";
import type { DeckList } from "@/lib/types";
import {
  deleteDeck,
  isProfileId,
  putDeck,
  resolveDecks,
} from "@/server/decks/store";

/**
 * Biblioteca de decks do jogador, guardada em disco pelo servidor.
 *
 * Existe para o deck não morrer junto com os dados do navegador — e para o
 * mesmo deck aparecer em qualquer aparelho da rede que fale com este servidor.
 */

/** O corpo vem do navegador: nada aqui pode ser aceito por confiança. */
function deckInvalido(deck: unknown): string | null {
  if (!deck || typeof deck !== "object") return "Deck ausente.";
  const candidato = deck as Partial<DeckList>;

  if (typeof candidato.id !== "string" || candidato.id.length < 4) {
    return "Deck sem identificador.";
  }
  if (typeof candidato.name !== "string") return "Deck sem nome.";
  if (candidato.format !== undefined && candidato.format !== "goat" && candidato.format !== "tcg") {
    return "Formato desconhecido.";
  }
  // Limite do formato do próprio deck: um deck TCG não guarda 60 no Extra.
  const limites = deckLimits(formatOf(candidato.format));

  for (const zona of ["main", "extra", "side"] as const) {
    const cartas = candidato[zona];
    if (!Array.isArray(cartas)) return `Zona ${zona} ausente.`;
    if (cartas.length > limites[zona].max) return `Zona ${zona} passou do limite.`;
    for (const ref of cartas) {
      if (
        !ref ||
        !Number.isSafeInteger(ref.passcode) ||
        ref.passcode <= 0 ||
        !Number.isSafeInteger(ref.quantity) ||
        ref.quantity <= 0
      ) {
        return `Zona ${zona} tem carta inválida.`;
      }
    }
  }
  return null;
}

function perfilDaBusca(request: Request): string | null {
  const profile = new URL(request.url).searchParams.get("profile") ?? "";
  return isProfileId(profile) ? profile : null;
}

export async function GET(request: Request) {
  const profile = perfilDaBusca(request);
  if (!profile) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }

  // `name` e `from` fazem a biblioteca ACOMPANHAR o dono: sem eles, abrir o
  // jogo noutra porta ou noutro navegador — outra origem, outro localStorage —
  // dava uma coleção vazia com os decks vivos num arquivo de id aleatório.
  const busca = new URL(request.url).searchParams;
  const name = (busca.get("name") ?? "").trim().slice(0, 40);
  const from = busca.get("from") ?? undefined;

  return NextResponse.json({ decks: await resolveDecks(profile, name, from) });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    profile?: string;
    profileName?: string;
    deck?: DeckList;
  } | null;

  if (!body?.profile || !isProfileId(body.profile)) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }

  const problema = deckInvalido(body.deck);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const decks = await putDeck(
    body.profile,
    String(body.profileName ?? "").slice(0, 40),
    body.deck as DeckList,
  );
  return NextResponse.json({ decks });
}

export async function DELETE(request: Request) {
  const profile = perfilDaBusca(request);
  const deck = new URL(request.url).searchParams.get("deck") ?? "";
  if (!profile) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }
  if (!deck) {
    return NextResponse.json({ error: "Deck não informado." }, { status: 400 });
  }
  return NextResponse.json({ decks: await deleteDeck(profile, deck) });
}
