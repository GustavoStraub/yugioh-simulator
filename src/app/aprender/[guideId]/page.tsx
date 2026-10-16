import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeckGuideApp } from "@/components/learning/DeckGuideApp";
import { CardRegistryProvider } from "@/context/CardRegistryProvider";
import { DECK_GUIDES, getDeckGuide } from "@/lib/data/deck-guides";
import { getPresetDeck } from "@/lib/data/preset-decks-catalog";

type Props = {
  params: Promise<{ guideId: string }>;
  searchParams: Promise<{ licao?: string | string[] }>;
};

export function generateStaticParams() {
  return DECK_GUIDES.map((guide) => ({ guideId: guide.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = getDeckGuide((await params).guideId);
  return { title: guide ? `Aprender ${guide.title} — Yu-Gi-Oh! Goat` : "Guia não encontrado" };
}

export default async function GuidePage({ params, searchParams }: Props) {
  const guide = getDeckGuide((await params).guideId);
  if (!guide) notFound();
  const preset = getPresetDeck(guide.presetId);
  if (!preset) notFound();
  const { licao } = await searchParams;
  const initialLessonId = typeof licao === "string" && guide.lessons.some((lesson) => lesson.id === licao)
    ? licao : undefined;

  return (
    <CardRegistryProvider>
      <DeckGuideApp key={guide.id} guide={guide} preset={preset} initialLessonId={initialLessonId} />
    </CardRegistryProvider>
  );
}
