import { OnlineDuelApp } from "@/components/duel/OnlineDuelApp";
import { normalizeRoomCode } from "@/lib/net/duel-protocol";

export default async function OnlineRoomPage({
  params,
}: PageProps<"/duel/online/[code]">) {
  const { code } = await params;
  return <OnlineDuelApp code={normalizeRoomCode(code)} />;
}
