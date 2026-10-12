import { DeckBuilderApp } from "@/components/deck-builder/DeckBuilderApp";
import { CardRegistryProvider } from "@/context/CardRegistryProvider";

export default function HomePage() {
  return (
    <CardRegistryProvider>
      <DeckBuilderApp />
    </CardRegistryProvider>
  );
}
