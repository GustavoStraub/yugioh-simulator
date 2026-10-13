import type { CardRegistry } from "@/lib/domain/card-registry";
import type { CardDefinition } from "@/lib/types";

/** Uma carta do deck com quantas cópias tem. */
export interface DeckEntry {
  code: number;
  count: number;
  definition?: CardDefinition;
}

/**
 * O retrato de um deck: quantos monstros, magias e armadilhas, a curva de
 * nível dos monstros do Deck Principal e o que tem no Extra.
 *
 * Serve a dois lugares: a prévia do deck do bot no lobby (decidir contra o
 * que se vai jogar) e as estatísticas do construtor (o "o deck está pesado
 * demais?" que o Master Duel responde com o painel de detalhes).
 */
export interface DeckStats {
  main: number;
  extra: number;
  monsters: number;
  spells: number;
  traps: number;
  /** Nível → cópias, só monstros do Deck Principal com Nível (sem Link/Xyz). */
  levels: Map<number, number>;
  extraKinds: { fusion: number; synchro: number; xyz: number; link: number; other: number };
  /** Cartas únicas do Principal, mais cópias primeiro. */
  mainEntries: DeckEntry[];
  extraEntries: DeckEntry[];
}

function contar(codes: readonly number[], registry: CardRegistry | null): DeckEntry[] {
  const contagem = new Map<number, number>();
  for (const code of codes) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return [...contagem]
    .map(([code, count]) => ({ code, count, definition: registry?.get(code) }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.definition?.name ?? String(a.code)).localeCompare(b.definition?.name ?? String(b.code)),
    );
}

/** Monstro, Magia ou Armadilha — pelo `type` do catálogo ("Effect Monster", "Spell Card"…). */
export function cardKind(definition: CardDefinition | undefined): "monster" | "spell" | "trap" | null {
  if (!definition) return null;
  if (definition.type.includes("Spell")) return "spell";
  if (definition.type.includes("Trap")) return "trap";
  if (definition.type.includes("Monster") || definition.type.includes("Token")) return "monster";
  return null;
}

export function deckStats(
  main: readonly number[],
  extra: readonly number[],
  registry: CardRegistry | null,
): DeckStats {
  const mainEntries = contar(main, registry);
  const extraEntries = contar(extra, registry);
  const stats: DeckStats = {
    main: main.length,
    extra: extra.length,
    monsters: 0,
    spells: 0,
    traps: 0,
    levels: new Map(),
    extraKinds: { fusion: 0, synchro: 0, xyz: 0, link: 0, other: 0 },
    mainEntries,
    extraEntries,
  };

  for (const { definition, count } of mainEntries) {
    const kind = cardKind(definition);
    if (kind === "monster") {
      stats.monsters += count;
      const frame = definition?.frameType ?? "";
      const level = definition?.level;
      if (level && !frame.includes("xyz") && !frame.includes("link")) {
        stats.levels.set(level, (stats.levels.get(level) ?? 0) + count);
      }
    } else if (kind === "spell") {
      stats.spells += count;
    } else if (kind === "trap") {
      stats.traps += count;
    }
  }

  for (const { definition, count } of extraEntries) {
    const frame = definition?.frameType ?? "";
    if (frame.includes("fusion")) stats.extraKinds.fusion += count;
    else if (frame.includes("synchro")) stats.extraKinds.synchro += count;
    else if (frame.includes("xyz")) stats.extraKinds.xyz += count;
    else if (frame.includes("link")) stats.extraKinds.link += count;
    else stats.extraKinds.other += count;
  }

  return stats;
}
