import { OcgLocation as L, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A } from "@n1xx1/ocgcore-wasm";
import { resourceValue } from "./evaluator.mjs";
import { decodeFieldMask } from "../field-places.mjs";
import { knownStats, threatOf } from "./combat.mjs";
import { stepHasEffect } from "./deck-profile.mjs";
const MIRRORJADE = 44146295;
const ALBION = 87746184;
/** Escolhas de uma intenção existente, sempre reconstruídas do prompt atual. */
export function profileResponse(ctx, planner, policy) {
    const p = ctx.prompt;
    const step = planner.step;
    if (p.type === M.SELECT_IDLECMD && step?.action) {
        const index = p[step.action.kind].findIndex((c) => c.code === step.action.code);
        if (index >= 0) {
            if (!planner.recordAttempt(ctx))
                return null;
            const action = { summons: A.SELECT_SUMMON, special_summons: A.SELECT_SPECIAL_SUMMON, activates: A.SELECT_ACTIVATE }[step.action.kind];
            const card = p[step.action.kind][index];
            planner.intents.begin(card.code, planner.route, step, "description" in card ? card.description : undefined);
            planner.reason = `Executar ${step.id}; pré-condições confirmadas`;
            return { type: R.SELECT_IDLECMD, action, index };
        }
    }
    if (p.type === M.SELECT_CHAIN && step) {
        const index = p.selects.findIndex((c) => stepHasEffect(step, c.code, c.description) && c.controller === ctx.me
            && step.targets.some((t) => t.scope !== "selection" && t.code === c.code && t.location === c.location));
        if (index >= 0) {
            const card = p.selects[index];
            planner.intents.begin(card.code, planner.route, step, card.description);
            return { type: R.SELECT_CHAIN, index };
        }
        if (!p.forced && !ctx.chainOpen && p.selects.every((c) => c.controller === ctx.me)) {
            planner.reason = "Preservou a rota; gatilho opcional fora do modelo";
            return { type: R.SELECT_CHAIN, index: null };
        }
    }
    if (p.type === M.SELECT_EFFECTYN && step && stepHasEffect(step, p.code, p.description)) {
        planner.intents.begin(p.code, planner.route, step, p.description);
        return { type: R.SELECT_EFFECTYN, yes: true };
    }
    if (p.type === M.SELECT_EFFECTYN && step && p.controller === ctx.me && !ctx.chainOpen) {
        planner.reason = "Preservou a rota; efeito opcional fora do modelo";
        return { type: R.SELECT_EFFECTYN, yes: false };
    }
    if (p.type === M.SELECT_OPTION && planner.applies(ctx) && step?.options) {
        const index = p.options.findIndex((description) => step.options.includes(Number(description)));
        if (index >= 0)
            return { type: R.SELECT_OPTION, index };
    }
    // Gullveig aponta para as zonas principais 0, 1 e 2 quando ocupa a Extra 5.
    // Reservar esse espaço permite que os materiais recebam sua proteção.
    if (p.type === M.SELECT_PLACE && planner.route) {
        const places = decodeFieldMask(p.field_mask, p.player);
        places.sort((a, b) => {
            const score = (x) => x.player !== ctx.me ? -100 : x.location === L.MZONE
                ? planner.profile?.id === "herois-lendarios-aesir" ? (x.sequence === 5 ? 30 : [0, 1, 2].includes(x.sequence) ? 20 : 0)
                    : x.sequence < 5 ? 20 : 0 : [0, 4].includes(x.sequence) ? 0 : 10;
            return score(b) - score(a);
        });
        if (places.length >= Math.max(1, p.count))
            return { type: R.SELECT_PLACE, places: places.slice(0, Math.max(1, p.count)) };
    }
    const effect = ctx.resolvingEffect?.code ?? planner.intents.current()?.code;
    if (p.type === M.SELECT_CARD && effect === MIRRORJADE) {
        if (p.selects.every((c) => c.controller === ctx.me && c.location === L.EXTRA)) {
            const index = p.selects.findIndex((c) => c.code === ALBION);
            if (index >= 0)
                return { type: R.SELECT_CARD, indicies: [index] };
        }
        const targets = p.selects.map((c, index) => ({ c, index })).filter(({ c }) => c.controller !== ctx.me);
        targets.sort((a, b) => {
            const value = (c) => {
                const card = ctx.readBoard(false).players[c.controller].monsters[c.sequence];
                return card ? threatOf(card, ctx.cardDb) : 0;
            };
            return value(b.c) - value(a.c);
        });
        if (targets.length)
            return { type: R.SELECT_CARD, indicies: [targets[0].index] };
    }
    if (!planner.applies(ctx) || !step)
        return null;
    if (p.type !== M.SELECT_CARD && p.type !== M.SELECT_UNSELECT_CARD)
        return null;
    const cards = p.type === M.SELECT_CARD ? p.selects : p.select_cards;
    const ranked = cards.map((card, index) => ({ card, index, score: planner.targetScore(card, ctx) ?? -100000 }));
    // Devolução/descarte alternativo: preserve a única peça de acesso e gaste
    // uma cópia redundante quando a carta do exemplo não está disponível.
    if (step.spend && cards.every((c) => c.controller === ctx.me && c.location === L.HAND)) {
        for (const item of ranked) {
            const preferred = step.targets.some((t) => t.code === item.card.code && t.location === L.HAND);
            item.score = (preferred ? 2000 : 0) - resourceValue(item.card.code, ctx, policy.preserveResources ? planner.reserves : [], policy.preserveResources ? planner.starters : []);
        }
    }
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length)
        return null;
    if (p.type === M.SELECT_UNSELECT_CARD) {
        const required = step.spend
            ? Math.max(p.min, step.spendCount ?? step.targets.filter((target) => target.location === L.HAND && target.scope !== "action").length)
            : p.min;
        if (p.can_finish && p.unselect_cards.length >= required && (step.spend || ranked[0].score < 0)) {
            return { type: R.SELECT_UNSELECT_CARD, index: null };
        }
        if (ranked[0].score <= -100000)
            return null;
        planner.recordSpend([...p.unselect_cards, ranked[0].card], ctx);
        return { type: R.SELECT_UNSELECT_CARD, index: ranked[0].index };
    }
    const count = Math.max(p.min, Math.min(p.max, step.spendCount
        ?? new Set(ranked.filter((c) => c.score >= 100000).map((c) => c.card.code)).size));
    const selected = [];
    // Materiais diferentes antes de duplicatas; quantidades continuam sendo as
    // do prompt. O Plasma, por exemplo, exige três instâncias de D ao Cubo.
    for (const item of ranked)
        if (!selected.some((s) => s.card.code === item.card.code))
            selected.push(item);
    for (const item of ranked)
        if (!selected.includes(item))
            selected.push(item);
    const chosen = selected.slice(0, count);
    if (chosen.some((c) => c.score <= -100000))
        return null;
    planner.recordSpend(chosen.map((c) => c.card), ctx);
    planner.reason = step.spend ? "Preservou acesso e continuação ao escolher o custo da rota" : "Escolheu os recursos necessários à próxima etapa";
    return { type: R.SELECT_CARD, indicies: chosen.map((c) => c.index) };
}
/** Valor da remoção de Jadespelho, incluindo o custo e a defesa que sobra. */
export function mirrorjadeScore(ctx, policy) {
    const board = ctx.readBoard(false);
    const foes = board.players[1 - ctx.me].monsters.filter((c) => c !== null);
    if (!foes.length)
        return -1;
    const best = Math.max(...foes.map((c) => threatOf(c, ctx.cardDb)));
    if (!policy.preserveResources)
        return best >= 1000 ? 95 : 40;
    const attack = foes.reduce((sum, c) => sum + (knownStats(c)?.attack ?? 0), 0);
    if (attack >= ctx.lifePoints[ctx.me])
        return 130;
    if (ctx.turnPlayer === ctx.me)
        return best >= 2500 ? 115 : best >= 1500 ? 90 : -1;
    const relevantLink = ctx.chainPlayer !== ctx.me && ctx.chainCode !== null && ctx.chainCode !== undefined;
    return best >= 2400 || relevantLink && best >= 1700 ? 95 : -1;
}
