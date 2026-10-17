/** Matérias Xyz usam o seletor, mesmo quando o binding informa a zona do hospedeiro. */
import assert from 'node:assert/strict';
import { OcgLocation, OcgMessageType } from '@n1xx1/ocgcore-wasm';
import { buildPromptPlan } from '@/lib/duel/duel-actions';
import { needsCardPicker } from '@/lib/duel/prompt-reach';
import { getDeckGuide } from '@/lib/data/deck-guides';
import { practiceCardTargets } from '@/lib/duel/lesson-practice';
import { createDuelSession } from '@/lib/duel/duel-session';

const prompt = {
  type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, min: 1, max: 1,
  selects: [
    { code: 36426778, controller: 0, location: OcgLocation.MZONE, sequence: 0, overlay_sequence: 0 },
    { code: 63821877, controller: 0, location: OcgLocation.MZONE, sequence: 0, overlay_sequence: 1 },
  ],
};
const candidates = buildPromptPlan(prompt).selection.candidates;
assert.equal(candidates[0].overlay_sequence, 0, 'preserva índice zero da matéria');
assert.equal(candidates[1].overlay_sequence, 1, 'preserva segundo índice da matéria');
assert.equal(needsCardPicker(candidates, 0), true, 'matérias abrem o seletor de cartas');
assert.equal(needsCardPicker([{ code: 95992081, controller: 0, location: OcgLocation.MZONE, sequence: 0 }], 0), false, 'monstro no campo continua selecionável na mesa');
const lesson = getDeckGuide('herois-lendarios-cavaleiros-fantasmas').lessons.find(item => item.id === 'leviair');
const snapshot = { ...createDuelSession().getSnapshot(), promptPlayer: 0, pendingPrompt: prompt, isProcessing: false };
const materialStage = lesson.practice.stages.findIndex(stage => stage.title === "Solte o material correto");
assert.ok(materialStage >= 0, "etapa de desassociar material disponível");
const targets = practiceCardTargets(lesson, snapshot, { reached: materialStage, completed: false, ended: false });
assert.ok(candidates.some(candidate => candidate.code === 36426778 && targets.some(target => target.code === candidate.code && target.location === candidate.location)), 'Botas mantém destaque GUIA no seletor de matérias');
assert.equal(targets.some(target => target.code === 63821877), false, 'o guia não indica desassociar o material errado');
console.log('✓ Matérias Xyz abrem seletor e preservam destaque GUIA de Botas Silenciosas');
