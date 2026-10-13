import type { ScenarioCard } from "@/lib/duel/duel-session";
import type { DuelDeckPayload, DuelFormat } from "@/lib/types";

export const DUEL_SETUP_STORAGE_KEY = "yugioh-goat-duel-setup-v1";

export interface StoredDuelSetup {
  playerName: string;
  playerDeck: DuelDeckPayload;
  opponentId: string;
  opponentName: string;
  opponentDeck: DuelDeckPayload;
  /** Regras do duelo; ausente num duelo preparado antes do TCG = Goat. */
  format?: DuelFormat;
  /**
   * Mesa de teste (`DuelSessionConfig.scenario`). Nenhuma tela grava isto: só
   * os testes de navegador, que montam o duelo direto no `sessionStorage`.
   */
  scenario?: ScenarioCard[];
  /**
   * Quem começa, como foi escolhido no lobby. `coin` é sorteado de novo a
   * cada partida (a revanche joga a moeda outra vez).
   */
  firstTurn?: FirstTurnChoice;
  /** O assento de quem joga nesta partida (1 = o bot começa). Ausente = 0. */
  humanSeat?: 0 | 1;
  /** A linha da moeda, quando houve sorteio. */
  openingNote?: string;
  /** Duelo-problema (`puzzles.ts`): a mesa, os decks e o LP vêm dele. */
  puzzleId?: string;
  /** Bot × bot: quem abre a página só assiste (o seu deck contra o do bot). */
  spectate?: boolean;
}

export type FirstTurnChoice = "me" | "bot" | "coin";

/**
 * Resolve quem começa: o assento de quem joga e, na moeda, a frase do
 * resultado. Chamada num clique (lobby, revanche) — nunca durante o render.
 */
export function resolveFirstTurn(choice: FirstTurnChoice | undefined): {
  humanSeat: 0 | 1;
  openingNote?: string;
} {
  if (choice === "bot") return { humanSeat: 1 };
  if (choice === "coin") {
    const comeco = Math.random() < 0.5;
    return {
      humanSeat: comeco ? 0 : 1,
      openingNote: comeco ? "🪙 Moeda: você começa" : "🪙 Moeda: o oponente começa",
    };
  }
  return { humanSeat: 0 };
}

export function saveDuelSetup(setup: StoredDuelSetup): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(DUEL_SETUP_STORAGE_KEY, JSON.stringify(setup));
}

export function loadDuelSetup(): StoredDuelSetup | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(DUEL_SETUP_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDuelSetup;
  } catch {
    return null;
  }
}

export function clearDuelSetup(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DUEL_SETUP_STORAGE_KEY);
}
