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
export function autoResponseFor(message: OcgMessage): OcgResponse | null {
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

    case OcgMessageType.ANNOUNCE_NUMBER:
      return message.options.length === 1
        ? { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 }
        : null;

    case OcgMessageType.SELECT_COUNTER:
      // Tantas cartas candidatas quanto contadores exigidos: não há "qual
      // carta escolher", todas recebem 1 (mesmo modelo de duel-actions.ts).
      return message.cards.length === message.count
        ? {
            type: OcgResponseType.SELECT_COUNTER,
            counters: message.cards.map(() => 1),
          }
        : null;

    default:
      return null;
  }
}
