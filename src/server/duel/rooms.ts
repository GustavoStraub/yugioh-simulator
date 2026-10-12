import { DuelRoom } from "@/server/duel/room";
import { normalizeRoomCode } from "@/lib/net/duel-protocol";

/**
 * As salas do processo.
 *
 * `Map` em memória de propósito: isto é jogo de rede local, um processo só. Um
 * armazenamento externo não compraria nada e custaria a capacidade de olhar o
 * estado com um `console.log`.
 *
 * ⚠️ Este módulo precisa ser importado **pelo `server.mjs`**, fora do grafo do
 * Next. Dentro de um route handler o `next dev` reavalia o módulo a cada
 * arquivo salvo, e todas as salas em andamento sumiriam sem aviso.
 */
const rooms = new Map<string, DuelRoom>();

/** Quanto tempo uma sala vazia é guardada antes de ser descartada. */
const VACANT_TTL_MS = 10 * 60 * 1000;

/**
 * Devolve a sala do código, criando-a se ainda não existir.
 *
 * Criar na entrada (em vez de exigir um "criar sala" separado) é o que faz o
 * link compartilhado continuar valendo depois de o anfitrião recarregar a aba:
 * quem chegar primeiro recria a sala e o outro entra em seguida.
 */
export function joinRoom(rawCode: string): DuelRoom {
  const code = normalizeRoomCode(rawCode);
  const existing = rooms.get(code);
  if (existing) return existing;

  const room = new DuelRoom(code);
  rooms.set(code, room);
  return room;
}

export function roomCount(): number {
  return rooms.size;
}

/** Descarta salas vazias há tempo demais. */
export function sweepRooms(now = Date.now()): number {
  let removed = 0;
  for (const [code, room] of rooms) {
    const since = room.vacantSince;
    if (since !== null && now - since > VACANT_TTL_MS) {
      rooms.delete(code);
      removed += 1;
    }
  }
  return removed;
}
