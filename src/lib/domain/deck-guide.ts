import { formatOf, type DuelDeckPayload } from "@/lib/types";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";

export interface GuideSource {
  id: string;
  title: string;
  url: string;
}

export interface GuideLesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  sourceIds: string[];
  preparation: string[];
  /** A mão de exemplo usa somente cartas da lista, com suas quantidades reais. */
  startingHand: number[];
  steps: { title: string; action: string; why: string; cardCodes: number[] }[];
  outcome: string;
  cautions: string[];
  practice: LessonPractice;
}

export type PracticeCondition =
  | { kind: "card"; zone: "monsters" | "spells" | "hand" | "grave" | "banished" | "extra"; code: number; count?: number; absent?: boolean }
  | { kind: "lp"; player: 0 | 1; value: number }
  | { kind: "offered"; code: number; location: number };

/** Identidade da carta indicada, sem depender da ordem ou do nome traduzido. */
export interface GuideCardTarget { code: number; location: number; controller?: number; scope?: "action" | "selection" }

export interface LessonPractice {
  goal: PracticeCondition[];
  stages: { title: string; instruction: string; why: string; targets: GuideCardTarget[]; completeWhen: PracticeCondition[] }[];
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
}

export const EMPTY_GUIDE_PROGRESS: GuideProgress = { completed: [], currentLesson: null };

export function guideProgressKey(playerId: string, guide: DeckGuide): string {
  return `yugioh-goat-learning-v1:${playerId}:${guide.id}:${guide.revision}`;
}

export function parseGuideProgress(raw: string | null, guide: DeckGuide): GuideProgress {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return EMPTY_GUIDE_PROGRESS;
    const { completed, currentLesson } = value as Partial<GuideProgress>;
    const ids = new Set(guide.lessons.map((lesson) => lesson.id));
    return {
      completed: Array.isArray(completed)
        ? [...new Set(completed.filter((id): id is string => typeof id === "string" && ids.has(id)))] : [],
      currentLesson: typeof currentLesson === "string" && ids.has(currentLesson) ? currentLesson : null,
    };
  } catch {
    return EMPTY_GUIDE_PROGRESS;
  }
}
