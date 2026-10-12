import {
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgAttributeParse,
  ocgPositionParse,
  ocgRaceParse,
  type OcgMessage,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

import { pickFieldPlaces } from "@/lib/duel/field-places";
import { findSumSubset, sumRequestOf } from "@/lib/duel/sum-selection";

const PROMPT_TYPES = new Set<OcgMessageType>([
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.ROCK_PAPER_SCISSORS,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
  // Efeitos de gatilho simultâneos do mesmo jogador: o core pede a ordem em
  // que eles entram na corrente. Fora desta lista o duelo congelava.
  OcgMessageType.SORT_CHAIN,
]);

/**
 * Battle Ox — Guerreiro-Fera de Terra sem efeito, nunca é monstro de Extra
 * Deck. Serve de resposta padrão para ANNOUNCE_CARD: passa em qualquer filtro
 * "não pode ser Extra Deck" ou "precisa ser monstro" que os scripts do pool
 * Goat realmente usam (Arquiteto do mal, Designators, Grande Ladrão Fantasma,
 * Estilhaçar Mentes...). Não precisa ser uma escolha "inteligente" — só uma
 * resposta sempre legal para o bot não travar o duelo.
 */
const ANNOUNCE_CARD_FALLBACK = 5053103;

export function findPromptMessage(messages: OcgMessage[]): OcgMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (PROMPT_TYPES.has(message.type)) {
      return message;
    }
  }
  return null;
}

/** Respostas automáticas simples para o bot (jogador 1). */
export function botAutoResponse(message: OcgMessage): OcgResponse {
  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      if (message.summons.length > 0) {
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.SELECT_SUMMON,
          index: 0,
        };
      }
      if (message.monster_sets.length > 0) {
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.SELECT_MONSTER_SET,
          index: 0,
        };
      }
      if (message.spell_sets.length > 0) {
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.SELECT_SPELL_SET,
          index: 0,
        };
      }
      if (message.to_bp) {
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.TO_BP,
          index: null,
        };
      }
      return {
        type: OcgResponseType.SELECT_IDLECMD,
        action: SelectIdleCMDAction.TO_EP,
        index: null,
      };
    }

    case OcgMessageType.SELECT_BATTLECMD:
      if (message.attacks.length > 0) {
        return {
          type: OcgResponseType.SELECT_BATTLECMD,
          action: SelectBattleCMDAction.SELECT_BATTLE,
          index: 0,
        };
      }
      return {
        type: OcgResponseType.SELECT_BATTLECMD,
        action: SelectBattleCMDAction.TO_EP,
        index: null,
      };

    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };

    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };

    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };

    case OcgMessageType.SELECT_CARD: {
      const count = Math.max(message.min, 1);
      const indicies = Array.from({ length: count }, (_, index) => index);
      return { type: OcgResponseType.SELECT_CARD, indicies };
    }

    case OcgMessageType.SELECT_CHAIN:
      // Quando a corrente é forçada, recusar é resposta inválida — o core
      // devolve RETRY e o duelo entra em loop. Nesse caso encadeia a primeira.
      return {
        type: OcgResponseType.SELECT_CHAIN,
        index: message.forced && message.selects.length > 0 ? 0 : null,
      };

    case OcgMessageType.SELECT_PLACE:
      return {
        type: OcgResponseType.SELECT_PLACE,
        places: pickFieldPlaces(
          message.field_mask,
          message.player,
          message.count,
        ),
      };

    case OcgMessageType.SELECT_POSITION: {
      // O mask nem sempre permite FACEUP_ATTACK — responder uma posição
      // inválida faz o core devolver RETRY em loop.
      const allowed = ocgPositionParse(message.positions);
      return {
        type: OcgResponseType.SELECT_POSITION,
        position: allowed.includes(OcgPosition.FACEUP_ATTACK)
          ? OcgPosition.FACEUP_ATTACK
          : (allowed[0] ?? OcgPosition.FACEUP_ATTACK),
      };
    }

    case OcgMessageType.SELECT_TRIBUTE:
      return {
        type: OcgResponseType.SELECT_TRIBUTE,
        indicies: message.selects.slice(0, message.min).map((_, index) => index),
      };

    case OcgMessageType.SELECT_COUNTER: {
      // Uma entrada por CARTA candidata (não por contador) — a resposta tem
      // que ter o mesmo tamanho de `message.cards`, e cada posição diz quantos
      // contadores aquela carta recebe. Preenche gulosamente até bater
      // `message.count`, respeitando o teto de cada carta.
      let remaining = message.count;
      const counters = message.cards.map((card) => {
        const take = Math.min(remaining, card.count);
        remaining -= take;
        return take;
      });
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }

    case OcgMessageType.SELECT_SUM:
      // Precisa somar `amount` pelas regras do core (exata ou "igual ou maior",
      // ver `sum-selection.ts`) — pegar as primeiras dava RETRY.
      return {
        type: OcgResponseType.SELECT_SUM,
        indicies: findSumSubset(sumRequestOf(message)),
      };

    case OcgMessageType.SELECT_DISFIELD:
      return {
        type: OcgResponseType.SELECT_DISFIELD,
        places: pickFieldPlaces(
          message.field_mask,
          message.player,
          message.count,
        ),
      };

    case OcgMessageType.SORT_CARD:
      return {
        type: OcgResponseType.SORT_CARD,
        order: message.cards.map((_, index) => index),
      };

    // Mesmo formato de resposta do SORT_CARD; `null` é a ordem padrão do core.
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };

    case OcgMessageType.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };

    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 };

    case OcgMessageType.ANNOUNCE_RACE:
      // `races` é OR'd pelo binding — precisa de `count` valores DISTINTOS,
      // não do mesmo bit repetido.
      return {
        type: OcgResponseType.ANNOUNCE_RACE,
        races: ocgRaceParse(message.available).slice(0, message.count),
      };

    case OcgMessageType.ANNOUNCE_ATTRIB:
      return {
        type: OcgResponseType.ANNOUNCE_ATTRIB,
        attributes: ocgAttributeParse(message.available).slice(0, message.count),
      };

    case OcgMessageType.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: ANNOUNCE_CARD_FALLBACK };

    case OcgMessageType.ANNOUNCE_NUMBER:
      // Resposta é o ÍNDICE dentro de `options`, não o valor declarado.
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 };

    default:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };
  }
}

export function isBotPlayer(message: OcgMessage): boolean {
  return "player" in message && message.player === 1;
}
