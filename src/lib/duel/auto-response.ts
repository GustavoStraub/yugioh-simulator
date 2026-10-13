import {
  OcgMessageType,
  OcgResponseType,
  ocgAttributeParse,
  ocgPositionParse,
  ocgRaceParse,
  type OcgMessage,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

import { decodeFieldMask } from "@/lib/duel/field-places";

/**
 * Responde sozinho os prompts em que o jogador não tem escolha nenhuma.
 *
 * O caso dominante é SELECT_CHAIN sem nada encadeável: o core pergunta "quer
 * responder com algum efeito?" a cada passo de cada fase, e sem isso a tela
 * ficaria o duelo inteiro pedindo confirmação de um "não" que é a única
 * resposta possível.
 *
 * @returns a resposta automática, ou `null` quando existe uma decisão real
 *   a ser tomada pelo jogador.
 */
/**
 * Cartas cujo "declare um número" é só "quantas do topo você quer olhar para
 * reordenar": Avanço de Carta, Silvano Árvore-Eremita e Grande Olho. Olhar o
 * máximo nunca é pior — a ordenação logo depois deixa recolocar tudo como
 * estava —, então a pergunta "1, 2, 3, 4, 5?" solta, sem dizer do que se
 * trata, só atrapalhava: a resposta é o máximo e o jogador vai direto para a
 * ordenação. (O Grande Olho nem usa o número: o script ordena 5 de qualquer
 * jeito.) Orea, o Árbitro Silvano NÃO entra: lá o número decide quantas cartas
 * são escavadas, e isso é escolha de verdade.
 */
const LOOK_AND_SORT_CARDS = new Set([
  52112003, // Card Advance
  25824484, // Sylvan Hermitree
  16768387, // Big Eye
]);

export interface AutoResponseContext {
  /** Código da carta cujo elo da corrente está resolvendo agora, se algum. */
  resolvingCode?: number | null;
}

export function autoResponseFor(
  message: OcgMessage,
  context: AutoResponseContext = {},
): OcgResponse | null {
  switch (message.type) {
    case OcgMessageType.SELECT_CHAIN: {
      if (message.selects.length === 0) {
        // Nada para encadear — só existe "não responder".
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      }
      if (message.forced && message.selects.length === 1) {
        // Encadear é obrigatório e só há um candidato.
        return { type: OcgResponseType.SELECT_CHAIN, index: 0 };
      }
      return null;
    }

    case OcgMessageType.SELECT_OPTION:
      return message.options.length === 1
        ? { type: OcgResponseType.SELECT_OPTION, index: 0 }
        : null;

    case OcgMessageType.SELECT_POSITION: {
      const allowed = ocgPositionParse(message.positions);
      return allowed.length === 1
        ? { type: OcgResponseType.SELECT_POSITION, position: allowed[0] }
        : null;
    }

    case OcgMessageType.SELECT_PLACE: {
      const places = decodeFieldMask(message.field_mask, message.player);
      // Tantas zonas livres quanto as exigidas (não só 1/1) — acima disso
      // sobra de fato zona pra escolher, e isso é uma decisão real.
      return places.length === message.count
        ? { type: OcgResponseType.SELECT_PLACE, places }
        : null;
    }

    case OcgMessageType.SELECT_DISFIELD: {
      const places = decodeFieldMask(message.field_mask, message.player);
      return places.length === message.count
        ? { type: OcgResponseType.SELECT_DISFIELD, places }
        : null;
    }

    case OcgMessageType.ANNOUNCE_RACE: {
      const races = ocgRaceParse(message.available);
      // Tantas raças disponíveis quanto as exigidas — não sobra escolha,
      // é declarar todas (o caso raro de 1 disponível/1 exigida cai aqui também).
      return races.length === message.count
        ? { type: OcgResponseType.ANNOUNCE_RACE, races }
        : null;
    }

    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const attributes = ocgAttributeParse(message.available);
      return attributes.length === message.count
        ? { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes }
        : null;
    }

    // Ordem dos gatilhos simultâneos na corrente: a ordem padrão do core
    // (`order: null` vira o -1 que ele entende). É o que o plano previa — nunca
    // congelar —, e na prática a ordem só importa em combos que o jogador
    // monta de propósito; um seletor de ordem pode vir depois sem mudar nada aqui.
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };

    case OcgMessageType.ANNOUNCE_NUMBER: {
      if (message.options.length === 1) {
        return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 };
      }
      if (context.resolvingCode != null && LOOK_AND_SORT_CARDS.has(context.resolvingCode)) {
        // O core espera o ÍNDICE da opção, não o valor.
        let maior = 0;
        message.options.forEach((value, index) => {
          if (BigInt(value) > BigInt(message.options[maior])) maior = index;
        });
        return { type: OcgResponseType.ANNOUNCE_NUMBER, value: maior };
      }
      return null;
    }

    case OcgMessageType.SELECT_COUNTER: {
      // Só não há escolha quando é preciso tirar TODOS os marcadores que
      // existem. "Uma carta por marcador" (a regra antiga daqui) não era isso:
      // dava para tirar dois da mesma carta e deixar a outra intacta.
      const total = message.cards.reduce((sum, card) => sum + card.count, 0);
      return total === message.count
        ? {
            type: OcgResponseType.SELECT_COUNTER,
            counters: message.cards.map((card) => card.count),
          }
        : null;
    }

    default:
      return null;
  }
}
