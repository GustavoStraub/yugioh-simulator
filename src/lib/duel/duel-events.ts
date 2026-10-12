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

export type DuelEvent =
  | { kind: "summon"; player: number; code: number; special: boolean }
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
  | { kind: "destroy"; player: number }
  | { kind: "draw"; player: number; count: number }
  | { kind: "phase"; phase: number }
  | { kind: "turn"; player: number }
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
  | { kind: "win"; player: number };

export type DuelEventKind = DuelEvent["kind"];

export type DuelEventListener = (event: DuelEvent) => void;
