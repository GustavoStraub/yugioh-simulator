import { OcgMessageType as M, OcgPosition, OcgLocation, type OcgMessage, type OcgCardLoc } from "@n1xx1/ocgcore-wasm";
import { maskHiddenCards, maskKey } from "@/lib/duel/prompt-mask";
import type { BoardState } from "@/lib/duel/board-state";

export interface BotEffect {
  code: number;
  player: number;
  description: bigint;
  link: number;
  negated: boolean;
  targets?: { controller: number; location: number; sequence: number; present: boolean }[];
}

export interface BotHypothesis {
  kind: "battle-response" | "hand-response";
  evidence: string;
  confidence: "possible";
}
export interface BotFact {
  code: number;
  player: number;
  seenTurn: number;
  /** Só existe enquanto a associação entre carta e posição é conhecida. */
  place: string | null;
}

/** Só fatos públicos e revelações autorizadas; nunca guarda mensagens brutas. */
export class BotKnowledge {
  private readonly links = new Map<number, BotEffect>();
  private readonly revealed = new Set<string>();
  private resolvingLink: number | null = null;
  private lastFailed: { code: number; player: number; revision: number } | null = null;
  private revision = 0;
  private facts: BotFact[] = [];
  turnPlayer: number | null = null;
  turnCount = 0;
  phase: number | null = null;
  summoning: { code: number; player: number } | null = null;

  readonly seat: 0 | 1;
  constructor(seat: 0 | 1) { this.seat = seat; }

  observe(message: OcgMessage): void {
    switch (message.type) {
      case M.NEW_TURN:
        this.turnPlayer = message.player;
        this.turnCount += 1;
        this.links.clear();
        this.lastFailed = null;
        this.resolvingLink = null;
        this.summoning = null;
        this.revealed.clear();
        break;
      case M.NEW_PHASE:
        this.phase = message.phase;
        this.summoning = null;
        break;
      case M.CHAINING:
        this.remember(message.code, message.controller, null);
        this.links.set(message.chain_size, { code: message.code, player: message.controller,
          description: message.description, link: message.chain_size, negated: false });
        break;
      case M.CHAIN_SOLVING:
        this.resolvingLink = message.chain_size;
        this.revealed.clear();
        break;
      case M.BECOME_TARGET: {
        const top = [...this.links.values()].at(-1);
        if (top && this.resolvingLink === null) top.targets = message.cards.map((card) => ({
          controller: card.controller, location: card.location, sequence: card.sequence, present: true,
        }));
        break;
      }
      case M.CHAIN_SOLVED:
        this.resolvingLink = null;
        this.revealed.clear();
        break;
      case M.CHAIN_DISABLED:
      case M.CHAIN_NEGATED: {
        const effect = this.links.get(message.chain_size);
        if (effect) {
          effect.negated = true;
          this.lastFailed = { code: effect.code, player: effect.player, revision: ++this.revision };
        }
        break;
      }
      case M.CHAIN_END:
        this.links.clear();
        this.resolvingLink = null;
        this.summoning = null;
        this.revealed.clear();
        break;
      case M.CONFIRM_CARDS:
        if (message.player === this.seat) {
          for (const card of message.cards) {
            const place = maskKey(card.controller, card.location, card.sequence);
            this.revealed.add(place);
            this.remember(card.code, card.controller, place);
          }
        }
        break;
      // Uma posição deixa de identificar a carta após movimento ou embaralhamento.
      // Esquecer conservadoramente evita transformar uma revelação em visão da mão.
      case M.SHUFFLE_DECK:
      case M.SHUFFLE_HAND:
      case M.MOVE:
        this.revealed.clear();
        this.facts = this.facts.map((fact) => ({ ...fact, place: null }));
        if (message.type === M.MOVE) for (const link of this.links.values()) for (const target of link.targets ?? []) {
          if (target.controller === message.from.controller && target.location === message.from.location
            && target.sequence === message.from.sequence) target.present = false;
        }
        break;
      case M.SUMMONING:
      case M.SPSUMMONING:
      case M.FLIPSUMMONING:
        this.summoning = { code: message.controller !== this.seat && (message.position & OcgPosition.FACEDOWN) !== 0 ? 0 : message.code, player: message.controller };
        break;
      case M.SUMMONED:
      case M.SPSUMMONED:
      case M.FLIPSUMMONED:
        this.summoning = null;
        break;
    }
  }

  mask(prompt: OcgMessage, readBoard?: () => BoardState): OcgMessage {
    const safeField = <T extends OcgCardLoc>(card: T): T => {
      if (card.controller === this.seat || card.location !== OcgLocation.MZONE && card.location !== OcgLocation.SZONE
        || this.revealed.has(maskKey(card.controller, card.location, card.sequence))) return card;
      // SUM e TRIBUTE não trazem posição. Consultar a visão do assento só
      // quando incluem o campo adversário evita interpretar ausência como face-up.
      const player = readBoard?.().players[card.controller];
      const visible = card.location === OcgLocation.MZONE ? player?.monsters[card.sequence] : player?.spells[card.sequence];
      return { ...card, code: visible?.code ?? 0 };
    };
    if (prompt.type === M.SELECT_SUM) prompt = { ...prompt,
      selects: prompt.selects.map(safeField), selects_must: prompt.selects_must.map(safeField) };
    else if (prompt.type === M.SELECT_TRIBUTE) prompt = { ...prompt, selects: prompt.selects.map(safeField) };
    return maskHiddenCards(prompt, this.seat, this.revealed);
  }

  private remember(code: number, player: number, place: string | null): void {
    const old = this.facts.find((fact) => fact.code === code && fact.player === player);
    if (old) { old.place = place; old.seenTurn = this.turnCount; }
    else this.facts.push({ code, player, seenTurn: this.turnCount, place });
    if (this.facts.length > 128) this.facts.shift();
  }

  context() {
    const top = [...this.links.values()].at(-1);
    return { turnPlayer: this.turnPlayer, turnCount: this.turnCount, phase: this.phase,
      chainPlayer: top?.player ?? null, chainCode: top?.code ?? null,
      resolvingEffect: this.resolvingLink === null ? null : this.links.get(this.resolvingLink) ?? null,
      chainOpen: this.links.size > 0, failedEffect: this.lastFailed, summoning: this.summoning,
      chainTargets: top?.targets?.map((target) => ({ ...target })) ?? [],
      observedFacts: this.facts.map((fact) => ({ ...fact })) };
  }
}
