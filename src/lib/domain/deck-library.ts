import { createEmptyDeck } from "@/lib/domain/deck-operations";
import type { Profile } from "@/lib/domain/profile";
import type { DeckList } from "@/lib/types";

/** Qual deck da biblioteca está aberto — lembrado entre visitas. */
export const SELECTED_DECK_KEY = "yugioh-goat-selected-deck-v1";

/** Conversa com `/api/decks`. Erros sobem: quem chama decide o que mostrar. */
async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Falha (${response.status}).`);
  return payload;
}

export async function fetchDecks(profile: Profile): Promise<DeckList[]> {
  // O nome vai junto de propósito: é por ele que o servidor reconhece a
  // biblioteca de quem abriu o jogo noutra porta ou noutro navegador, e o
  // `previousId` é o que move a coleção de quem trocou de apelido.
  const busca = new URLSearchParams({ profile: profile.id, name: profile.name });
  if (profile.previousId) busca.set("from", profile.previousId);

  const { decks } = await pedir<{ decks: DeckList[] }>(`/api/decks?${busca}`);
  return decks;
}

export async function persistDeck(
  profile: Profile,
  deck: DeckList,
): Promise<DeckList[]> {
  const { decks } = await pedir<{ decks: DeckList[] }>("/api/decks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: profile.id, profileName: profile.name, deck }),
  });
  return decks;
}

export async function removeDeck(
  profile: Profile,
  deckId: string,
): Promise<DeckList[]> {
  const { decks } = await pedir<{ decks: DeckList[] }>(
    `/api/decks?profile=${encodeURIComponent(profile.id)}&deck=${encodeURIComponent(deckId)}`,
    { method: "DELETE" },
  );
  return decks;
}

/** Nome livre dentro da biblioteca — "Cópia", "Cópia 2"... */
export function nomeUnico(base: string, existentes: DeckList[]): string {
  const usados = new Set(existentes.map((deck) => deck.name));
  if (!usados.has(base)) return base;
  for (let n = 2; n < 999; n += 1) {
    const tentativa = `${base} ${n}`;
    if (!usados.has(tentativa)) return tentativa;
  }
  return `${base} ${Date.now()}`;
}

export function duplicarDeck(deck: DeckList, existentes: DeckList[]): DeckList {
  const copia = createEmptyDeck(nomeUnico(`${deck.name} (cópia)`, existentes));
  return {
    ...copia,
    main: deck.main.map((ref) => ({ ...ref })),
    extra: deck.extra.map((ref) => ({ ...ref })),
    side: deck.side.map((ref) => ({ ...ref })),
  };
}
