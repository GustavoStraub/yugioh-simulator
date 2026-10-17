/** O orçamento muda a análise, nunca as regras, listas ou compras do duelo. */
export type BotDifficulty = "easy" | "medium" | "hard";

export interface BotPolicy {
  cpuMs: number;
  alternatives: number;
  battleWidth: number;
  battleDepth: number;
  preserveResources: boolean;
  considerResponses: boolean;
}

export const BOT_POLICIES: Record<BotDifficulty, BotPolicy> = {
  easy: { cpuMs: 25, alternatives: 1, battleWidth: 1, battleDepth: 1, preserveResources: false, considerResponses: false },
  medium: { cpuMs: 100, alternatives: 8, battleWidth: 4, battleDepth: 5, preserveResources: true, considerResponses: false },
  hard: { cpuMs: 300, alternatives: 24, battleWidth: 8, battleDepth: 7, preserveResources: true, considerResponses: true },
};

export const BOT_DIFFICULTIES: { id: BotDifficulty; label: string; description: string }[] = [
  { id: "easy", label: "Fácil", description: "Aprenda o deck e pratique suas primeiras jogadas." },
  { id: "medium", label: "Médio", description: "Enfrente um bot que conhece as estratégias do deck." },
  { id: "hard", label: "Difícil", description: "Enfrente um bot que planeja sequências e adapta suas respostas." },
];

export function botDifficulty(value: unknown): BotDifficulty {
  return value === "easy" || value === "hard" ? value : "medium";
}

/** Independente da semente do core: não permite inferir a ordem de compras. */
export function botRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
