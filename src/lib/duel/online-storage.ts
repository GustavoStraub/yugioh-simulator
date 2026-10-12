import { randomId } from "@/lib/random-id";
import type { DuelDeckPayload } from "@/lib/types";

/**
 * Identidade e escolhas do duelo online — tudo em `sessionStorage`.
 *
 * A aba é a conta. É o que faz abrir a mesma URL duas vezes valer por dois
 * jogadores: `localStorage` é compartilhado entre as abas do navegador e as
 * duas entrariam na sala como a mesma pessoa, brigando pelo mesmo assento.
 */
export const ONLINE_TOKEN_KEY = "yugioh-goat-online-token-v1";
export const ONLINE_SETUP_KEY = "yugioh-goat-online-setup-v1";

export interface StoredOnlineSetup {
  name: string;
  deckName: string;
  deck: DuelDeckPayload;
  /** Id do deck pronto escolhido, ou `null` para o deck salvo do jogador. */
  presetId: string | null;
}

/** Identidade desta aba. Estável entre recargas — é o que permite reconectar. */
export function playerToken(): string {
  if (typeof window === "undefined") return "";

  const existing = sessionStorage.getItem(ONLINE_TOKEN_KEY);
  if (existing) return existing;

  const token = randomId();
  sessionStorage.setItem(ONLINE_TOKEN_KEY, token);
  return token;
}

/** Nome padrão distinguível entre abas, para não ficarem dois "Duelista". */
export function defaultPlayerName(): string {
  return `Duelista ${playerToken().slice(0, 4).toUpperCase()}`;
}

export function saveOnlineSetup(setup: StoredOnlineSetup): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ONLINE_SETUP_KEY, JSON.stringify(setup));
}

export function loadOnlineSetup(): StoredOnlineSetup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ONLINE_SETUP_KEY);
    return raw ? (JSON.parse(raw) as StoredOnlineSetup) : null;
  } catch {
    return null;
  }
}
