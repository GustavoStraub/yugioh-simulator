import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PracticeDuelApp } from "@/components/learning/PracticeDuelApp";
import { CardRegistryProvider } from "@/context/CardRegistryProvider";
import { getDeckGuide } from "@/lib/data/deck-guides";
import { getPresetDeck } from "@/lib/data/preset-decks-catalog";

export const metadata: Metadata = { title: "Treinar na mesa — Yu-Gi-Oh! Goat" };

export default async function PracticePage({ params }: { params: Promise<{ guideId: string; lessonId: string }> }) {
  const { guideId, lessonId } = await params;
  const guide = getDeckGuide(guideId);
  const lesson = guide?.lessons.find((item) => item.id === lessonId);
  const preset = guide && getPresetDeck(guide.presetId);
  if (!guide || !lesson || !preset) notFound();
  return <CardRegistryProvider><PracticeDuelApp key={`${guide.id}:${lesson.id}`} guide={guide} lesson={lesson} preset={preset} /></CardRegistryProvider>;
}
