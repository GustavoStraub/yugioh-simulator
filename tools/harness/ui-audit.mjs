/**
 * O que os testes de UI headless compartilham: a régua de "a tela consegue
 * responder a este prompt?".
 *
 * Mora aqui (e não copiada em cada teste) porque ela precisa acompanhar o
 * `PromptPlan`: campo novo no plano que a tela renderiza e esta função não
 * checa vira falso "travou". Usada por `test-ui-prompts.mjs` e
 * `test-preset-decks.mjs`. (`test-ui-rare-prompts.mjs` tem uma versão própria,
 * mais frouxa na seleção — ao mudar o `PromptPlan`, atualizar as duas.)
 */
import { isCandidateOnBoard, needsCardPicker } from "@/lib/duel/prompt-reach";

/**
 * Um plano só é jogável se oferecer alguma coisa para o jogador fazer.
 *
 * A lista precisa acompanhar os campos do `PromptPlan`: um campo novo que a
 * tela saiba renderizar mas que não seja checado aqui vira falso negativo — o
 * teste acusa travamento onde não há.
 *
 * A seleção é o caso delicado, e ela já escondeu um travamento: `selection !==
 * null` era tratado como "jogável", mas uma seleção cujos candidatos não são
 * clicáveis na mesa **nem** abrem o seletor em modal é uma barra de
 * "Confirmar" desabilitada e mais nada.
 *
 * Hoje isso não pode mais acontecer por construção: o tabuleiro decide se abre
 * o seletor com `needsCardPicker`, a mesma função usada aqui, e ela cobre todo
 * candidato fora de alcance. O que sobra para checar é o caso degenerado —
 * seleção sem candidato nenhum —, e a checagem de alcance fica como sentinela:
 * se alguém trocar a regra do tabuleiro por uma cópia, isto volta a ter dente.
 */
export function planIsActionable(plan, viewer = 0) {
  if (plan.selection) {
    const { candidates } = plan.selection;
    if (candidates.length === 0) return false;
    return (
      needsCardPicker(candidates, viewer) ||
      candidates.every((c) => isCandidateOnBoard(c, viewer))
    );
  }

  return (
    plan.byCard.size > 0 ||
    plan.global.length > 0 ||
    plan.places.length > 0 ||
    plan.sorting !== null ||
    (plan.announce?.options.length ?? 0) > 0 ||
    plan.announceCard !== null ||
    plan.placeSelection !== null ||
    plan.counters !== null
  );
}

