/**
 * Eventos discretos do duelo.
 *
 * O snapshot descreve o estado *atual*; ele não serve para animar nem tocar
 * som, porque não diz o que **aconteceu** entre dois estados. Estes eventos são
 * transitórios: emitidos uma vez, consumidos por quem anima e por quem toca
 * áudio, e descartados.
 */
/** Identifica uma zona do campo, para casar evento com elemento na tela. */
export interface DuelZoneRef {
  controller: number;
  location: number;
  sequence: number;
}

/**
 * Por que uma carta saiu do campo, já resumido para a tela e o histórico. Vem
 * do motivo que o core guarda na carta (`REASON_*`), lido no destino.
 */
export type LeaveReason =
  | "battle"
  | "destroy"
  | "tribute"
  | "material"
  | "grave"
  | "banish"
  | "hand"
  | "deck";

/**
 * Que invocação ganha o corte do Master Duel (a arte em tela cheia): as do
 * Extra Deck, a de Ritual e a por Tributo — decisão do Gustavo.
 */
export type CutInKind = "fusion" | "synchro" | "xyz" | "link" | "ritual" | "tribute";

export type DuelEvent =
  | {
      kind: "summon";
      player: number;
      code: number;
      special: boolean;
      /** Presente quando a invocação ganha o corte (ver `CutInKind`). */
      cutIn?: CutInKind;
    }
  | { kind: "set"; player: number }
  | { kind: "activate"; player: number; code: number }
  | {
      kind: "attack";
      player: number;
      direct: boolean;
      /** Zona do atacante e do alvo — a UI usa para animar a carta voando. */
      from: DuelZoneRef;
      to: DuelZoneRef | null;
    }
  | { kind: "damage"; player: number; amount: number }
  | { kind: "recover"; player: number; amount: number }
  /**
   * Uma carta saiu do campo — destruída, enviada, banida, devolvida.
   *
   * A mesa desenha um fantasma dela na zona de onde saiu (estilhaço na
   * destruição, esmaecer no banimento); sem isto a carta simplesmente sumia e o
   * topo do Cemitério trocava. `code` é `null` quando a carta não era pública
   * (baixada voltando para a mão ou o Deck): o evento vai aos dois assentos.
   */
  | {
      kind: "leave";
      player: number;
      code: number | null;
      from: DuelZoneRef;
      /**
       * Para onde ela foi — a mesa a faz voar até lá (Cemitério, banidas,
       * Deck, Extra Deck, mão), como no Master Duel. Na matéria Xyz é a zona
       * do monstro Xyz (ou o Extra Deck, na Invocação-Xyz: a matéria é
       * anexada a ele antes de ele descer). O lugar é público mesmo quando a
       * carta não é: todo mundo vê a carta baixada voltando para a mão.
       */
      to: DuelZoneRef;
      why: LeaveReason;
    }
  | { kind: "draw"; player: number; count: number }
  | { kind: "phase"; phase: number }
  /** `count`: o número do turno (1 = o primeiro — a faixa "DUEL START"). */
  | { kind: "turn"; player: number; count?: number }
  | { kind: "flip"; player: number; code: number }
  | { kind: "position"; player: number }
  | { kind: "coin"; player: number; results: boolean[] }
  | { kind: "dice"; player: number; results: number[] }
  /**
   * Cartas mostradas a alguém (efeitos com "revelando", olhar o topo do deck).
   *
   * `visibleTo` é o assento que tem direito de ver a lista. Num duelo entre dois
   * humanos entregar este evento aos dois seria mostrar a carta que só um deles
   * podia olhar — a fuga de informação mais fácil de cometer aqui.
   */
  | {
      kind: "reveal";
      player: number;
      codes: number[];
      title: string;
      visibleTo: 0 | 1;
    }
  /**
   * Corrente: um elo entrou (`from` = de onde a carta foi ativada, como
   * `OcgLocation`) ou foi negado — a ATIVAÇÃO (Solemn) ou o EFEITO (Ash
   * Blossom). O "resolvendo" não é evento: vai no `chainLinks` do snapshot.
   * Públicos: ativar revela a carta. `description` é o efeito ativado, como
   * o core o descreve (o mesmo de `DuelChainLink.description`) — vai no
   * evento para o destaque dizer O QUE a carta faz mesmo quando a corrente
   * resolve sem ninguém ser perguntado.
   */
  | {
      kind: "chainLink";
      link: number;
      player: number;
      code: number;
      from: number;
      description?: string | null;
    }
  | {
      kind: "chainNegated";
      link: number;
      player: number;
      code: number;
      what: "activation" | "effect";
    }
  | { kind: "win"; player: number };

export type DuelEventKind = DuelEvent["kind"];

export type DuelEventListener = (event: DuelEvent) => void;
