import { OcgLocation as L, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A, type OcgCardLoc, type OcgResponse } from '@n1xx1/ocgcore-wasm';
import type { BotContext } from '@/lib/duel/bot/bot-brain';
import type { DuelDeckPayload } from '@/lib/types';
interface HeroRating { score: number; lessonId: string; reason: string; }
import { threatOf } from '@/lib/duel/bot/combat';
const C = { mal: 9411399, draw: 45809008, dyna: 37780349, dyst: 90579153, danger: 30757127, poly: 24094653, mist: 50720316, blaze: 63060238, mask: 21143940, law: 58481572, drill: 91691605, plasma: 83965310, cubed: 99357565, over: 72204747, cel: 63362460, wonder: 1948619, decim: 63813056, dusk: 93657021, dragoon: 76263644, reborn: 83764718, dogma: 17132130, clock: 75041269, eternal: 35787450 };
const lessons = { draw: 'destiny-draw-transforma-malicious-em-desenvolvimento', dyna: 'dynatag-habilita-a-destruicao-de-dystopia', danger: 'perigoso-prepara-malicioso', blaze: 'blazeman-envia-nevoa-e-renasce', wonder: 'wonder-driver-recupera-a-magia-usada', over: 'over-destiny-completa-plasma', dragoon: 'dragao-final-sem-tres-tributos', dusk: 'dusktopia-recicla-fusao', cel: 'celestial-recompensa-um-turno-de-recursos-esgotados' };
type Effect = OcgCardLoc & {
    description?: bigint;
};
/** Only instantiated for the reviewed deck signature. Candidate legality remains with the core. */
export class HeroStrategy {
    private active: Effect | null = null;
    private deck: DuelDeckPayload;
    constructor(deck: DuelDeckPayload) { this.deck = deck; }
    private remaining(code: number, ctx: BotContext) { const p = ctx.readBoard(true).players[ctx.me]; return this.deck.main.filter(c => c === code).length - [...p.hand, ...p.grave, ...p.banished, ...p.monsters, ...p.spells].filter(c => c?.code === code).length; }
    private rate(score: number, lessonId: string, reason: string): HeroRating { return { score, lessonId, reason: `Guia HERO: ${reason}` }; }
    effect(card: Effect, ctx: BotContext): HeroRating | null {
        const b = ctx.readBoard(true), p = b.players[ctx.me], foe = b.players[1 - ctx.me];
        const hand = (code: number) => p.hand.some(c => c.code === code), field = (code: number) => p.monsters.some(c => c?.code === code && !c.faceDown && !c.negated);
        const enemies = [...foe.monsters, ...foe.spells, foe.field].filter(c => c !== null);
        const idx = card.description !== undefined && card.description >= 0x100000n ? Number(card.description - (BigInt(card.code) << 20n)) : 0;
        if (card.code === C.draw)
            return this.rate(hand(C.mal) && this.remaining(C.mal, ctx) > 0 ? 195 : hand(C.dyna) && field(C.dyst) ? 180 : 100, lessons.draw, 'priorizar descarte que desenvolve o Cemitério');
        if (card.code === C.mal && card.location === L.GRAVE)
            return this.rate(hand(C.over) && hand(C.plasma) && p.monsters.filter(Boolean).length === 1 ? 85 : 155, lessons.over, 'usar Além do Destino antes de consumir o alvo de Nível 6');
        if (card.code === C.over)
            return this.rate(hand(C.plasma) || hand(C.poly) || field(C.wonder) ? 175 : -1, lessons.over, 'gerar corpo temporário apenas com continuação');
        if (card.code === C.dyna && card.location === L.GRAVE)
            return this.rate(field(C.dyst) && enemies.length ? 180 : ctx.turnPlayer === ctx.me && ctx.turnCount > 1 ? 75 : -1, lessons.dyna, 'habilitar Distopia ou aumentar pressão real');
        if (card.code === C.dyst)
            return this.rate(idx === 0 ? 160 : enemies.length ? 200 : -1, lessons.dyna, 'dano em alvo elegível; remoção apenas contra adversário');
        if (card.code === C.danger)
            return this.rate(this.remaining(C.mal, ctx) > 1 || field(C.dyst) && this.remaining(C.dyna, ctx) > 0 ? 170 : -1, lessons.danger, 'não pagar descarte por aumento sem continuação');
        if (card.code === C.blaze)
            return this.rate(idx === 0 ? hand(C.poly) ? -1 : 175 : hand(C.poly) && this.remaining(C.mist, ctx) > 0 && !field(C.wonder) ? 145 : -1, lessons.blaze, 'escolher busca ou envio sem misturar os dois efeitos');
        if (card.code === C.mist)
            return this.rate(160, 'dark-law', 'aceitar o efeito disponível respeitando o limite compartilhado');
        if (card.code === C.drill)
            return this.rate(p.hand.some(c => c.code !== null && ![26964762, C.mist, C.blaze, C.cubed].includes(c.code) && ((ctx.cardDb.get(c.code)?.type ?? 0) & 1) !== 0 && (ctx.cardDb.get(c.code)?.atk ?? 9999) <= 1600) ? 165 : -1, lessons.wonder, 'estender com HERÓI do Destino elegível da mão');
        if (card.code === C.wonder)
            return this.rate(170, lessons.wonder, 'recuperar Magia pela invocação na seta');
        if (card.code === C.cel && card.location === L.GRAVE)
            return this.rate(185, lessons.cel, 'repor a mão quando o motor oferece a compra legal');
        if (card.code === C.mask)
            return this.rate(field(C.law) ? -1 : 170, 'dark-law', 'estabelecer Lei Obscura antes de ações adversárias');
        if (card.code === C.dragoon)
            return this.rate(card.location === L.GRAVE ? 170 : ctx.turnPlayer === ctx.me && ctx.turnCount > 1 && enemies.length ? 85 : -1, lessons.dragoon, 'comparar remoção com perda da Fase de Batalha');
        if (card.code === C.dusk)
            return this.rate(idx === 1 && ctx.turnPlayer !== ctx.me && foe.monsters.some(c => c && !c.faceDown && !c.defense) ? 140 : -1, lessons.dusk, 'preservar dano e materiais; proteção exige ameaça concreta');
        return null;
    }
    idle(action: number, card: Effect, ctx: BotContext): HeroRating | null {
        if (action === A.SELECT_ACTIVATE)
            return this.effect(card, ctx);
        const p = ctx.readBoard(true).players[ctx.me], has = (code: number) => p.hand.some(c => c.code === code);
        if (action === A.SELECT_SUMMON) {
            if (card.code === C.mist && has(C.mask))
                return this.rate(175, 'dark-law', 'Normal permite Máscara e preserva a busca do Cemitério');
            if (card.code === C.blaze)
                return this.rate(160, lessons.blaze, 'acesso a Fusão ou envio de Névoa');
            if (card.code === C.drill)
                return this.rate(has(C.mask) || p.hand.some(c => c.code !== null && c.code !== C.drill && ![26964762, C.mist, C.blaze, C.cubed].includes(c.code) && ((ctx.cardDb.get(c.code)?.type ?? 0) & 1) !== 0 && (ctx.cardDb.get(c.code)?.atk ?? 9999) <= 1600) ? 175 : 95, lessons.wonder, 'priorizar Normal com extensão');
            if (card.code === C.cubed)
                return this.rate(has(C.plasma) && p.hand.length >= 4 ? 170 : 35, 'plasma', 'D ao Cubo precisa de Plasma e dois descartes para justificar o bloqueio');
        }
        if (action === A.SELECT_SPECIAL_SUMMON && card.code === C.plasma)
            return this.rate(ctx.readBoard(true).players[1 - ctx.me].monsters.some(Boolean) ? 185 : p.monsters.filter(Boolean).every(c => c?.code === C.cubed) ? 100 : -1, 'plasma', 'trocar três corpos por controle quando há ameaça');
        if (action === A.SELECT_SPECIAL_SUMMON && card.code === C.wonder)
            return this.rate(has(C.reborn) && p.grave.some(c => c.code === C.poly || c.code === C.mask) ? 165 : -1, lessons.wonder, 'Link de reciclagem precisa de Magia e nova invocação');
        if (action === A.SELECT_SPECIAL_SUMMON && card.code === C.decim)
            return this.rate(p.monsters.some(c => c?.code === C.dyst) && p.monsters.filter(Boolean).length >= 4 ? 175 : ctx.turnCount > 1 && p.monsters.filter(Boolean).length >= 3 ? 100 : -1, 'dizimador-altera-distopia', 'setas e nomes distintos geram pressão e podem alterar Distopia');
        return null;
    }
    respond(ctx: BotContext): {
        response: OcgResponse;
        lessonId: string;
        reason: string;
    } | null {
        const p = ctx.prompt, b = ctx.readBoard(true), mine = b.players[ctx.me];
        const effect = ctx.resolvingEffect ? ctx.resolvingEffect.player === ctx.me ? ctx.resolvingEffect : null : this.active;
        const code = effect?.code;
        const answer = (response: OcgResponse, lessonId: string, reason: string) => ({ response, lessonId, reason: `Guia HERO: ${reason}` });
        if (p.type === M.SELECT_EFFECTYN && p.controller === ctx.me) {
            const value = this.effect(p, ctx);
            if (value)
                return answer({ type: R.SELECT_EFFECTYN, yes: value.score > 0 }, value.lessonId, value.reason);
        }
        if (p.type !== M.SELECT_CARD && p.type !== M.SELECT_UNSELECT_CARD)
            return null;
        if (!code || ![C.draw, C.danger, C.dyna, C.dyst, C.poly, C.mist, C.blaze, C.mask, C.over, C.cubed, C.cel, C.plasma, C.wonder, C.decim, C.dusk, C.dragoon].includes(code))
            return null;
        const cards = p.type === M.SELECT_CARD ? p.selects : p.select_cards;
        if (!cards.length)
            return null;
        if (p.type === M.SELECT_UNSELECT_CARD && p.can_finish)
            return answer({ type: R.SELECT_UNSELECT_CARD, index: null }, 'dystopia', 'parar no mínimo legal de materiais');
        const hand = (c: number) => mine.hand.some(x => x.code === c);
        const rank = (c: OcgCardLoc): number => {
            if (code === C.dusk) return c.controller === ctx.me ? 20000 + (ctx.cardDb.get(c.code)?.atk ?? 0) : 0;
            if ((code === C.decim || code === C.wonder) && c.location === L.MZONE && c.controller === ctx.me)
                return [C.dyst, C.law, C.plasma].includes(c.code) ? -20000 : 10000 - (ctx.cardDb.get(c.code)?.atk ?? 0);
            if (c.controller !== ctx.me) {
                const target = b.players[c.controller].monsters[c.sequence] ?? b.players[c.controller].spells[c.sequence];
                return 20000 + (target ? threatOf(target, ctx.cardDb) : 0);
            }
            if (c.location === L.EXTRA) {
                if (c.code === C.law)
                    return 19000;
                if (c.code === C.dragoon && hand(C.plasma) && hand(C.dogma))
                    return 18500;
                if (c.code === C.dyst)
                    return 17000;
                if (c.code === C.danger)
                    return 16000;
                return c.code === C.dusk ? 100 : 500;
            }
            if (c.location === L.DECK) {
                if (code === C.blaze)
                    return c.code === C.mist ? 19000 : 0;
                if (code === C.danger)
                    return c.code === C.mal && this.remaining(C.mal, ctx) > 1 ? 19000 : c.code === C.dyna ? 17000 : 0;
                if (code === C.mist)
                    return c.code === C.mask ? 20000 : c.code === C.drill ? 18500 : c.code === C.blaze && !hand(C.poly) ? 18000 : 100;
                return c.code === C.mal ? 18000 : 1000;
            }
            if (c.location === L.GRAVE) {
                if (code === C.dyst)
                    return ctx.cardDb.get(c.code)?.atk ?? 0;
                if (code === C.over)
                    return ctx.cardDb.get(c.code)?.level ?? 0;
                if (code === C.wonder)
                    return c.code === C.mask ? hand(C.poly) ? 18000 : 16000 : 19000;
                return c.code === C.mal && this.remaining(C.mal, ctx) > 0 ? -15000 : c.code === C.dyna ? -13000 : 1000;
            }
            if (code === C.mask)
                return c.code === C.mist ? 18000 : c.code === C.plasma ? -18000 : 1000;
            if (code === C.dyna)
                return c.code === C.dyst ? 19000 : 1000;
            if (code === C.dyst || code === C.plasma || code === C.dragoon)
                return -20000;
            if (code === C.poly)
                return c.code === C.mal && this.remaining(C.mal, ctx) > 0 ? 18000 : c.code === C.dyna ? 17000 : c.code === C.cel ? 16000 : c.code === C.mist ? 15000 : c.code === C.plasma ? -12000 : 1000;
            return c.code === C.mal && this.remaining(C.mal, ctx) > 0 ? 18000 : c.code === C.dyna ? 17000 : c.code === C.eternal ? 15000 : c.code === C.clock ? 14000 : c.code === C.plasma ? -20000 : 100;
        };
        const indices = cards.map((c, i) => ({ i, value: rank(c) })).sort((a, b) => b.value - a.value).map(c => c.i);
        const lessonId = code === C.draw ? lessons.draw : code === C.danger ? lessons.danger : code === C.dyna || code === C.dyst ? lessons.dyna : code === C.over ? lessons.over : code === C.wonder ? lessons.wonder : code === C.blaze ? lessons.blaze : code === C.cel ? lessons.cel : 'dystopia';
        return answer(p.type === M.SELECT_CARD ? { type: R.SELECT_CARD, indicies: indices.slice(0, code === C.cubed && hand(C.plasma) && cards.every(c => c.location === L.HAND) ? Math.min(p.max, 3 - mine.monsters.filter(Boolean).length) : p.min) } : { type: R.SELECT_UNSELECT_CARD, index: indices[0] }, lessonId, 'escolher recurso e alvo pelo efeito em resolução');
    }
    record(ctx: BotContext, r: OcgResponse) {
        const p = ctx.prompt;
        if (p.type === M.SELECT_IDLECMD && r.type === R.SELECT_IDLECMD) {
            this.active = r.index === null ? null : r.action === A.SELECT_ACTIVATE ? p.activates[r.index] : r.action === A.SELECT_SPECIAL_SUMMON ? p.special_summons[r.index] : null;
        }
        if (p.type === M.SELECT_CHAIN && r.type === R.SELECT_CHAIN && r.index !== null)
            this.active = p.selects[r.index];
        if (p.type === M.SELECT_EFFECTYN && r.type === R.SELECT_EFFECTYN && r.yes)
            this.active = p;
    }
}
