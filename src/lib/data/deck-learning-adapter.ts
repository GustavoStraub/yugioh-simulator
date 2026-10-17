import { OcgType } from "@n1xx1/ocgcore-wasm";

import cardRows from "@/data/card-db.json";
import { OfficialCardDb } from "@/lib/duel/official-card-data";
import base from "@/data/deck-learning-base.json";
import type { DeckGuide, GuideLesson } from "@/lib/domain/deck-guide";

type EditorialDeck = typeof base.decks[number];

// Este adaptador é consumido pelas rotas no servidor; o seletor usa apenas o índice leve.
const cardDb = new OfficialCardDb(cardRows);
const SUMMON_TYPES = [
  [OcgType.FUSION, "Fusão"],
  [OcgType.SYNCHRO, "Sincro"],
  [OcgType.XYZ, "Xyz"],
  [OcgType.LINK, "Link"],
  [OcgType.RITUAL, "Ritual"],
  [OcgType.PENDULUM, "Pêndulo"],
] as const;

function snapshotTags(deck: EditorialDeck): string[] {
  const codes = [...deck.deckSnapshot.main, ...deck.deckSnapshot.extra, ...deck.deckSnapshot.side];
  const combinedTypes = codes.reduce((types, code) => types | (cardDb.get(code)?.type ?? 0), 0);
  return SUMMON_TYPES.filter(([type]) => (combinedTypes & type) !== 0).map(([, label]) => label);
}

/** Adapta apenas conteúdo editorial; prática executável vem dos guias históricos. */
function strategyLesson(lesson: EditorialDeck["lessons"][number]): GuideLesson {
  return {
    id: lesson.id, title: lesson.title, summary: lesson.scenario ?? lesson.summary ?? "",
    minutes: Math.max(2, lesson.steps.length + 1), sourceIds: lesson.sourceIds,
    preparation: lesson.scenario ? [lesson.scenario] : ("preparation" in lesson ? lesson.preparation ?? [] : []), startingHand: null, practice: null,
    steps: lesson.steps.map((step, index) => ({ title: `Etapa ${index + 1}`, action: step.action, why: "", cardCodes: step.cardCodes })),
    outcome: lesson.outcome, cautions: lesson.cautions,
  };
}

export function adaptLearningBase(historical: readonly DeckGuide[]): DeckGuide[] {
  const adapt = (deck: EditorialDeck): DeckGuide => {
    const previous = historical.find((guide) => guide.presetId === deck.presetId);
    const lessons = [...(previous?.lessons ?? []), ...deck.lessons.filter((lesson) => !("origin" in lesson)).map(strategyLesson)];
    const sourceIds = new Set([...deck.coreCards.flatMap((card) => card.sourceIds), ...lessons.flatMap((lesson) => lesson.sourceIds)]);
    const sources = [...(previous?.sources ?? []), ...base.sources.filter((source) => sourceIds.has(source.id)).map(({ id, title, url }) => ({ id, title, url }))];
    return {
      schemaVersion: 1, id: previous?.id ?? deck.id, presetId: deck.presetId,
      revision: previous?.revision ?? 1, reviewedAt: base.reviewedAt,
      title: previous?.title ?? deck.title, subtitle: previous?.subtitle ?? "Estratégia com a lista oficial",
      description: deck.gamePlan, difficulty: previous?.difficulty ?? "Leitura de estratégia",
      minutes: lessons.reduce((total, lesson) => total + lesson.minutes, 0),
      tags: previous?.tags ?? ["Estratégia", "TCG", ...snapshotTags(deck)],
      coverCodes: previous?.coverCodes ?? deck.coreCards.slice(0, 3).map((card) => card.code),
      deckSnapshot: { ...deck.deckSnapshot, format: "tcg" },
      overview: previous ? { ...previous.overview, watchOut: [...new Set([...previous.overview.watchOut, ...deck.cautions])] } : { goal: deck.gamePlan, plan: lessons.map((lesson) => lesson.title), strengths: [], watchOut: deck.cautions },
      keyCards: [...(previous?.keyCards ?? []), ...deck.coreCards.filter((card) => !previous?.keyCards.some((item) => item.code === card.code)).map((card) => ({ code: card.code, name: card.namePt || card.name, role: "Carta-chave", explanation: "Consulte o efeito desta carta e veja seu uso nas lições.", sourceIds: card.sourceIds }))],
      lessons, sources: [...new Map(sources.map((source) => [source.id, source])).values()],
    };
  };
  const guides = base.decks.map(adapt);
  return [...historical.map((guide) => guides.find((item) => item.id === guide.id)!), ...guides.filter((guide) => !historical.some((item) => item.id === guide.id))];
}
