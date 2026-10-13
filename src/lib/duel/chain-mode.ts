import {
  OcgResponseType,
  type OcgMessageSelectChain,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

/**
 * Quando a tela pergunta "deseja responder com algum efeito?".
 *
 * O core oferece uma janela de resposta (SELECT_CHAIN) em TODA troca de fase,
 * passo de batalha, invocação e ativação — a cada uma em que o jogador tem
 * alguma carta legal para ativar. Com uma única Magia Rápida baixada isso dá
 * dezenas de perguntas por turno; medido no core real (docs/ui-ux-plano.md,
 * §7), um Scapegoat baixado gerava 35 perguntas em 4 turnos, e só 5 eram nos
 * momentos em que alguém ativaria (o ataque e a End Phase do oponente). O
 * jogador vira um clicador de "Não responder".
 *
 * Os três modos são os do Master Duel ("Activation Confirmation") e dos botões
 * de corrente do EDOPro:
 *
 * - `auto` — pergunta quando importa (ver `chainWindowSkip`);
 * - `always` — toda janela com resposta legal (o comportamento antigo);
 * - `never` — só quando encadear é obrigatório.
 */
export type ChainResponseMode = "auto" | "always" | "never";

export const CHAIN_RESPONSE_MODES: readonly ChainResponseMode[] = ["auto", "always", "never"];

export function isChainResponseMode(value: unknown): value is ChainResponseMode {
  return value === "auto" || value === "always" || value === "never";
}

/** O que a regra precisa saber da corrente, além da própria pergunta. */
export interface ChainWindowContext {
  /**
   * Quem ativou o último elo ainda por resolver; `null` fora de corrente.
   *
   * É o que separa "o oponente acabou de ativar algo" (sempre vale perguntar)
   * de "eu acabei de ativar e o core me oferece encadear no meu próprio efeito"
   * — a janela que o Master Duel tira do automático (*Self Chain*), porque a
   * resposta é quase sempre não, e se o oponente responder a pergunta volta.
   */
  topLinkPlayer: number | null;
}

const PASS: OcgResponse = { type: OcgResponseType.SELECT_CHAIN, index: null };

/**
 * A resposta automática ("não responder") para uma janela que o modo manda
 * pular, ou `null` quando a pergunta deve chegar ao jogador.
 *
 * No modo `auto`:
 * - obrigatório → pergunta (não há como pular);
 * - há corrente e o último elo é do **oponente** → pergunta: responder a uma
 *   ativação dele é o caso clássico (Ash Blossom contra uma busca);
 * - há corrente e o último elo é **meu** → pula;
 * - fora de corrente → pergunta só se o core marca a janela como relevante
 *   (`spe_count > 0`: algum candidato tem *hint timing* que casa com este
 *   momento — invocação, ataque, End Phase…). É o mesmo critério que o cliente
 *   do YGOPro/EDOPro usa por padrão, e o dado vem pronto do core.
 *
 * Armadilhas de gatilho (Mirror Force, Solemn) e hand traps nem chegam a ser
 * oferecidas fora da hora certa, então o modo não muda nada para elas; o corte
 * cai nas Magias Rápidas e efeitos rápidos de uso amplo, oferecidos em toda
 * troca de fase dos dois turnos.
 */
export function chainWindowSkip(
  message: OcgMessageSelectChain,
  mode: ChainResponseMode,
  context: ChainWindowContext,
): OcgResponse | null {
  if (message.forced || message.selects.length === 0) return null;
  if (mode === "always") return null;
  if (mode === "never") return PASS;

  if (context.topLinkPlayer !== null) {
    return context.topLinkPlayer === message.player ? PASS : null;
  }
  return message.spe_count > 0 ? null : PASS;
}
