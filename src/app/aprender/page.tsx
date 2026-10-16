import type { Metadata } from "next";

import { LearningLibrary } from "@/components/learning/LearningLibrary";

export const metadata: Metadata = {
  title: "Aprender os decks — Yu-Gi-Oh! Goat",
  description: "Conheça os decks oficiais e aprenda suas jogadas com guias e lições passo a passo.",
};

export default function LearnPage() {
  return <LearningLibrary />;
}
