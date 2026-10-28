import { formatOf, type DuelDeckPayload } from "@/lib/types";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";

export interface GuideSource {
  id: string;
  title: string;
  url: string;
}

interface GuideLessonContent {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  sourceIds: string[];
  preparation: string[];
  /** A mão de exemplo usa somente cartas da lista, com suas quantidades reais. */
  startingHand: number[] | null;
  steps: { title: string; action: string; why: string; cardCodes: number[] }[];
  outcome: string;
  cautions: string[];
  practice: LessonPractice | null;
}

export interface PracticeGuideLesson extends GuideLessonContent {
  startingHand: number[];
  practice: LessonPractice;
}

export interface StrategyGuideLesson extends GuideLessonContent {
  startingHand: null;
  practice: null;
}

export type GuideLesson = PracticeGuideLesson | StrategyGuideLesson;

export function hasLessonPractice(lesson: GuideLesson): lesson is PracticeGuideLesson {
  return lesson.practice !== null && lesson.startingHand !== null;
}

export type PracticeCondition =
  | { kind: "card"; zone: "field" | "monsters" | "spells" | "hand" | "grave" | "banished" | "extra"; code: number; count?: number; absent?: boolean; attack?: number }
  | { kind: "lp"; player: 0 | 1; value: number }
  | { kind: "offered"; code: number; location: number };

/** Identidade da carta indicada, sem depender da ordem ou do nome traduzido. */
export interface GuideCardTarget { code: number; location: number; controller?: number; scope?: "action" | "selection" }

export interface LessonPractice {
  goal: PracticeCondition[];
  stages: { title: string; instruction: string; why: string; targets: GuideCardTarget[]; completeWhen: PracticeCondition[] }[];
}

/** Sinais que podem ser conferidos na própria mão, nas zonas públicas ou na lista do deck. */
export type GuideDecisionSignal =
  | { zone: "hand" | "grave" | "monsters" | "main-monsters" | "extra" | "deck"; code: number; present: boolean }
  | { zone: "own-hand" | "own-monsters" | "opponent-monsters" | "own-main-monsters" | "own-field-cards"; minCount?: number; maxCount?: number };

export interface GuideDecision {
  id: string;
  /** Só vira preferência automática quando os sinais codificam os pré-requisitos relevantes. */
  botEligible: boolean;
  lessonId: string;
  title: string;
  situation: string;
  signals: GuideDecisionSignal[];
  choices: { label: string; explanation: string; action: { kind: "summon" | "activate" | "effect" | "hold"; code: number; mode?: "normal" | "special" | "link"; targetCode?: number } }[];
  correctChoice: number;
  sourceIds: string[];
}

export interface DeckGuide {
  schemaVersion: 1;
  id: string;
  presetId: string;
  revision: number;
  reviewedAt: string;
  title: string;
  subtitle: string;
  description: string;
  difficulty: string;
  minutes: number;
  tags: string[];
  coverCodes: number[];
  /** Snapshot de revisão: mudanças na lista exigem conferir o guia de novo. */
  deckSnapshot: DuelDeckPayload;
  overview: { goal: string; plan: string[]; strengths: string[]; watchOut: string[] };
  keyCards: { code: number; name: string; role: string; explanation: string; sourceIds: string[] }[];
  lessons: GuideLesson[];
  decisions?: GuideDecision[];
  sources: GuideSource[];
}

export function matchesGuideDeck(guide: DeckGuide, preset: PresetDeckDefinition): boolean {
  const snapshot = guide.deckSnapshot;
  const same = (a: number[], b: number[]) =>
    [...a].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");
  return guide.presetId === preset.id && formatOf(snapshot.format) === formatOf(preset.format)
    && same(snapshot.main, preset.main) && same(snapshot.extra, preset.extra) && same(snapshot.side, preset.side);
}

export interface GuideProgress {
  completed: string[];
  currentLesson: string | null;
  steps?: Record<string, number>;
}

export const EMPTY_GUIDE_PROGRESS: GuideProgress = { completed: [], currentLesson: null };

export type GuideProgressReference = Pick<DeckGuide, "id" | "revision"> & { lessons: { id: string; steps?: unknown[] }[] };

export function guideProgressKey(playerId: string, guide: GuideProgressReference): string {
  return `yugioh-goat-learning-v1:${playerId}:${guide.id}:${guide.revision}`;
}

export function parseGuideProgress(raw: string | null, guide: GuideProgressReference): GuideProgress {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return EMPTY_GUIDE_PROGRESS;
    const { completed, currentLesson, steps } = value as Partial<GuideProgress>;
    const ids = new Set(guide.lessons.map((lesson) => lesson.id));
    const validSteps = steps && typeof steps === "object" && !Array.isArray(steps)
      ? Object.fromEntries(Object.entries(steps).filter(([id, step]) => ids.has(id) && typeof step === "number" && Number.isInteger(step) && step >= 0).map(([id, step]) => [id, Math.min(step, Math.max(0, (guide.lessons.find((lesson) => lesson.id === id)?.steps?.length ?? 1) - 1))]))
      : {};
    return {
      ...(Object.keys(validSteps).length ? { steps: validSteps } : {}),
      completed: Array.isArray(completed)
        ? [...new Set(completed.filter((id): id is string => typeof id === "string" && ids.has(id)))] : [],
      currentLesson: typeof currentLesson === "string" && ids.has(currentLesson) ? currentLesson : null,
    };
  } catch {
    return EMPTY_GUIDE_PROGRESS;
  }
}
