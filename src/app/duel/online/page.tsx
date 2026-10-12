import { CardRegistryProvider } from "@/context/CardRegistryProvider";
import { OnlineLobby } from "@/components/duel/OnlineLobby";
import { normalizeRoomCode } from "@/lib/net/duel-protocol";

export default async function OnlineLobbyPage({
  searchParams,
}: PageProps<"/duel/online">) {
  const { room } = await searchParams;
  const codigo = typeof room === "string" ? normalizeRoomCode(room) : "";

  return (
    <CardRegistryProvider>
      <OnlineLobby initialRoom={codigo} />
    </CardRegistryProvider>
  );
}
