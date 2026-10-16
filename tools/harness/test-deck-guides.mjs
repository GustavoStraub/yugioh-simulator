/** Guias editoriais: referências, versão da lista e sequências reais no ocgcore. */
import assert from "node:assert/strict";

import { OcgDuelMode, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A } from "@n1xx1/ocgcore-wasm";

import { DECK_GUIDES } from "@/lib/data/deck-guides";
import { getPresetDeck } from "@/lib/data/preset-decks-catalog";
import { matchesGuideDeck, parseGuideProgress, guideProgressKey } from "@/lib/domain/deck-guide";
import { advancePractice, EMPTY_PRACTICE, practiceCardTargets } from "@/lib/duel/lesson-practice";
import { deckAfterOpeningHand } from "@/lib/duel/opening-hand";
import { createDuelSession } from "@/lib/duel/duel-session";
import { readBoardState } from "@/lib/duel/board-state";
import { createDuel, STOP, Zone } from "./duel.mjs";

const unique = (values, label) => assert.equal(new Set(values).size, values.length, label);
const remove = (deck, hand) => {
  const remaining = [...deck];
  for (const code of hand) {
    const at = remaining.indexOf(code);
    assert.ok(at >= 0, `a mão usa somente as cópias existentes: ${code}`);
    remaining.splice(at, 1);
  }
  return remaining;
};

for (const guide of DECK_GUIDES) {
  assert.equal(guide.schemaVersion, 1);
  assert.ok(guide.revision >= 1);
  assert.match(guide.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  const preset = getPresetDeck(guide.presetId);
  assert.ok(preset, "o guia referencia um deck existente");
  assert.ok(matchesGuideDeck(guide, preset), "a composição continua igual à lista revisada");
  assert.equal(matchesGuideDeck(guide, { ...preset, main: [...preset.main, preset.main[0]] }), false);
  assert.equal(matchesGuideDeck(guide, { ...preset, format: "goat" }), false);
  assert.ok(matchesGuideDeck(guide, { ...preset, main: [...preset.main].reverse() }), "a ordem de armazenamento não muda a lista");
  unique(guide.lessons.map((lesson) => lesson.id), "lições únicas");
  unique(guide.sources.map((source) => source.id), "fontes únicas");
  const codes = new Set([...preset.main, ...preset.extra, ...preset.side]);
  const sources = new Set(guide.sources.map((source) => source.id));
  for (const source of guide.sources) assert.equal(new URL(source.url).protocol, "https:");
  for (const code of guide.coverCodes) assert.ok(codes.has(code));
  for (const card of guide.keyCards) {
    assert.ok(codes.has(card.code));
    for (const source of card.sourceIds) assert.ok(sources.has(source));
  }
  for (const lesson of guide.lessons) {
    assert.ok(lesson.title && lesson.outcome && lesson.steps.length > 0);
    assert.equal(lesson.startingHand.length, 5);
    remove(preset.main, lesson.startingHand);
    for (const source of lesson.sourceIds) assert.ok(sources.has(source));
    for (const step of lesson.steps) for (const code of step.cardCodes) assert.ok(codes.has(code));
    assert.ok(lesson.practice.goal.length > 0);
    assert.ok(lesson.practice.stages.length > 0);
    for (const stage of lesson.practice.stages) {
      assert.ok(stage.targets.length > 0, "etapas definem as cartas indicadas");
      for (const target of stage.targets) assert.ok(codes.has(target.code));
    }
    for (const condition of [...lesson.practice.goal, ...lesson.practice.stages.flatMap((stage) => stage.completeWhen)]) {
      if (condition.kind === "lp") assert.ok([0, 1].includes(condition.player) && condition.value >= 0);
      else assert.ok(codes.has(condition.code));
    }
    assert.throws(() => deckAfterOpeningHand(preset, [...lesson.startingHand, lesson.startingHand[0]], 5));
    assert.throws(() => deckAfterOpeningHand(preset, Array(5).fill(lesson.startingHand[0]), 5));
  }
  assert.deepEqual(parseGuideProgress("invalid", guide), { completed: [], currentLesson: null });
  assert.deepEqual(parseGuideProgress(JSON.stringify({ completed: [guide.lessons[0].id, guide.lessons[0].id, "missing", 2], currentLesson: "missing" }), guide), { completed: [guide.lessons[0].id], currentLesson: null });
  assert.notEqual(guideProgressKey("a", guide), guideProgressKey("b", guide));
  assert.notEqual(guideProgressKey("a", guide), guideProgressKey("a", { ...guide, revision: guide.revision + 1 }));
  console.log(`✓ ${guide.title}: lista, fontes, mãos, revisões e progresso válidos`);
}

const guide = DECK_GUIDES.find((item) => item.id === "albaz-strike");
const preset = getPresetDeck(guide.presetId);
const BF = 44362883, ALBAZ = 68468459, KIT = 45484331, MIRRORJADE = 44146295;
const LUBELLION = 70534340, ALBION = 87746184, MERCOURIER = 19096726, VEILER = 97268402;
const WAKING = 10813327, BACK = 59919307;

{
  const snapshot = { ...createDuelSession().getSnapshot(), promptPlayer: 0, pendingPrompt: {
    type: M.SELECT_CARD, player: 0, min: 1, max: 1, cancelable: false,
    selects: [{ code: BF, controller: 0, location: Zone.HAND, sequence: 0 }],
  } };
  const lesson = guide.lessons[0];
  assert.equal(practiceCardTargets(lesson, snapshot, EMPTY_PRACTICE).length, 1);
  for (const card of [
    { code: BF, controller: 1, location: Zone.HAND, sequence: 0 },
    { code: 0, controller: 0, location: Zone.HAND, sequence: 0 },
    { code: BF, controller: 0, location: Zone.DECK, sequence: 0 },
  ]) assert.deepEqual(practiceCardTargets(lesson, { ...snapshot, pendingPrompt: { ...snapshot.pendingPrompt, selects: [card] } }, EMPTY_PRACTICE), [], "não indica oponente, carta oculta ou zona errada");
}

for (const lesson of guide.lessons) {
  const useAlbion = lesson.id === "rota-albion";
  const useKitt = lesson.id === "encontrar-inicio";
  const firstFusion = useAlbion ? ALBION : LUBELLION;
  const moves = [
    ...(useKitt ? [{ list: "summons", code: KIT, action: A.SELECT_SUMMON }] : []),
    { list: "activates", code: BF, action: A.SELECT_ACTIVATE },
  ];
  const duel = await createDuel({
    mode: OcgDuelMode.MODE_MR5,
    decks: [remove(preset.main, lesson.startingHand), getPresetDeck("tcg-sdy").main],
    place: [
      ...lesson.startingHand.map((code) => ({ player: 0, zone: Zone.HAND, code })),
      ...preset.extra.map((code) => ({ player: 0, zone: Zone.EXTRA, code })),
    ],
  });
  let move = 0, fusion = 0, returnToBottom = false;
  let practice = EMPTY_PRACTICE;
  const initial = createDuelSession().getSnapshot();
  const trace = [];
  try {
    const outcome = duel.run((message) => {
      if (message.player !== 0) return null;
      const snapshot = { ...initial, boards: [readBoardState(duel.core, duel.handle, 0), null], turnCount: 1, turnPlayer: 0, promptPlayer: 0, pendingPrompt: message };
      practice = advancePractice(lesson, snapshot, practice);
      if (process.env.DEBUG_GUIDES) trace.push(JSON.stringify(message, (_, value) => typeof value === "bigint" ? String(value) : value));
      if (message.type === M.SELECT_IDLECMD) {
        const step = moves[move++];
        if (!step) return STOP;
        const index = message[step.list].findIndex((card) => card.code === step.code);
        assert.ok(index >= 0, `ação oferecida: ${step.code}`);
        assert.deepEqual(practiceCardTargets(lesson, snapshot, practice).map((target) => target.code), [step.code], "indica somente a carta a jogar agora");
        assert.deepEqual(practiceCardTargets(lesson, { ...snapshot, isProcessing: true }, practice), []);
        return { type: R.SELECT_IDLECMD, action: step.action, index };
      }
      if (message.type === M.SELECT_CARD) {
        const cards = message.selects;
        const extra = cards.filter((card) => card.location === Zone.EXTRA);
        let wanted;
        if (extra.length && extra.length === cards.length) {
          wanted = [fusion === 0 ? firstFusion : MIRRORJADE];
          fusion += 1;
        } else if (cards.every((card) => card.location === Zone.HAND)) {
          wanted = [returnToBottom ? BACK : WAKING];
          returnToBottom = false;
        } else if (useKitt && fusion === 0 && cards.some((card) => card.code === BF)) {
          wanted = [BF];
          returnToBottom = true;
        } else {
          wanted = fusion < 2 ? [ALBAZ, useAlbion ? VEILER : MERCOURIER] : [ALBAZ, firstFusion];
        }
        const indicies = cards.map((card, index) => wanted.includes(card.code) ? index : -1).filter((index) => index >= 0).slice(0, message.max);
        assert.ok(indicies.length >= message.min, `seleção disponível: ${wanted}`);
        const recommended = practiceCardTargets(lesson, snapshot, practice).map((target) => target.code);
        assert.ok(recommended.length > 0, "seleção tem orientação");
        assert.ok(recommended.every((code) => wanted.includes(code)), `indica as escolhas certas: ${recommended}`);
        return { type: R.SELECT_CARD, indicies };
      }
      if (message.type === M.SELECT_UNSELECT_CARD) {
        if (message.can_finish) return { type: R.SELECT_UNSELECT_CARD, index: null };
        const wanted = fusion < 2 ? [ALBAZ, useAlbion ? VEILER : MERCOURIER] : [ALBAZ, firstFusion];
        const index = message.select_cards.findIndex((card) => wanted.includes(card.code));
        assert.ok(index >= 0, `material disponível: ${wanted}`);
        return { type: R.SELECT_UNSELECT_CARD, index };
      }
      return null;
    });
    assert.equal(outcome, "STOPPED");
    assert.ok(practice.completed, "o objetivo da lição foi reconhecido");
    assert.equal(practice.reached, lesson.practice.stages.length);
    const finalSnapshot = { ...initial, boards: [readBoardState(duel.core, duel.handle, 0), null], turnCount: 1, turnPlayer: 0, promptPlayer: 0, pendingPrompt: { type: M.SELECT_IDLECMD } };
    assert.deepEqual(practiceCardTargets(lesson, finalSnapshot, practice), [], "ao concluir não sobra orientação");
    assert.equal(advancePractice(lesson, { ...finalSnapshot, isProcessing: true }, EMPTY_PRACTICE).completed, false, "não conclui antes da resolução");
    assert.equal(advancePractice(lesson, { ...finalSnapshot, turnCount: 2 }, EMPTY_PRACTICE).completed, false, "não conclui fora do turno do exercício");
    assert.equal(duel.retriesTotal, 0, "nenhuma resposta rejeitada");
    assert.deepEqual(duel.errors, [], "sem erros de script");
    assert.ok(duel.query(0, Zone.MZONE).some((card) => card?.code === MIRRORJADE), "Jadespelho no campo");
    if (useAlbion) {
      assert.ok(duel.query(0, Zone.REMOVED).some((card) => card?.code === ALBION), "Albion banido");
      assert.ok(duel.query(0, Zone.REMOVED).some((card) => card?.code === ALBAZ), "Arbaz banido");
      assert.ok(duel.query(0, Zone.HAND).some((card) => card?.code === MERCOURIER), "Mercourier preservado");
      assert.equal(duel.query(0, Zone.GRAVE).some((card) => card?.code === ALBION), false);
    } else {
      assert.ok(duel.query(0, Zone.GRAVE).some((card) => card?.code === WAKING), "o descarte foi pago");
      assert.ok(duel.query(0, Zone.EXTRA).some((card) => card?.code === LUBELLION), "Lubellion devolvido ao Extra");
    }
    if (useKitt) {
      assert.ok(duel.query(0, Zone.MZONE).some((card) => card?.code === KIT), "Kitt permanece no campo");
      assert.equal(duel.query(0, Zone.HAND).some((card) => card?.code === BACK), false, "a devolução foi paga");
    }
    console.log(`✓ ocgcore: ${lesson.title}`);
  } catch (error) {
    if (process.env.DEBUG_GUIDES) console.error(trace.join("\n"));
    throw error;
  } finally {
    duel.destroy();
  }
}

await import('./test-legendary-guides.mjs');
