import { DuelLobby } from "@/components/duel/DuelLobby";
import { CardRegistryProvider } from "@/context/CardRegistryProvider";

export default function DuelPage() {
  return (
    <CardRegistryProvider>
      <DuelLobby />
    </CardRegistryProvider>
  );
}
