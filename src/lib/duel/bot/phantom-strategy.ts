import { OcgLocation as L, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A, type OcgCardLoc, type OcgResponse } from '@n1xx1/ocgcore-wasm';
import type { BotContext } from '@/lib/duel/bot/bot-brain';
import type { DuelDeckPayload } from '@/lib/types';
import type { BoardPlayer } from '@/lib/duel/board-state';
import { threatOf } from '@/lib/duel/bot/combat';
import { pointedZones } from '@/lib/duel/link-geometry';
const C = { cloak: 90432163, boots: 36426778, gloves: 63821877, helm: 99315585, armor: 36704180, sword: 62709239, rusty: 26692769, fog: 25542642, wing: 98431356, blade: 61936647, rebellion: 16195942, requiem: 1621413, launch: 3298689, leviair: 95992081, shade: 98827725, arma: 28985331, nightmare: 359563, ferret: 56343672, foolish: 81439173, reborn: 83764718, hole: 53129443, twin: 43898403, spear: 98153934, vambrace: 36247316, javelin: 12219047, forward: 56410040, kage: 19353570, dante: 83531441 };
const ID = { sword: 'espada-quebrada-abre-o-classe-4', requiem: 'rebeliao-sem-materiais-vira-requiem', rusty: 'a-seta-de-bardiche-transforma-xyz-em-remocao', gloves: 'ragged-gloves-prepara-a-armadilha-certa', shade: 'brigandina-antes-das-armadilhas-no-cemiterio', atk: 'luvas-concede-mil-ao-xyz-de-trevas', ferret: 'furao-usa-as-duas-setas', reload: 'launch-no-cemiterio-recarrega-o-xyz', fog: 'fog-blade-tem-duas-funcoes-em-turnos-diferentes', javelin: 'bracadeira-abre-dardo-amaldicoado' };
type Effect = OcgCardLoc & {
    description?: bigint;
    overlay_sequence?: number;
};
interface Rating {
    score: number;
    lessonId: string;
    reason: string;
}
const has = (p: BoardPlayer, code: number) => p.hand.some(c => c.code === code);
const field = (p: BoardPlayer, code: number) => p.monsters.find(c => c?.code === code && !c.faceDown && !c.negated);
const pk = (code: number) => [C.cloak, C.boots, C.gloves, C.helm, C.armor].includes(code);
const indexOf = (c: Effect) => c.description !== undefined && c.description >= 0x100000n ? Number(c.description - (BigInt(c.code) << 20n)) : 0;
const rate = (score: number, lessonId: string, reason: string): Rating => ({ score, lessonId, reason: `Guia Cavaleiros Fantasmas: ${reason}` });
/** Signature-gated policy; uses public zones, its own hand and legal engine candidates. */
export class PhantomStrategy {
    private active: Effect | null = null;
    private deck: DuelDeckPayload;
    private pendingSword = false;
    private properSword: number | null = null;
    private sync(ctx: BotContext) { const sword = ctx.readBoard(true).players[ctx.me].monsters.find(c => c?.code === C.sword); if (!sword && this.pendingSword && ctx.prompt.type === M.SELECT_IDLECMD) this.pendingSword=false;
        if (!sword && !this.pendingSword)
        this.properSword = null; if (sword && this.pendingSword) {
        this.properSword = sword.sequence;
        this.pendingSword = false;
    } if (ctx.retryCount)
        this.pendingSword = false; }
    constructor(deck: DuelDeckPayload) { this.deck = deck; }
    private remaining(code: number, p: BoardPlayer) { return this.deck.main.filter(c => c === code).length - [...p.hand, ...p.grave, ...p.banished, ...p.monsters, ...p.spells].filter(c => c?.code === code).length - p.monsters.reduce((n, c) => n + (c?.overlays.filter(x => x === code).length ?? 0), 0); }
    private recovery(p: BoardPlayer, ctx: BotContext) { const sword = field(p, C.sword); if (sword && this.properSword !== sword.sequence)
        return false; const codes = [...p.grave.map(c => c.code), ...(sword?.overlays ?? [])].filter((c): c is number => c !== null && pk(c)); return codes.some((c, i) => codes.some((d, j) => j !== i && ctx.cardDb.get(c)?.level === ctx.cardDb.get(d)?.level)); }
    private arrows(ctx: BotContext) { const p = ctx.readBoard(true).players[ctx.me]; return [...new Set(p.monsters.flatMap(c => c?.link && !c.faceDown ? pointedZones({ controller: ctx.me, sequence: c.sequence }, c.link.markers).filter(z => z.controller === ctx.me && z.sequence < 5 && !p.monsters[z.sequence]).map(z => z.sequence) : []))]; }
    effect(c: Effect, ctx: BotContext): Rating | null {
        this.sync(ctx);
        const b = ctx.readBoard(true), p = b.players[ctx.me], foe = b.players[1 - ctx.me], i = indexOf(c);
        const enemies = [...foe.monsters, ...foe.spells, foe.field].filter(c => c !== null);
        const recoverable = p.grave.some(c => c.code !== null && pk(c.code));
        const ownMain = ctx.turnPlayer === ctx.me;
        switch (c.code) {
            case 32807846: return rate(195, 'primeiro-xyz', 'buscar a extensão antes de comprometer a Normal');
            case C.sword: return rate(c.location === L.GRAVE ? 170 : enemies.length && this.recovery(p, ctx) ? 195 : -1, ID.sword, 'converter autodestruição em dois Níveis 4; preservar o Xyz sem retorno');
            case C.rusty: return rate(i === 0 ? 180 : enemies.length || field(p, C.sword) && this.recovery(p, ctx) ? 200 : -1, ID.rusty, 'preparar Cemitério e Armadilha; usar a seta por remoção ou recuperação real');
            case C.cloak: return rate(c.location === L.GRAVE ? field(p, C.sword) && this.recovery(p, ctx) && enemies.length ? -1 : has(p, C.boots) && p.monsters.some(Boolean) ? 85 : 150 : -1, 'leviair', 'buscar sem consumir o par necessário à reanimação');
            case C.boots: return rate(c.location === L.GRAVE ? field(p, C.sword) && this.recovery(p, ctx) && enemies.length ? -1 : 160 : 100, 'rusty-bardiche', 'converter material desassociado em interação ou Launch');
            case C.gloves: return rate(c.location === L.GRAVE ? field(p, C.sword) && this.recovery(p, ctx) && enemies.length ? -1 : 145 : 130, ID.gloves, 'enviar a carta que falta, preservando o par da Espada');
            case C.foolish:
            case C.arma: return rate(155, ID.gloves, 'enviar Manto para acesso ou Luvas para preparar Armadilha');
            case C.rebellion: return rate(foe.monsters.some(c => c && !c.faceDown && (c.attack ?? 0) > 0) ? has(p, C.launch) ? 190 : 140 : -1, ID.requiem, 'gastar dois materiais com ganho e habilitar Launch');
            case C.launch:
                if (c.location !== L.GRAVE)
                    return rate(field(p, C.rebellion)?.overlays.length === 0 ? 210 : field(p, C.sword)?.overlays.length === 0 ? 110 : -1, ID.requiem, 'subir um Xyz sem materiais e preservar Rebelião sob Réquiem');
                return rate((field(p, C.requiem)?.overlays.length ?? 99) <= 1 || (field(p, C.nightmare)?.overlays.length ?? 99) <= 2 && foe.monsters.some(Boolean) ? 125 : -1, ID.reload, 'recarregar negações sem impedir uma subida imediata de Classe');
            case C.requiem: return rate(i === 1 ? 230 : ownMain && foe.monsters.some(c => c && !c.faceDown && (c.attack ?? 0) > 0) ? 185 : -1, ID.requiem, 'preservar Rebelião como material ao negar ou zerar ATK');
            case C.nightmare: return rate(170, ID.shade, 'virar monstros da Invocação adversária quando o motor oferece o gatilho');
            case C.javelin: return rate(foe.monsters.some(c => c && !c.faceDown && !c.negated) ? 170 : -1, ID.javelin, 'zerar ATK e negar uma ameaça real');
            case C.shade: return rate(170, ID.shade, 'resolver Brigandina antes de mandar Armadilhas ao Cemitério');
            case C.ferret: return rate(this.arrows(ctx).length >= 2 && this.remaining(C.cloak,p)>0 && this.remaining(C.boots,p)>0 ? 190 : -1, ID.ferret, 'reservar duas setas e escolher dois Níveis 3 que somam seis');
            case C.vambrace: return rate(p.monsters.some(c => c && !c.faceDown && (c.level ?? 0) > 0) && p.monsters.filter(Boolean).length <= 3 ? 155 : !ownMain && foe.monsters.some(Boolean) ? 110 : -1, ID.javelin, 'ajustar um Nível para abrir Classe 2 ou reduzir pressão');
            case C.fog:
            case C.wing:
            case C.blade:
                if (c.location === L.GRAVE)
                    return rate(recoverable ? 165 : -1, ID.fog, 'reanimar antes de banir o alvo por uma busca; depois converter em Xyz');
                if (c.code === C.fog)
                    return rate(!ownMain && foe.monsters.some(c => c && !c.faceDown && !c.negated) ? 170 : ownMain && foe.monsters.some(c => c && !c.faceDown && !c.negated && (c.attack ?? 0) >= Math.max(0, ...p.monsters.map(c => c?.attack ?? 0))) ? 135 : -1, ID.fog, 'negar a ameaça sem impedir um ataque favorável sem necessidade');
                return null;
            case C.leviair: return rate(p.banished.some(c => c.code !== null && (ctx.cardDb.get(c.code)?.level ?? 99) <= 4 && ((ctx.cardDb.get(c.code)?.type ?? 0) & 1) !== 0) ? 170 : -1, 'leviair', 'recuperar banido e desassociar Botas para buscar');
            default: return null;
        }
    }
    idle(action: number, c: Effect, ctx: BotContext): Rating | null {
        this.sync(ctx);
        if (action === A.SELECT_ACTIVATE)
            return this.effect(c, ctx);
        const p = ctx.readBoard(true).players[ctx.me], foe = ctx.readBoard(true).players[1 - ctx.me];
        if (action === A.SELECT_MONSTER_SET && c.code === C.ferret)
            return rate(-1, ID.ferret, 'preservar Furão para uma resolução com setas livres');
        if (action === A.SELECT_SUMMON) {
            if (c.code === C.ferret)
                return rate(this.arrows(ctx).length >= 2 && this.remaining(C.cloak,p)>0 && this.remaining(C.boots,p)>0 ? 185 : -1, ID.ferret, 'usar Furão somente com setas livres e soma viável');
            if ([C.cloak, C.gloves, C.boots].includes(c.code))
                return rate(has(p, C.boots) && c.code !== C.boots ? 170 : has(p, C.kage) ? 170 : 95, 'primeiro-xyz', 'começar pelo Cavaleiro que habilita a extensão');
            if (c.code === C.arma)
                return rate(has(p, C.shade) ? 180 : 135, ID.shade, 'formar par de Nível 4 e preparar Cemitério');
        }
        if (action === A.SELECT_SPELL_SET && c.code === C.shade)
            return rate(!p.grave.some(c => ((ctx.cardDb.get(c.code ?? 0)?.type ?? 0) & 4) !== 0) ? 190 : 70, ID.shade, 'Baixar Brigandina antes de um envio de Armadilha');
        if (action === A.SELECT_SPECIAL_SUMMON) {
            if (c.code === C.rusty)
                return rate(185, 'rusty-bardiche', 'converter TREVAS em acesso a recursos e setas');
            if (c.code === C.requiem)
                return rate(-1, ID.requiem, 'preferir Launch com Rebelião como material à receita de três Níveis 5');
            if (c.code === C.rebellion)
                return rate(has(p, C.launch) || foe.monsters.some(c => c && !c.faceDown && (c.attack ?? 0) >= 2000) ? 185 : 90, ID.requiem, 'escolher pressão e acesso ao chefe pelo estado adversário');
            if (c.code === C.nightmare)
                return rate(175, ID.shade, 'escolher interrupção quando não há alvo de pressão');
            if (c.code === C.javelin)
                return rate(180, ID.javelin, 'transformar dois Níveis 2 em interação');
            if (c.code === C.sword)
                return rate(field(p, C.rusty) && p.monsters.filter(c => c?.code !== null && c && pk(c.code)).length >= 2 ? 205 : foe.monsters.some(Boolean) ? 185 : 135, ID.sword, 'remover com continuação ou preservar o corpo de Classe 3');
            if (c.code === C.leviair)
                return rate(p.banished.some(c => c.code !== null && (ctx.cardDb.get(c.code)?.level ?? 99) <= 4 && ((ctx.cardDb.get(c.code)?.type ?? 0) & 1) !== 0) ? 190 : -1, 'leviair', 'recuperar o banido antes de qualquer bloqueio TREVAS');
            if (c.code === C.forward)
                return rate(180, 'primeiro-xyz', 'colocar o corpo de campo vazio antes da Normal');
        }
        return null;
    }
    respond(ctx: BotContext): {
        response: OcgResponse;
        lessonId: string;
        reason: string;
    } | null {
        this.sync(ctx);
        const prompt = ctx.prompt, b = ctx.readBoard(true), p = b.players[ctx.me], foe = b.players[1 - ctx.me];
        const effect = ctx.resolvingEffect ? ctx.resolvingEffect.player === ctx.me ? ctx.resolvingEffect : null : this.active;
        const code = effect?.code;
        const answer = (response: OcgResponse, lessonId: string, reason: string) => ({ response, lessonId, reason: `Guia Cavaleiros Fantasmas: ${reason}` });
        if (prompt.type === M.SELECT_EFFECTYN && prompt.controller === ctx.me) {
            const value = this.effect(prompt, ctx);
            if (value)
                return answer({ type: R.SELECT_EFFECTYN, yes: value.score > 0 }, value.lessonId, value.reason);
        }
        if (prompt.type === M.SELECT_PLACE && prompt.count === 1) {
            const free = this.arrows(ctx);
            const preferred = code === C.ferret && prompt.field_mask !== undefined ? [1, 3, 4, 0, 2].filter(z => !free.includes(z)) : free;
            const zone = preferred.find(z => (prompt.field_mask & (1 << z)) === 0);
            if (zone !== undefined && (code === C.ferret || [C.sword, C.rebellion, C.nightmare, C.requiem].includes(code ?? 0)))
                return answer({ type: R.SELECT_PLACE, places: [{ player: ctx.me, location: L.MZONE, sequence: zone }] }, ID.rusty, 'reservar as setas e invocar Xyz TREVAS na zona apontada');
        }
        if (prompt.type === M.SELECT_SUM && code === C.ferret) {
            const cloak = prompt.selects.findIndex(c => c.code === C.cloak), boots = prompt.selects.findIndex(c => c.code === C.boots);
            if (cloak >= 0 && boots >= 0 && prompt.amount === 6 && !prompt.selects_must.length)
                return answer({ type: R.SELECT_SUM, indicies: [cloak, boots] }, ID.ferret, 'escolher dois Níveis 3; não adivinhar a soma por quantidade');
        }
        if (prompt.type !== M.SELECT_CARD && prompt.type !== M.SELECT_UNSELECT_CARD)
            return null;
        if (!code || ![C.cloak, C.boots, C.gloves, C.sword, C.rusty, C.launch, C.rebellion, C.requiem, C.fog, C.wing, C.blade, C.ferret, C.arma, C.foolish, C.nightmare, C.javelin, C.leviair, C.vambrace, C.twin].includes(code))
            return null;
        const cards = prompt.type === M.SELECT_CARD ? prompt.selects : prompt.select_cards;
        if (!cards.length)
            return null;
        if (prompt.type === M.SELECT_UNSELECT_CARD && prompt.can_finish)
            return answer({ type: R.SELECT_UNSELECT_CARD, index: null }, ID.sword, 'usar o mínimo de materiais necessário');
        const rank = (c: Effect) => {
            if (c.overlay_sequence !== undefined)
                return c.code === C.rebellion ? -30000 : c.code === C.boots ? 22000 : c.code === C.cloak ? 15000 : 20000;
            if (code === C.vambrace && c.controller === ctx.me)
                return (c.location === L.MZONE && (p.monsters.filter(Boolean).length === 1) && (c.location === L.MZONE) && (ctx.cardDb.get(c.code)?.level ?? 0) > 0) ? 25000 : 0;
            if (c.controller !== ctx.me) {
                const target = foe.monsters[c.sequence] ?? foe.spells[c.sequence];
                return 20000 + (target ? threatOf(target, ctx.cardDb) : 0);
            }
            if (c.location === L.EXTRA)
                return c.code === C.requiem ? 20000 : 0;
            if (c.location === L.DECK) {
                if (code === C.boots)
                    return c.code === C.launch && field(p, C.rebellion) && !has(p, C.launch) ? 21000 : c.code === C.fog && !has(p, C.fog) && !p.spells.some(c => c?.code === C.fog) ? 20000 : c.code === C.wing ? 18000 : 100;
                if (code === C.cloak)
                    return c.code === C.boots ? 20000 : c.code === C.gloves ? 17000 : 100;
                if (code === C.gloves)
                    return c.code === C.fog && p.grave.some(c => c.code !== null && pk(c.code)) ? 21000 : c.code === C.cloak ? 19000 : c.code === C.wing ? 17000 : 0;
                if (code === C.arma || code === C.foolish)
                    return c.code === C.cloak ? 20000 : c.code === C.gloves ? 18000 : 100;
                if (code === C.rusty) {
                    if (((ctx.cardDb.get(c.code)?.type ?? 0) & 1) !== 0)
                        return c.code === C.gloves ? 20000 : c.code === C.cloak ? 18000 : 100;
                    return c.code === C.fog ? 20000 : c.code === C.shade ? 15000 : 100;
                }
                return c.code === C.cloak || c.code === C.boots ? 20000 : 100;
            }
            if (code === C.requiem && c.location === L.GRAVE)
                return c.code === C.sword ? 19000 : 100;
            if (code === C.rusty || code === C.sword) {
                if (c.code === C.sword && c.location === L.MZONE)
                    return this.recovery(p, ctx) ? 19000 : -20000;
                if (c.location === L.GRAVE)
                    return pk(c.code) ? 18000 : 0;
                return -20000;
            }
            if (code === C.launch && c.location === L.MZONE)
                return c.code === C.rebellion ? 20000 : c.code === C.requiem ? 19000 : c.code === C.nightmare ? 18000 : 100;
            if (code === C.launch && c.location === L.HAND)
                return c.code === C.boots ? 18000 : pk(c.code) ? 17000 : 0;
            if (code === C.leviair && c.location === L.REMOVED)
                return c.code === C.cloak ? 20000 : 18000;
            if ([C.fog, C.wing, C.blade].includes(code) && c.location === L.GRAVE)
                return c.code === C.cloak && has(p, C.boots) ? 20000 : c.code === C.gloves ? 19000 : pk(c.code) ? 18000 : 100;
            if ([C.sword, C.rebellion, C.nightmare, C.javelin].includes(code) && c.location === L.MZONE)
                return [C.rusty, C.requiem, C.rebellion].includes(c.code) ? -20000 : c.code === C.gloves ? 18000 : c.code === C.boots ? 17000 : 16000;
            if (code === C.twin && c.location === L.HAND)
                return c.code === C.cloak || c.code === C.launch ? 19000 : c.code === C.gloves ? 18000 : 0;
            return 0;
        };
        const ranked = cards.map((c, i) => ({ i, value: rank(c) })).sort((a, b) => b.value - a.value);
        const lessonId = code === C.requiem || code === C.rebellion || code === C.launch ? ID.requiem : code === C.rusty ? ID.rusty : code === C.ferret ? ID.ferret : code === C.javelin || code === C.vambrace ? ID.javelin : code === C.fog ? ID.fog : code === C.gloves ? ID.gloves : code === C.leviair ? 'leviair' : code === C.sword ? ID.sword : 'rusty-bardiche';
        const count = prompt.type === M.SELECT_CARD ? (code === C.twin && cards.every(c => c.controller !== ctx.me) ? Math.min(prompt.max, ranked.length) : prompt.min) : 1;
        return answer(prompt.type === M.SELECT_CARD ? { type: R.SELECT_CARD, indicies: ranked.slice(0, count).map(x => x.i) } : { type: R.SELECT_UNSELECT_CARD, index: ranked[0].i }, lessonId, 'preservar Rebelião, pagar o material que gera recurso e escolher a ameaça adversária');
    }
    record(ctx: BotContext, r: OcgResponse) {
        this.sync(ctx);
        const p = ctx.prompt;
        if (p.type === M.SELECT_IDLECMD && r.type === R.SELECT_IDLECMD && r.action === A.SELECT_SPECIAL_SUMMON && r.index !== null && p.special_summons[r.index]?.code === C.sword && p.special_summons[r.index]?.location === L.EXTRA)
            this.pendingSword = true;
        if (p.type === M.SELECT_IDLECMD && r.type === R.SELECT_IDLECMD)
            this.active = r.index === null ? null : r.action === A.SELECT_ACTIVATE ? p.activates[r.index] : r.action === A.SELECT_SPECIAL_SUMMON ? p.special_summons[r.index] : r.action === A.SELECT_SUMMON ? p.summons[r.index] : null;
        if (p.type === M.SELECT_CHAIN && r.type === R.SELECT_CHAIN && r.index !== null)
            this.active = p.selects[r.index];
        if (p.type === M.SELECT_EFFECTYN && r.type === R.SELECT_EFFECTYN && r.yes)
            this.active = p;
    }
}
