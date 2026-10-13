import { PuzzlesApp } from "@/components/duel/PuzzlesApp";
import { CardRegistryProvider } from "@/context/CardRegistryProvider";

export default function PuzzlesPage() {
  return (
    <CardRegistryProvider>
      <PuzzlesApp />
    </CardRegistryProvider>
  );
}
