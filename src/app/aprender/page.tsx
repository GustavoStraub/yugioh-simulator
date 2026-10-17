import type { Metadata } from "next";

import { LearningLibrary } from "@/components/learning/LearningLibrary";

export const metadata: Metadata = {
  title: "Aprender os decks — Yu-Gi-Oh! Goat",
  description: "Conheça os decks oficiais e aprenda suas jogadas com guias e lições passo a passo.",
};

import { DECK_GUIDES } from "@/lib/data/deck-guides";

export default function LearnPage() {
  return <LearningLibrary guides={DECK_GUIDES.map(({ id, revision, title, description, difficulty, minutes, tags, coverCodes, presetId, lessons, keyCards, sources, subtitle }) => ({ id, revision, title, description, difficulty, minutes, tags, coverCodes, presetId, lessons: lessons.map(({ id, steps }) => ({ id, steps: steps.map(() => null) })), searchText: [subtitle, ...keyCards.map((card) => card.name), ...sources.map((source) => source.title)].join(" ") }))} />;
}
