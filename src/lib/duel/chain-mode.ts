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
 *
 * Nenhum dos três cala os efeitos de gatilho das próprias cartas (ver
 * `isTriggerWindow`): ativá-los ou não é decisão, não resposta.
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
 * O `spe_count` com que o core marca a janela de **efeitos de gatilho**.
 *
 * Quando vários gatilhos do mesmo jogador acontecem juntos (a Invocação-Link
 * que ativa o efeito do Link E o do material que foi para o Cemitério), o core
 * não pergunta "deseja responder?": ele monta a corrente (SEGOC) perguntando
 * qual gatilho entra agora — um SELECT_CHAIN com `spe_count = 0x7f`
 * (`processor.cpp`, `Processors::PointEvent`, passos 2 e 4). Escolhido um, ele
 * pergunta de novo com os que sobraram, já com o primeiro na corrente. Um
 * gatilho opcional sozinho, fora de corrente, vem como SELECT_EFFECTYN
 * ("ativar o efeito?") — a mesma decisão, por outra mensagem.
 *
 * Nas janelas de resposta comuns o `spe_count` é uma contagem de candidatos
 * (`core.spe_effect`), que nunca chega a 127.
 */
export const TRIGGER_WINDOW_SPE_COUNT = 0x7f;

/** É a janela que monta a corrente com os gatilhos que acabaram de acontecer? */
export function isTriggerWindow(message: OcgMessageSelectChain): boolean {
  return message.spe_count === TRIGGER_WINDOW_SPE_COUNT;
}

/**
 * A resposta automática ("não responder") para uma janela que o modo manda
 * pular, ou `null` quando a pergunta deve chegar ao jogador.
 *
 * Janela de gatilhos (`isTriggerWindow`) sempre pergunta, em todo modo:
 * passar nela não é "não responder", é **descartar** o efeito opcional — o
 * core o tira da lista e não oferece de novo. Era o que sumia com o efeito do
 * material: a Halqifibrax entrava como Elo 1, o core perguntava pelo Swap
 * Cleric com o Elo 1 sendo "meu", e a regra do *Self Chain* abaixo respondia
 * por mim. O modo decide quando a tela pergunta se quero **responder**; ativar
 * o efeito da minha própria carta é outra pergunta, e a do gatilho único
 * (SELECT_EFFECTYN) nunca passou pelo modo.
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
  if (isTriggerWindow(message)) return null;
  if (mode === "always") return null;
  if (mode === "never") return PASS;

  if (context.topLinkPlayer !== null) {
    return context.topLinkPlayer === message.player ? PASS : null;
  }
  return message.spe_count > 0 ? null : PASS;
}
