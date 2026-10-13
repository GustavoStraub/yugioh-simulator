import { isChainResponseMode, type ChainResponseMode } from "@/lib/duel/chain-mode";

/**
 * Preferências do jogador para a mesa — o que a engrenagem do duelo guarda.
 *
 * Moram no navegador (localStorage) porque são conveniência de quem joga, não
 * dado do duelo: perdê-las num modo anônimo só volta ao padrão. O que muda o
 * engine (o modo de resposta) é empurrado para a sessão — local ou, no online,
 * pelo socket até o servidor (`ClientMessage` "prefs").
 */
export interface DuelPrefs {
  /** Quando perguntar "deseja responder?" — ver `chain-mode.ts`. */
  chainMode: ChainResponseMode;
  /** Velocidade das animações e das pausas entre jogadas. */
  speed: DuelSpeed;
}

/**
 * Ritmo do duelo.
 *
 * Três passos, como a "Card Animation" do Tag Force 6 sem o "Lenta" (que lá
 * existia porque o normal já era rápido para o PSP). O Master Duel não tem
 * ajuste nenhum — e é a reclamação número um dele.
 */
export type DuelSpeed = "normal" | "fast" | "faster";

/** Multiplicador das pausas e das animações de cada velocidade. */
export const SPEED_SCALE: Record<DuelSpeed, number> = {
  normal: 1,
  fast: 0.6,
  faster: 0.3,
};

export const SPEED_LABEL: Record<DuelSpeed, string> = {
  normal: "Normal",
  fast: "Rápida",
  faster: "Muito rápida",
};

export const CHAIN_MODE_LABEL: Record<ChainResponseMode, string> = {
  auto: "Automático",
  always: "Sempre perguntar",
  never: "Nunca perguntar",
};

/** Uma frase do que cada modo faz — aparece junto da escolha. */
export const CHAIN_MODE_HINT: Record<ChainResponseMode, string> = {
  auto:
    "Pergunta quando o oponente ativa algo, invoca, ataca ou chega à End Phase — " +
    "os momentos em que alguém responderia.",
  always: "Pergunta em toda janela em que você tem uma carta para ativar.",
  never: "Só pergunta quando encadear é obrigatório. Segure Ctrl para parar.",
};

export const DEFAULT_DUEL_PREFS: DuelPrefs = { chainMode: "auto", speed: "normal" };

export const DUEL_PREFS_KEY = "yugioh-goat-duel-prefs-v1";

function isSpeed(value: unknown): value is DuelSpeed {
  return value === "normal" || value === "fast" || value === "faster";
}

/** Texto guardado → preferências; qualquer coisa estranha volta ao padrão. */
export function parseDuelPrefs(raw: string | null): DuelPrefs {
  if (!raw) return DEFAULT_DUEL_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof DuelPrefs, unknown>>;
    return {
      chainMode: isChainResponseMode(parsed.chainMode)
        ? parsed.chainMode
        : DEFAULT_DUEL_PREFS.chainMode,
      speed: isSpeed(parsed.speed) ? parsed.speed : DEFAULT_DUEL_PREFS.speed,
    };
  } catch {
    return DEFAULT_DUEL_PREFS;
  }
}

/** Lê o texto cru — `null` fora do navegador ou com o armazenamento bloqueado. */
export function readDuelPrefsRaw(): string | null {
  try {
    return localStorage.getItem(DUEL_PREFS_KEY);
  } catch {
    return null;
  }
}

/** Grava; devolve `false` quando o navegador não deixa (aba anônima, cota). */
export function writeDuelPrefs(prefs: DuelPrefs): boolean {
  try {
    localStorage.setItem(DUEL_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
