/**
 * Dicas de primeira vez — uma por vez, no momento em que servem.
 *
 * O Master Duel ensina com portões e o Tag Force com aulas; aqui a dica
 * aparece na primeira vez que a situação acontece ("o oponente ativou algo e
 * você pode responder") e some para sempre depois do "Entendi". Quem já sabe
 * desliga todas de uma vez na engrenagem.
 */
export interface TipContext {
  /** Há uma pergunta para quem joga agora. */
  myPrompt: boolean;
  /** É a Main Phase de quem joga, com carta para clicar. */
  canPlay: boolean;
  /** A pergunta é a Battle Phase (escolher quem ataca). */
  battle: boolean;
  /** A pergunta é responder a uma corrente / janela de resposta. */
  chainWindow: boolean;
  /** Um diálogo de decisão está aberto (e visível). */
  decisionOpen: boolean;
  /** Uma seleção na própria mesa (barra de Confirmar). */
  inlineSelection: boolean;
}

export interface DuelTip {
  id: string;
  text: string;
  when: (ctx: TipContext) => boolean;
}

/** Na ordem de prioridade: a primeira que casar e ainda não foi vista aparece. */
export const TIPS: DuelTip[] = [
  {
    id: "corrente",
    text:
      "Você pode responder ao que acabou de acontecer: escolha a carta que responde (na lista ou na mesa, onde ela brilha) e ative — ou \"Não responder\". O botão Auto, no canto de baixo à direita, decide quando o jogo pergunta; segure Ctrl para ser perguntado em toda janela.",
    when: (ctx) => ctx.chainWindow,
  },
  {
    id: "esconder",
    text:
      "Precisa olhar a mesa antes de decidir? A seta para baixo (ou Esc) esconde esta janela — a decisão continua esperando, e o Cemitério e o Extra Deck ficam clicáveis.",
    when: (ctx) => ctx.decisionOpen && !ctx.chainWindow,
  },
  {
    id: "selecao",
    text:
      "Escolha as cartas que brilham em amarelo e confirme na barra. Quando é uma carta só, clicar de novo nela já confirma.",
    when: (ctx) => ctx.inlineSelection,
  },
  {
    id: "batalha",
    text:
      "Battle Phase: clique num monstro seu que brilha e escolha Atacar. Quando terminar, avance pelo botão redondo de fase, à direita da mesa.",
    when: (ctx) => ctx.battle,
  },
  {
    id: "jogar",
    text:
      "As cartas que brilham têm jogada — azul para Invocar, Baixar e Atacar; amarelo para ativar efeito. Clique numa para ver os comandos. Para avançar de fase, clique no botão redondo à direita da mesa.",
    when: (ctx) => ctx.canPlay,
  },
  {
    id: "ler",
    text:
      "Passe o mouse (ou toque) numa carta para ler o texto dela. Os termos sublinhados explicam a regra — clique neles.",
    when: () => true,
  },
];

/** A dica da vez, ou `null` (todas vistas, ou nenhuma serve agora). */
export function nextTip(ctx: TipContext, seen: ReadonlySet<string>): DuelTip | null {
  return TIPS.find((tip) => !seen.has(tip.id) && tip.when(ctx)) ?? null;
}

export interface TipsState {
  off: boolean;
  seen: string[];
}

export const TIPS_KEY = "yugioh-goat-tips-v1";
export const DEFAULT_TIPS: TipsState = { off: false, seen: [] };

export function parseTips(raw: string | null): TipsState {
  if (!raw) return DEFAULT_TIPS;
  try {
    const parsed = JSON.parse(raw) as Partial<TipsState>;
    return {
      off: parsed.off === true,
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return DEFAULT_TIPS;
  }
}
