/** A integração da base cobre o catálogo sem perder os exercícios e o progresso existentes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECK_GUIDES, getDeckGuide, getGuideForPreset } from '@/lib/data/deck-guides';
import { getGuideForPreset as getGuideRoute } from '@/lib/data/deck-guide-index';
import { hasLessonPractice, guideProgressKey, matchesGuideDeck, parseGuideProgress } from '@/lib/domain/deck-guide';
import { getPresetDeck } from '@/lib/data/preset-decks-catalog';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const base = read('src/data/deck-learning-base.json');
const presets = read('src/data/preset-decks-tcg.json');
const authoredDecisions = read('src/data/guide-decisions.json');
const authoredCardNotes = read('src/data/guide-card-notes.json');
const selected = base.coverage.filter(item => item.status === 'selected').map(item => item.presetId);
const excluded = base.coverage.filter(item => item.status === 'excluded').map(item => item.presetId);
assert.equal(new Set(base.coverage.map(item => item.presetId)).size, presets.length);
assert.deepEqual(new Set(base.coverage.map(item => item.presetId)), new Set(presets.map(item => item.id)));
assert.deepEqual(new Set(DECK_GUIDES.map(guide => guide.presetId)), new Set(selected));
assert.equal(DECK_GUIDES.length, 92);
assert.equal(new Set(DECK_GUIDES.map(guide => guide.id)).size, DECK_GUIDES.length);
assert.equal(DECK_GUIDES.flatMap(guide => guide.lessons).length, 208);
assert.equal(DECK_GUIDES.flatMap(guide => guide.lessons).filter(hasLessonPractice).length, 12);
assert.equal(DECK_GUIDES.flatMap(guide => guide.lessons).filter(lesson => !hasLessonPractice(lesson)).length, 196);
for (const [id, tag] of [['tcg-sdgr', 'Xyz'], ['tcg-sr13', 'Fusão'], ['tcg-l26d-mitsurugi', 'Ritual'], ['tcg-sdpd', 'Pêndulo']]) {
  assert.ok(getDeckGuide(id).tags.includes(tag), `mecânica pesquisável derivada das cartas: ${id}/${tag}`);
}
for (const id of [...excluded, 'missing', '__proto__', 'toString', 'constructor']) {
  assert.equal(getGuideForPreset(id), undefined, `exclusão editorial respeitada: ${id}`);
  assert.equal(getGuideRoute(id), undefined, `índice leve sem rota indevida: ${id}`);
}

for (const id of ['albaz-strike', 'herois-lendarios-aesir', 'herois-lendarios-destiny-hero', 'herois-lendarios-cavaleiros-fantasmas']) {
  const previous = read(`src/data/deck-guides/${id}.json`);
  const guide = getDeckGuide(id);
  assert.ok(guide, `URL histórica continua válida: ${id}`);
  assert.equal(guide.revision, previous.revision, 'conteúdo prático original mantém sua revisão de progresso');
  assert.equal(guideProgressKey('existing-player', guide), guideProgressKey('existing-player', previous));
  assert.equal(guide.lessons.length, 8);
  assert.deepEqual(guide.overview.plan, previous.overview.plan, 'o aprofundamento preserva o plano anterior');
  assert.deepEqual(guide.overview.strengths, previous.overview.strengths, 'o aprofundamento preserva as vantagens explicadas');
  for (const card of previous.keyCards) {
    const current = guide.keyCards.find(item => item.code === card.code);
    assert.equal(current?.role, card.role);
    assert.equal(current?.explanation, card.explanation, 'cartas antigas preservam explicações editoriais específicas');
  }
  for (const lesson of previous.lessons) {
    const current = guide.lessons.find(item => item.id === lesson.id);
    assert.ok(current && hasLessonPractice(current));
    assert.deepEqual(current.startingHand, lesson.startingHand);
    assert.deepEqual(current.practice, lesson.practice);
    assert.deepEqual(current.steps, lesson.steps);
  }
  const progress = { currentLesson: previous.lessons[2].id, completed: previous.lessons.map(lesson => lesson.id) };
  assert.deepEqual(parseGuideProgress(JSON.stringify(progress), guide), progress, 'três conclusões antigas sobrevivem às cinco aulas novas');
}

for (const guide of DECK_GUIDES) {
  const preset = getPresetDeck(guide.presetId);
  assert.equal(preset.format, 'tcg');
  assert.equal(getGuideForPreset(preset.id)?.id, guide.id);
  assert.equal(getGuideRoute(preset.id)?.id, guide.id, 'índice leve e registro completo apontam para a mesma URL');
  assert.equal(getDeckGuide(guide.id), guide);
  assert.ok(matchesGuideDeck(guide, preset));
  const allowed = new Set([...preset.main, ...preset.extra, ...preset.side]);
  const sourceIds = new Set(guide.sources.map(source => source.id));
  assert.ok(guide.title && guide.description && guide.overview.goal && guide.tags.length);
  assert.ok(guide.coverCodes.length > 0 && guide.coverCodes.every(code => allowed.has(code)));
  assert.ok(guide.keyCards.length > 0);
  for (const lesson of guide.lessons) {
    assert.ok(lesson.id && lesson.title && lesson.summary && lesson.outcome);
    assert.ok(lesson.minutes > 0 && lesson.preparation.length && lesson.steps.length);
    assert.ok(lesson.sourceIds.length && lesson.sourceIds.every(id => sourceIds.has(id)));
    for (const step of lesson.steps) {
      assert.ok(step.title && step.action);
      assert.ok(step.cardCodes.every(code => allowed.has(code)));
    }
    if (!hasLessonPractice(lesson)) {
      assert.equal(lesson.practice, null);
      assert.equal(lesson.startingHand, null);
    }
  }
  for (const decision of guide.decisions ?? []) {
    assert.ok(guide.lessons.some(lesson => lesson.id === decision.lessonId), `decisão aponta para lição real: ${decision.id}`);
    assert.ok(decision.title && decision.situation && decision.signals.length);
    assert.ok(decision.choices.length >= 2 && decision.correctChoice >= 0 && decision.correctChoice < decision.choices.length);
    assert.ok(decision.sourceIds.length && decision.sourceIds.every(id => sourceIds.has(id)), `fontes da decisão: ${decision.id}`);
    for (const signal of decision.signals) {
      if ('code' in signal) assert.ok(allowed.has(signal.code), `carta da condição está no deck: ${decision.id}`);
      else assert.ok(signal.minCount !== undefined || signal.maxCount !== undefined, `contagem explícita: ${decision.id}`);
    }
    for (const choice of decision.choices) {
      assert.ok(choice.label && choice.explanation && allowed.has(choice.action.code), `ação da escolha usa carta da lista: ${decision.id}`);
      if (choice.action.targetCode) assert.ok(allowed.has(choice.action.targetCode), `alvo da escolha está no deck: ${decision.id}`);
    }
  }
}
assert.deepEqual(new Set(Object.keys(authoredDecisions)), new Set(DECK_GUIDES.filter(guide => guide.decisions?.length).map(guide => guide.presetId)));
assert.equal(DECK_GUIDES.flatMap(guide => guide.decisions ?? []).length, 21);
for (const [presetId, notes] of Object.entries(authoredCardNotes)) {
  const guide = DECK_GUIDES.find(item => item.presetId === presetId);
  assert.ok(guide, `notas ligadas a um guia: ${presetId}`);
  for (const [code, note] of Object.entries(notes)) {
    const card = guide.keyCards.find(item => item.code === Number(code));
    assert.ok(card, `nota ligada a carta-chave: ${presetId}/${code}`);
    assert.equal(card.role, note.role);
    assert.equal(card.explanation, note.explanation);
  }
}
const strategyGuide = DECK_GUIDES.find(guide => guide.id === 'tcg-sr13');
const first = strategyGuide.lessons[0];
const persisted = parseGuideProgress(JSON.stringify({
  completed: ['missing', first.id, first.id], currentLesson: first.id,
  steps: { [first.id]: 999, missing: 5, [strategyGuide.lessons[1].id]: -1 },
}), strategyGuide);
assert.deepEqual(persisted.completed, [first.id]);
assert.equal(persisted.steps[first.id], first.steps.length - 1, 'etapas persistidas são limitadas ao tamanho do roteiro');
assert.equal(persisted.steps.missing, undefined);
assert.equal(persisted.steps[strategyGuide.lessons[1].id], undefined);
for (const malformed of ['bad', ['a'], 1, null]) {
  const progress = parseGuideProgress(JSON.stringify({ currentLesson: first.id, completed: [], steps: malformed }), strategyGuide);
  assert.equal(progress.currentLesson, first.id, 'dados inválidos de etapa não apagam uma lição válida');
  assert.equal(progress.steps, undefined, 'dados inválidos não viram progresso de etapa');
}
console.log('✓ 92 guias, 208 lições e 18 exclusões integrados com listas e referências válidas');
console.log('✓ 12 práticas e progresso dos quatro guias históricos preservados; 196 estratégias sem objetivos inventados');
