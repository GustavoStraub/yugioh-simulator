import { OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A, SelectBattleCMDAction as B,
  ocgAttributeParse, ocgRaceParse, type OcgMessage, type OcgResponse } from "@n1xx1/ocgcore-wasm";
import { decodeFieldMask } from "@/lib/duel/field-places";
import { isValidSum, sumRequestOf } from "@/lib/duel/sum-selection";
import { isDeclarable } from "@/lib/duel/announce-filter";
import type { OfficialCardDb } from "@/lib/duel/official-card-data";

const indexIn = (i: number | null, n: number) => i !== null && Number.isInteger(i) && i >= 0 && i < n;
const distinct = (values: readonly unknown[]) => new Set(values).size === values.length;
const indicesIn = (values: number[], n: number) => distinct(values) && values.every((i) => indexIn(i, n));

/** Confere o contrato observável; efeitos e restrições internos continuam no core. */
export function validBotResponse(p: OcgMessage, r: OcgResponse, db: OfficialCardDb): boolean {
  switch (p.type) {
    case M.SELECT_IDLECMD: {
      if (r.type !== R.SELECT_IDLECMD) return false;
      const lists = { [A.SELECT_SUMMON]: p.summons, [A.SELECT_SPECIAL_SUMMON]: p.special_summons,
        [A.SELECT_POS_CHANGE]: p.pos_changes, [A.SELECT_MONSTER_SET]: p.monster_sets,
        [A.SELECT_SPELL_SET]: p.spell_sets, [A.SELECT_ACTIVATE]: p.activates };
      if (r.action === A.TO_BP) return p.to_bp;
      if (r.action === A.TO_EP) return p.to_ep;
      if (r.action === A.SHUFFLE) return p.shuffle;
      return indexIn(r.index, lists[r.action]?.length ?? 0);
    }
    case M.SELECT_BATTLECMD:
      return r.type === R.SELECT_BATTLECMD && (r.action === B.TO_M2 ? p.to_m2 : r.action === B.TO_EP ? p.to_ep
        : indexIn(r.index, r.action === B.SELECT_CHAIN ? p.chains.length : p.attacks.length));
    case M.SELECT_CARD:
      return r.type === R.SELECT_CARD && (r.indicies === null ? p.can_cancel
        : indicesIn(r.indicies, p.selects.length) && r.indicies.length >= p.min && r.indicies.length <= p.max);
    case M.SELECT_UNSELECT_CARD:
      return r.type === R.SELECT_UNSELECT_CARD && (r.index === null ? p.can_finish || p.can_cancel
        : indexIn(r.index, p.select_cards.length + p.unselect_cards.length));
    case M.SELECT_CHAIN:
      return r.type === R.SELECT_CHAIN && (r.index === null ? !p.forced : indexIn(r.index, p.selects.length));
    case M.SELECT_SUM:
      return r.type === R.SELECT_SUM && Array.isArray(r.indicies) && indicesIn(r.indicies, p.selects.length)
        && isValidSum(sumRequestOf(p), r.indicies);
    case M.SELECT_TRIBUTE:
      return r.type === R.SELECT_TRIBUTE && (r.indicies === null ? p.can_cancel : indicesIn(r.indicies, p.selects.length)
        && r.indicies.length <= p.max && r.indicies.reduce((sum, i) => sum + Math.max(1, p.selects[i].release_param), 0) >= p.min);
    case M.SELECT_POSITION:
      return r.type === R.SELECT_POSITION && (r.position & p.positions) === r.position && (r.position & (r.position - 1)) === 0;
    case M.SELECT_EFFECTYN: return r.type === R.SELECT_EFFECTYN;
    case M.SELECT_YESNO: return r.type === R.SELECT_YESNO;
    case M.SELECT_OPTION: return r.type === R.SELECT_OPTION && indexIn(r.index, p.options.length);
    case M.ANNOUNCE_NUMBER: return r.type === R.ANNOUNCE_NUMBER && indexIn(r.value, p.options.length);
    case M.SELECT_PLACE:
    case M.SELECT_DISFIELD: {
      if (r.type !== (p.type === M.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD) || !("places" in r)) return false;
      const allowed = decodeFieldMask(p.field_mask, p.player);
      return r.places.length === Math.max(1, p.count) && distinct(r.places.map((x) => `${x.player}:${x.location}:${x.sequence}`))
        && r.places.every((x) => allowed.some((a) => a.player === x.player && a.location === x.location && a.sequence === x.sequence));
    }
    case M.SELECT_COUNTER:
      return r.type === R.SELECT_COUNTER && r.counters.length === p.cards.length
        && r.counters.every((v, i) => Number.isInteger(v) && v >= 0 && v <= p.cards[i].count)
        && r.counters.reduce((sum, v) => sum + v, 0) === p.count;
    case M.SORT_CHAIN:
    case M.SORT_CARD:
      return r.type === R.SORT_CARD && (r.order === null || r.order.length === p.cards.length && indicesIn(r.order, p.cards.length));
    case M.ANNOUNCE_RACE:
      return r.type === R.ANNOUNCE_RACE && r.races.length === p.count && distinct(r.races)
        && r.races.every((v) => ocgRaceParse(p.available).includes(v));
    case M.ANNOUNCE_ATTRIB:
      return r.type === R.ANNOUNCE_ATTRIB && r.attributes.length === p.count && distinct(r.attributes)
        && r.attributes.every((v) => ocgAttributeParse(p.available).includes(v));
    case M.ANNOUNCE_CARD: {
      if (r.type !== R.ANNOUNCE_CARD) return false;
      const card = db.get(r.card);
      return card !== null && isDeclarable(p.opcodes, { code: r.card, alias: card.alias, type: card.type,
        race: card.race, attribute: card.attribute, setcodes: card.setcodes });
    }
    case M.ROCK_PAPER_SCISSORS: return r.type === R.ROCK_PAPER_SCISSORS && [1, 2, 3].includes(r.value);
    default: return false;
  }
}
