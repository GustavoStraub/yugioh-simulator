import type { BoardCard, ZoneRef } from "@/lib/duel/board-state";
import type { EngineStringsDb } from "@/lib/duel/engine-strings";
import { translateOcgAttribute, translateOcgRace } from "@/lib/card-labels";

/**
 * As marcas de uma carta como a mesa as mostra: um selo curto no slot e uma
 * frase na leitura da carta.
 *
 * É a tela do que o engine sabe e o jogador não via: o Marcador de Magia do
 * Breaker, os turnos que faltam nas Espadas da Luz Reveladora, a carta que a
 * Proibição declarou, o "não pode atacar neste turno", a quem um Equipamento
 * está ligado, o monstro que o Chamado do Assombrado trouxe, a carta negada.
 */
export interface CardMark {
  /** Selo no slot — um ícone e, quando cabe, um número. */
  chip: string;
  /** A frase completa (leitura da carta e dica do selo). */
  text: string;
  tone: "counter" | "turn" | "declared" | "notice" | "link" | "target" | "negated";
}

export interface MarkContext {
  engineStrings: EngineStringsDb;
  /** Nome de uma carta pelo passcode. */
  cardName: (code: number) => string;
  /** Nome da carta numa zona, como quem olha a vê (oculta = "carta baixada"). */
  nameAt: (zone: ZoneRef) => string;
  /** Equipamentos ligados a esta carta na mesa visível. */
  equippedCards?: readonly BoardCard[];
}

/** Bits de uma máscara (raça/atributo), um por um. */
function bits(mask: number): number[] {
  const out: number[] = [];
  for (let bit = 0; bit < 32; bit += 1) {
    if (mask & (1 << bit)) out.push((1 << bit) >>> 0);
  }
  return out;
}

export function cardMarks(card: BoardCard, ctx: MarkContext): CardMark[] {
  const marks: CardMark[] = [];

  if (card.negated) {
    marks.push({ chip: "⊘", text: "Efeitos negados", tone: "negated" });
  }

  for (const counter of card.counters) {
    const name = ctx.engineStrings.counterName(counter.type);
    marks.push({
      chip: `✦${counter.count}`,
      text: `${name} ×${counter.count}`,
      tone: "counter",
    });
  }

  for (const hint of card.hints) {
    switch (hint.kind) {
      case "turn":
        marks.push({ chip: `⏱${hint.value}`, text: `Contagem de turnos: ${hint.value}`, tone: "turn" });
        break;
      case "card":
        marks.push({ chip: "📢", text: `Declarada: ${ctx.cardName(hint.code)}`, tone: "declared" });
        break;
      case "race":
        marks.push({
          chip: "📢",
          text: `Tipo declarado: ${bits(hint.mask)
            .map((bit) => translateOcgRace(BigInt(bit)))
            .join(", ")}`,
          tone: "declared",
        });
        break;
      case "attribute":
        marks.push({
          chip: "📢",
          text: `Atributo declarado: ${bits(hint.mask)
            .map((bit) => translateOcgAttribute(bit))
            .join(", ")}`,
          tone: "declared",
        });
        break;
      case "number":
        marks.push({ chip: `#${hint.value}`, text: `Número declarado: ${hint.value}`, tone: "declared" });
        break;
      case "desc":
        marks.push({ chip: "ⓘ", text: hint.text, tone: "notice" });
        break;
    }
  }

  if (card.equippedTo) {
    marks.push({ chip: "🔗", text: `Equipada a ${ctx.nameAt(card.equippedTo)}`, tone: "link" });
  }
  if (ctx.equippedCards?.length) {
    marks.push({
      chip: `🔗${ctx.equippedCards.length}`,
      text: `Equipamentos: ${ctx.equippedCards.map((equipment) => ctx.nameAt(equipment)).join(", ")}`,
      tone: "link",
    });
  }
  for (const target of card.targets) {
    marks.push({ chip: "🎯", text: `Alvo: ${ctx.nameAt(target)}`, tone: "link" });
  }

  return marks;
}

/**
 * Selos que cabem num slot: os avisos de texto viram UM selo com a contagem
 * (uma carta moderna acumula vários, e a frase inteira mora na leitura).
 */
export function slotChips(marks: CardMark[]): CardMark[] {
  const notices = marks.filter((mark) => mark.tone === "notice");
  const others = marks.filter((mark) => mark.tone !== "notice");
  if (notices.length === 0) return others;
  return [
    ...others,
    {
      chip: notices.length > 1 ? `ⓘ${notices.length}` : "ⓘ",
      text: notices.map((mark) => mark.text).join("\n"),
      tone: "notice",
    },
  ];
}
