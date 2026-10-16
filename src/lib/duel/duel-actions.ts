import {
  OcgLocation,
  OcgMessageType,
  OcgOpCode,
  OcgPosition,
  OcgResponseType,
  OcgType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgAttributeParse,
  ocgPositionParse,
  ocgRaceParse,
  type OcgAttribute,
  type OcgCardLoc,
  type OcgMessage,
  type OcgRace,
  type OcgResponse,
  type SelectFieldPlace,
} from "@n1xx1/ocgcore-wasm";

import { isDeclarable } from "@/lib/duel/announce-filter";
import { isTriggerWindow } from "@/lib/duel/chain-mode";
import { decodeFieldMask } from "@/lib/duel/field-places";
import type { OfficialCardData } from "@/lib/duel/official-card-data";
import type { EngineStringsDb } from "@/lib/duel/engine-strings";
import { isValidSum, sumProgress, sumRequestOf } from "@/lib/duel/sum-selection";
import { translateOcgAttribute, translateOcgRace } from "@/lib/card-labels";
import type { CardDefinition } from "@/lib/types";

/** Uma ação que o jogador pode tomar clicando numa carta específica. */
export interface CardAction {
  label: string;
  /**
   * O que a ação faz, quando o core diz: a descrição do EFEITO a ativar
   * ("Special Summon this card", "Como Escala de Pêndulo").
   *
   * Sem isto toda jogada de efeito era só "Ativar" — e uma carta com dois
   * efeitos mostrava dois botões "Ativar" idênticos. O rótulo continua sendo o
   * verbo (é por ele que os testes e o olho acham a ação); o detalhe vai
   * embaixo.
   */
  detail?: string;
  /** Passcode da carta — deixa a UI mostrar de qual carta é a ação. */
  code: number;
  /** Onde a carta está (mão, campo, cemitério...), para desambiguar cópias. */
  location: number;
  response: OcgResponse;
}

/** Uma carta oferecida numa seleção múltipla. */
export interface SelectionCandidate {
  code: number;
  controller: number;
  location: number;
  sequence: number;
}

/**
 * Ordenação de cartas (SORT_CARD) — efeitos do tipo "veja as N cartas do topo
 * do Deck e recoloque-as na ordem que quiser".
 *
 * `build` recebe a ordem como a tela a pensa — para cada posição `i` (0 = topo),
 * o **índice original** da carta que deve ficar ali — e devolve a resposta no
 * formato do core, que é o inverso: para cada carta `i`, a **posição** dela
 * (`field::sort_deck`: `tc[returns[i]] = select_cards[i]`). Com duas cartas
 * as duas leituras coincidem; com três, `[2, 0, 1]` punha no topo a carta 1 em
 * vez da 2. `null` mantém a ordem em que vieram.
 */
export interface SortingMode {
  cards: SelectionCandidate[];
  build: (order: number[] | null) => OcgResponse;
}

/** Ordem "carta em cada posição" → ordem "posição de cada carta" (a do core). */
export function sortOrderForCore(order: readonly number[]): number[] {
  const positions = new Array<number>(order.length);
  order.forEach((card, position) => {
    positions[card] = position;
  });
  return positions;
}

/**
 * Uma opção oferecida em ANNOUNCE_RACE / ANNOUNCE_ATTRIB — não é uma carta, é
 * um valor abstrato (uma raça ou um atributo) que o jogador declara.
 */
export interface AnnounceOption {
  label: string;
  /** `OcgRace` (bigint) ou `OcgAttribute` (number), conforme o prompt. */
  value: bigint | number;
}

/**
 * Prompt de declarar raça(s) ou atributo(s) (ANNOUNCE_RACE / ANNOUNCE_ATTRIB).
 * `count` é quantos valores DISTINTOS o jogador precisa marcar antes de
 * confirmar — quase sempre 1, mas cartas como Earthshaker pedem 2.
 */
export interface AnnounceChoice {
  count: number;
  options: AnnounceOption[];
  build: (values: (bigint | number)[]) => OcgResponse;
}

/**
 * Prompt de declarar o nome de uma carta (ANNOUNCE_CARD). O core manda um
 * filtro (pilha de opcodes) restringindo quais nomes são válidos — ver
 * `announceCardMatches`, que decide quais cartas do registry a UI pode
 * oferecer na busca.
 */
export interface AnnounceCardChoice {
  opcodes: readonly OcgOpCode[];
  build: (code: number) => OcgResponse;
}

/** Ação que não pertence a nenhuma carta (mudar de fase, recusar, cancelar). */
export interface GlobalAction {
  label: string;
  /** Destaque visual — usado para o botão principal (ex.: encerrar turno). */
  tone?: "primary" | "default";
  response: OcgResponse;
}

/**
 * Modo de seleção múltipla: o jogador marca N cartas e confirma.
 * Usado por SELECT_CARD, SELECT_TRIBUTE, SELECT_SUM e SELECT_UNSELECT_CARD.
 */
export interface SelectionMode {
  min: number;
  max: number;
  /** Chaves das cartas selecionáveis, na ordem dos índices esperados na resposta. */
  keys: string[];
  /**
   * As próprias cartas candidatas, na mesma ordem de `keys`.
   *
   * Necessário porque nem toda seleção acontece em cartas visíveis: efeitos de
   * busca apontam para o DECK, onde não há nada clicável no tabuleiro. Com a
   * lista aqui, a UI consegue abrir um seletor.
   */
  candidates: SelectionCandidate[];
  /** Monta a resposta a partir dos índices escolhidos. */
  build: (indices: number[]) => OcgResponse;
  /**
   * Validação além da contagem. SELECT_SUM exige que os valores das cartas
   * somem um alvo, então "quantas foram marcadas" não basta.
   */
  isValid?: (indices: number[]) => boolean;
  /** Texto de progresso mostrado ao jogador (ex.: "níveis 4/8"). */
  progress?: (indices: number[]) => string;
  /**
   * Cartas que já entram na seleção sem o jogador marcar (SELECT_SUM:
   * `selects_must`) — contam para o alvo em `progress`, mas não fazem parte
   * dos índices de `build` (o core não as espera na resposta). Mostradas como
   * "já incluídas", nunca clicáveis.
   */
  locked?: SelectionCandidate[];
  /**
   * Índices de `candidates` que JÁ foram escolhidos em passos anteriores
   * (SELECT_UNSELECT_CARD: `unselect_cards`). Aparecem marcados; clicar num
   * deles desfaz a escolha. Sem a marca, um material já escolhido parecia
   * igual aos que faltavam escolher, e clicar nele de novo o tirava.
   */
  alreadyChosen?: number[];
  /**
   * Cada clique já É a resposta (SELECT_UNSELECT_CARD). O core pergunta uma
   * carta por vez — "marque mais uma, desmarque uma, ou conclua" — e refaz a
   * lista a cada passo (com Covil das Trevas, por exemplo, escolher 1 monstro
   * do oponente tira os outros dele da lista). Pedir "Confirmar" a cada carta
   * fazia uma seleção livre de "quantos quiser" parecer um laço de prompts
   * repetidos, e com "Confirmar" e "Concluir" lado a lado era fácil concluir
   * sem a carta que acabara de marcar. Assim, clicar marca/desmarca na hora e
   * só "Concluir" encerra.
   */
  immediate?: boolean;
}

/**
 * SELECT_PLACE / SELECT_DISFIELD quando `count` pede MAIS de uma zona por
 * vez (ex.: Torrencial de Lava). Clicar já respondia com 1 zona só — cedo
 * demais, faltando zona, e o core devolvia RETRY. Marca `count` zonas no
 * próprio campo antes de confirmar, como a seleção múltipla de cartas.
 */
export interface PlaceSelectionMode {
  count: number;
  places: SelectFieldPlace[];
  build: (chosen: SelectFieldPlace[]) => OcgResponse;
}

/**
 * SELECT_COUNTER: distribuir N marcadores entre cartas — o core pergunta de
 * quais cartas sai cada marcador quando um efeito remove "N marcadores" e mais
 * de uma carta os tem. Cada carta tem um teto (quantos ela tem), e a soma tem
 * que dar exatamente N.
 */
export interface CounterSelection {
  count: number;
  /** Nome do marcador ("Marcador de Magia"), quando as strings do engine estão à mão. */
  counterName: string;
  cards: (SelectionCandidate & { max: number })[];
  /** Resposta a partir de quantos sai de cada carta, na ordem de `cards`. */
  build: (amounts: number[]) => OcgResponse;
}

export interface PromptPlan {
  /**
   * Como apresentar o prompt.
   * - `modal`: decisão pura, que interrompe o jogo e precisa de resposta
   *   imediata (sim/não, escolher efeito, encadear).
   * - `inline`: o jogador age no próprio tabuleiro (clicar carta, escolher
   *   zona, marcar alvos), então nada deve cobrir a mesa.
   */
  presentation: "modal" | "inline";
  /** Instrução curta exibida ao jogador. */
  instruction: string;
  /** Ações por carta — chave de `cardKey()`. */
  byCard: Map<string, CardAction[]>;
  /** Ações fora das cartas. */
  global: GlobalAction[];
  /** Zonas do campo que devem ser clicáveis (SELECT_PLACE / SELECT_DISFIELD). */
  places: { place: SelectFieldPlace; response: OcgResponse }[];
  /** Presente quando o prompt exige marcar várias cartas antes de confirmar. */
  selection: SelectionMode | null;
  /** Presente quando o prompt pede uma ORDEM para um conjunto de cartas. */
  sorting: SortingMode | null;
  /** Presente em ANNOUNCE_RACE / ANNOUNCE_ATTRIB — declarar raça(s)/atributo(s). */
  announce: AnnounceChoice | null;
  /** Presente em ANNOUNCE_CARD — declarar o nome de uma carta. */
  announceCard: AnnounceCardChoice | null;
  /** Presente quando SELECT_PLACE/SELECT_DISFIELD pede mais de uma zona. */
  placeSelection: PlaceSelectionMode | null;
  /** Presente em SELECT_COUNTER — distribuir marcadores entre cartas. */
  counters: CounterSelection | null;
  /**
   * A carta a que o prompt se refere, quando o engine informa.
   * Sem isso um "Ativar este efeito?" não diz de qual carta está falando.
   */
  subject: { code: number; location: number } | null;
}

/** Identidade estável de uma carta no campo, usada para casar ação ↔ zona. */
export function cardKey(
  controller: number,
  location: number,
  sequence: number,
): string {
  return `${controller}:${location}:${sequence}`;
}

function candidatesOf(cards: readonly OcgCardLoc[]): SelectionCandidate[] {
  return cards.map((card) => ({
    code: card.code,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
  }));
}

function keyOf(card: OcgCardLoc): string {
  return cardKey(card.controller, card.location, card.sequence);
}

/** Registra uma ação já anotada com a carta de origem. */
/** Descrições do sistema que só dizem "ativar" — não acrescentam nada. */
const GENERIC_EFFECT_TEXT = new Set(["activate", "ativar"]);

/**
 * Descrições do sistema que aparecem em jogada de carta, em português — o
 * resto das strings do sistema vem do `strings.conf`, em inglês.
 */
/** O detalhe da jogada "ativar como Escala de Pêndulo" (string 1160 do sistema). */
export const PENDULUM_SCALE_DETAIL = "Como Escala de Pêndulo";

const SYSTEM_EFFECT_PT: Record<number, string> = {
  1160: PENDULUM_SCALE_DETAIL,
  1161: "Resolver o efeito",
  1162: "Reiniciar o efeito",
};

/**
 * O que um efeito ativável faz, pelo `description` que o core manda com ele.
 *
 * É a string que o script registrou com `SetDescription`: quase sempre uma
 * string da própria carta (`aux.Stringid(id, n)` → o texto curto do efeito,
 * em inglês como o ProjectIgnis escreve), às vezes uma do sistema. `0` é
 * efeito sem descrição — e aí não há o que dizer além de "Ativar".
 */
export function effectDetail(
  description: bigint | number | undefined,
  engineStrings?: EngineStringsDb,
): string | undefined {
  if (description === undefined || !engineStrings) return undefined;
  const raw = Number(description);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  if (SYSTEM_EFFECT_PT[raw]) return SYSTEM_EFFECT_PT[raw];
  const text = engineStrings.describeOption(raw)?.trim();
  if (!text || GENERIC_EFFECT_TEXT.has(text.toLowerCase())) return undefined;
  return text;
}

function push(
  map: Map<string, CardAction[]>,
  card: OcgCardLoc,
  action: Omit<CardAction, "code" | "location">,
): void {
  const key = keyOf(card);
  const full: CardAction = {
    ...action,
    code: card.code,
    location: card.location,
  };
  const existing = map.get(key);
  if (existing) existing.push(full);
  else map.set(key, [full]);
}

function emptyPlan(
  instruction: string,
  presentation: PromptPlan["presentation"] = "inline",
): PromptPlan {
  return {
    presentation,
    instruction,
    byCard: new Map(),
    global: [],
    places: [],
    selection: null,
    sorting: null,
    announce: null,
    announceCard: null,
    placeSelection: null,
    counters: null,
    subject: null,
  };
}

/**
 * Traduz uma mensagem do engine no conjunto de interações possíveis,
 * ancoradas nas cartas — é o que permite jogar clicando na carta em vez de
 * numa lista de botões abstratos.
 */
export function buildPromptPlan(
  message: OcgMessage,
  engineStrings?: EngineStringsDb,
): PromptPlan {
  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      const plan = emptyPlan("Sua vez — escolha uma carta ou avance a fase.");

      message.summons.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Invocar",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_SUMMON,
            index,
          },
        });
      });

      message.special_summons.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Invocação-Especial",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,
            index,
          },
        });
      });

      message.monster_sets.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Baixar (monstro)",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_MONSTER_SET,
            index,
          },
        });
      });

      message.spell_sets.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Baixar",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_SPELL_SET,
            index,
          },
        });
      });

      message.pos_changes.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Mudar posição",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_POS_CHANGE,
            index,
          },
        });
      });

      message.activates.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Ativar",
          detail: effectDetail(card.description, engineStrings),
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.SELECT_ACTIVATE,
            index,
          },
        });
      });

      if (message.to_bp) {
        plan.global.push({
          label: "Ir para Battle Phase",
          tone: "primary",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.TO_BP,
            index: null,
          },
        });
      }

      if (message.to_ep) {
        plan.global.push({
          label: "Encerrar turno",
          response: {
            type: OcgResponseType.SELECT_IDLECMD,
            action: SelectIdleCMDAction.TO_EP,
            index: null,
          },
        });
      }

      return plan;
    }

    case OcgMessageType.SELECT_BATTLECMD: {
      const plan = emptyPlan("Battle Phase — escolha um monstro para atacar.");

      message.attacks.forEach((card, index) => {
        push(plan.byCard, card, {
          label: card.can_direct ? "Atacar direto" : "Atacar",
          response: {
            type: OcgResponseType.SELECT_BATTLECMD,
            action: SelectBattleCMDAction.SELECT_BATTLE,
            index,
          },
        });
      });

      message.chains.forEach((card, index) => {
        push(plan.byCard, card, {
          label: "Ativar",
          detail: effectDetail(card.description, engineStrings),
          response: {
            type: OcgResponseType.SELECT_BATTLECMD,
            action: SelectBattleCMDAction.SELECT_CHAIN,
            index,
          },
        });
      });

      if (message.to_m2) {
        plan.global.push({
          label: "Ir para Main Phase 2",
          tone: "primary",
          response: {
            type: OcgResponseType.SELECT_BATTLECMD,
            action: SelectBattleCMDAction.TO_M2,
            index: null,
          },
        });
      }

      if (message.to_ep) {
        plan.global.push({
          label: "Encerrar turno",
          response: {
            type: OcgResponseType.SELECT_BATTLECMD,
            action: SelectBattleCMDAction.TO_EP,
            index: null,
          },
        });
      }

      return plan;
    }

    case OcgMessageType.SELECT_YESNO:
    case OcgMessageType.SELECT_EFFECTYN: {
      const isEffect = message.type === OcgMessageType.SELECT_EFFECTYN;
      const plan = emptyPlan(
        isEffect ? "Ativar o efeito desta carta?" : "Confirmar?",
        "modal",
      );
      if (isEffect) {
        plan.subject = { code: message.code, location: message.location };
      }
      plan.global.push(
        {
          label: "Sim",
          tone: "primary",
          response: isEffect
            ? { type: OcgResponseType.SELECT_EFFECTYN, yes: true }
            : { type: OcgResponseType.SELECT_YESNO, yes: true },
        },
        {
          label: "Não",
          response: isEffect
            ? { type: OcgResponseType.SELECT_EFFECTYN, yes: false }
            : { type: OcgResponseType.SELECT_YESNO, yes: false },
        },
      );
      return plan;
    }

    case OcgMessageType.SELECT_OPTION: {
      const plan = emptyPlan("Escolha um efeito:", "modal");
      message.options.forEach((value, index) => {
        // O core manda um id empacotado, não o texto. Sem resolver, o jogador
        // escolhe entre "Opção 1" e "Opção 2" sem saber o que cada uma faz.
        const label =
          engineStrings?.describeOption(Number(value)) ?? `Opção ${index + 1}`;
        plan.global.push({
          label,
          tone: index === 0 ? "primary" : "default",
          response: { type: OcgResponseType.SELECT_OPTION, index },
        });
      });
      return plan;
    }

    case OcgMessageType.SELECT_POSITION: {
      const plan = emptyPlan("Escolha a posição de batalha:", "modal");
      if (message.code) plan.subject = { code: message.code, location: 0 };
      ocgPositionParse(message.positions).forEach((position) => {
        plan.global.push({
          label: POSITION_LABELS[position] ?? `Posição ${position}`,
          tone: position === OcgPosition.FACEUP_ATTACK ? "primary" : "default",
          response: { type: OcgResponseType.SELECT_POSITION, position },
        });
      });
      return plan;
    }

    case OcgMessageType.ROCK_PAPER_SCISSORS: {
      const plan = emptyPlan("Jokenpô — escolha:", "modal");
      ([
        [1, "Pedra"],
        [2, "Tesoura"],
        [3, "Papel"],
      ] as const).forEach(([value, label]) => {
        plan.global.push({
          label,
          response: { type: OcgResponseType.ROCK_PAPER_SCISSORS, value },
        });
      });
      return plan;
    }

    case OcgMessageType.ANNOUNCE_RACE: {
      const plural = message.count === 1 ? "" : "s";
      const plan = emptyPlan(`Declare ${message.count} raça${plural}:`, "modal");
      plan.announce = {
        count: message.count,
        options: ocgRaceParse(message.available).map((race) => ({
          label: translateOcgRace(race),
          value: race,
        })),
        build: (values) => ({
          type: OcgResponseType.ANNOUNCE_RACE,
          // `values` chega como bigint|number (canal genérico do PromptPlan) —
          // aqui é sempre bigint de verdade, BigInt() só normaliza o tipo.
          races: values.map((value) => BigInt(value)) as OcgRace[],
        }),
      };
      return plan;
    }

    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const plural = message.count === 1 ? "" : "s";
      const plan = emptyPlan(`Declare ${message.count} atributo${plural}:`, "modal");
      plan.announce = {
        count: message.count,
        options: ocgAttributeParse(message.available).map((attribute) => ({
          label: translateOcgAttribute(attribute),
          value: attribute,
        })),
        build: (values) => ({
          type: OcgResponseType.ANNOUNCE_ATTRIB,
          attributes: values.map((value) => Number(value)) as OcgAttribute[],
        }),
      };
      return plan;
    }

    case OcgMessageType.ANNOUNCE_CARD: {
      const plan = emptyPlan("Declare o nome de uma carta:", "modal");
      plan.announceCard = {
        opcodes: message.opcodes,
        build: (code) => ({ type: OcgResponseType.ANNOUNCE_CARD, card: code }),
      };
      return plan;
    }

    case OcgMessageType.ANNOUNCE_NUMBER: {
      const plan = emptyPlan("Declare um número:", "modal");
      // O core espera o ÍNDICE dentro de `options`, não o valor declarado —
      // por isso o rótulo mostra `value` mas a resposta carrega `index`.
      message.options.forEach((value, index) => {
        plan.global.push({
          label: value.toString(),
          tone: index === 0 ? "primary" : "default",
          response: { type: OcgResponseType.ANNOUNCE_NUMBER, value: index },
        });
      });
      return plan;
    }

    case OcgMessageType.SORT_CARD: {
      const plan = emptyPlan(
        "Escolha a ordem — a 1ª carta fica no topo do Deck.",
        "modal",
      );
      plan.sorting = {
        cards: candidatesOf(message.cards),
        build: (order) => ({
          type: OcgResponseType.SORT_CARD,
          order: order ? sortOrderForCore(order) : null,
        }),
      };
      plan.global.push({
        label: "Manter a ordem atual",
        response: { type: OcgResponseType.SORT_CARD, order: null },
      });
      return plan;
    }

    case OcgMessageType.SELECT_CHAIN: {
      // Sem popup, como no Master Duel: as cartas que podem responder brilham
      // na mesa (ou na pilha onde estão), e uma barra diz a que se responde e
      // oferece "Não responder". O diálogo de antes cobria justamente o campo
      // que a decisão de encadear precisa ver.
      //
      // A janela dos gatilhos (`isTriggerWindow`) usa a mesma mensagem, mas a
      // pergunta é outra: não é "responder a algo", é "ativar o efeito que a
      // minha carta acabou de acionar" — e passar o descarta de vez.
      const gatilho = isTriggerWindow(message);
      const plan = emptyPlan(
        gatilho
          ? message.forced
            ? "Efeitos obrigatórios ao mesmo tempo: escolha qual entra agora na corrente."
            : "Efeitos de gatilho disponíveis — qual ativar?"
          : message.forced
            ? "Você precisa encadear um efeito."
            : "Deseja responder com algum efeito?",
        "inline",
      );

      message.selects.forEach((card, index) => {
        push(plan.byCard, card, {
          label: gatilho ? "Ativar" : "Ativar em resposta",
          detail: effectDetail(card.description, engineStrings),
          response: { type: OcgResponseType.SELECT_CHAIN, index },
        });
      });

      if (!message.forced) {
        plan.global.push({
          label: gatilho ? "Não ativar" : "Não responder",
          tone: "primary",
          response: { type: OcgResponseType.SELECT_CHAIN, index: null },
        });
      }

      return plan;
    }

    case OcgMessageType.SELECT_CARD: {
      const plan = emptyPlan(
        `Selecione ${describeRange(message.min, message.max)} carta(s).`,
      );
      plan.selection = {
        min: message.min,
        max: message.max,
        keys: message.selects.map(keyOf),
        candidates: candidatesOf(message.selects),
        build: (indices) => ({
          type: OcgResponseType.SELECT_CARD,
          indicies: indices,
        }),
      };
      if (message.can_cancel) {
        plan.global.push({
          label: "Cancelar",
          response: { type: OcgResponseType.SELECT_CARD, indicies: null },
        });
      }
      return plan;
    }

    case OcgMessageType.SELECT_UNSELECT_CARD: {
      const plan = emptyPlan(
        message.can_finish
          ? "Clique para marcar ou desmarcar; \"Concluir\" quando terminar."
          : message.unselect_cards.length > 0
            ? "Marque mais uma carta (clique numa marcada para desfazer)."
            : "Selecione uma carta.",
      );
      const keys = [
        ...message.select_cards.map(keyOf),
        ...message.unselect_cards.map(keyOf),
      ];
      plan.selection = {
        min: 1,
        max: 1,
        keys,
        candidates: candidatesOf([
          ...message.select_cards,
          ...message.unselect_cards,
        ]),
        alreadyChosen: message.unselect_cards.map(
          (_, index) => message.select_cards.length + index,
        ),
        immediate: true,
        build: (indices) => ({
          type: OcgResponseType.SELECT_UNSELECT_CARD,
          index: indices[0] ?? 0,
        }),
      };
      if (message.can_cancel || message.can_finish) {
        plan.global.push({
          label: message.can_finish ? "Concluir" : "Cancelar",
          response: {
            type: OcgResponseType.SELECT_UNSELECT_CARD,
            index: null,
          },
        });
      }
      return plan;
    }

    case OcgMessageType.SELECT_TRIBUTE: {
      const plan = emptyPlan(
        `Escolha ${describeRange(message.min, message.max)} tributo(s).`,
      );
      plan.selection = {
        min: message.min,
        max: message.max,
        keys: message.selects.map(keyOf),
        candidates: candidatesOf(message.selects),
        build: (indices) => ({
          type: OcgResponseType.SELECT_TRIBUTE,
          indicies: indices,
        }),
      };
      // Desistir da Invocação-Tributo enquanto os tributos estão sendo
      // marcados. Quem escolhe "Invocar" e só então percebe que vai perder o
      // monstro errado precisa de saída — e o core permite: a resposta `null`
      // vira -1, que ele lê como cancelamento. A janela vai até a confirmação;
      // depois disso a invocação já aconteceu e não há mais o que desfazer.
      if (message.can_cancel) {
        plan.global.push({
          label: "Cancelar invocação",
          response: { type: OcgResponseType.SELECT_TRIBUTE, indicies: null },
        });
      }
      return plan;
    }

    case OcgMessageType.SELECT_COUNTER: {
      const counterName = engineStrings?.counterName(message.counter_type) ?? "marcador";
      const plan = emptyPlan(
        `Escolha de onde sai(em) ${message.count} ${counterName}.`,
        "modal",
      );
      // Antes: "cada carta escolhida recebe 1". Não expressava "tire 3 de uma
      // carta só", e o core recusava (RETRY) quando a escolha não somava N.
      plan.counters = {
        count: message.count,
        counterName,
        cards: message.cards.map((card) => ({
          code: card.code,
          controller: card.controller,
          location: card.location,
          sequence: card.sequence,
          max: card.count,
        })),
        build: (amounts) => ({ type: OcgResponseType.SELECT_COUNTER, counters: amounts }),
      };
      return plan;
    }

    case OcgMessageType.SELECT_SUM: {
      const request = sumRequestOf(message);
      const exact = request.mode === "exact";
      const plan = emptyPlan(
        exact
          ? `Escolha ${describeRange(request.min, Math.max(request.max, request.min))} carta(s) somando exatamente ${message.amount}.`
          : `Escolha cartas somando ${message.amount} ou mais (ex.: Níveis para o Ritual), sem carta sobrando.`,
      );
      plan.selection = {
        // No modo "igual ou maior" as obrigatórias podem já bastar: zero cartas
        // extras é válido, e exigir 1 sempre travava a confirmação.
        min: exact ? request.min : 0,
        max: exact ? Math.max(request.max, request.min) : message.selects.length,
        keys: message.selects.map(keyOf),
        candidates: candidatesOf(message.selects),
        // Já entram na soma sem o jogador marcar; não fazem parte da resposta.
        locked: candidatesOf(message.selects_must),
        build: (indices) => ({
          type: OcgResponseType.SELECT_SUM,
          indicies: indices,
        }),
        isValid: (indices) => isValidSum(request, indices),
        progress: (indices) => sumProgress(request, indices),
      };
      return plan;
    }

    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const isDisfield = message.type === OcgMessageType.SELECT_DISFIELD;
      const places = decodeFieldMask(message.field_mask, message.player);
      const buildResponse = (chosen: SelectFieldPlace[]): OcgResponse =>
        isDisfield
          ? { type: OcgResponseType.SELECT_DISFIELD, places: chosen }
          : { type: OcgResponseType.SELECT_PLACE, places: chosen };

      const plan = emptyPlan(
        message.count > 1
          ? `Escolha ${message.count} zonas do campo.`
          : "Escolha uma zona do campo.",
      );

      if (message.count > 1) {
        // Mais de uma zona por vez: clicar já respondendo deixaria zona
        // faltando (RETRY do core) — marca no campo e confirma, como a
        // seleção múltipla de cartas.
        plan.placeSelection = { count: message.count, places, build: buildResponse };
      } else {
        plan.places = places.map((place) => ({ place, response: buildResponse([place]) }));
      }
      return plan;
    }

    default:
      return emptyPlan("");
  }
}

const POSITION_LABELS: Record<number, string> = {
  [OcgPosition.FACEUP_ATTACK]: "Ataque (face p/ cima)",
  [OcgPosition.FACEDOWN_ATTACK]: "Ataque (face p/ baixo)",
  [OcgPosition.FACEUP_DEFENSE]: "Defesa (face p/ cima)",
  [OcgPosition.FACEDOWN_DEFENSE]: "Defesa (face p/ baixo)",
};

function describeRange(min: number, max: number): string {
  if (min === max) return `${min}`;
  return `${min} a ${max}`;
}

/** Rótulo curto de uma localização — usado no menu de contexto da carta. */
export function locationLabel(location: number): string {
  switch (location) {
    case OcgLocation.HAND:
      return "Mão";
    case OcgLocation.MZONE:
      return "Zona de Monstro";
    case OcgLocation.SZONE:
      return "Zona de Magia/Armadilha";
    case OcgLocation.GRAVE:
      return "Cemitério";
    case OcgLocation.REMOVED:
      return "Banidas";
    case OcgLocation.DECK:
      return "Deck";
    case OcgLocation.EXTRA:
      return "Extra Deck";
    default:
      return "Campo";
  }
}

/**
 * Filtro de ANNOUNCE_CARD (Duel.AnnounceCard) — o core manda uma pilha RPN de
 * `OcgOpCode` que, avaliada carta a carta, diz se aquele nome é declarável.
 * Só os operadores unários/binários "puros" (booleanos e aritméticos) são
 * avaliados aqui; ver `announceCardMatches` para os que exigem dado cru.
 */
const ANNOUNCE_UNARY_OPS = new Map<bigint, (a: bigint) => bigint>([
  [OcgOpCode.NOT, (a) => (a === 0n ? 1n : 0n)],
  [OcgOpCode.NEG, (a) => -a],
  [OcgOpCode.BNOT, (a) => ~a],
]);

const ANNOUNCE_BINARY_OPS = new Map<bigint, (a: bigint, b: bigint) => bigint>([
  [OcgOpCode.ADD, (a, b) => a + b],
  [OcgOpCode.SUB, (a, b) => a - b],
  [OcgOpCode.MUL, (a, b) => a * b],
  [OcgOpCode.DIV, (a, b) => (b === 0n ? 0n : a / b)],
  [OcgOpCode.AND, (a, b) => (a !== 0n && b !== 0n ? 1n : 0n)],
  [OcgOpCode.OR, (a, b) => (a !== 0n || b !== 0n ? 1n : 0n)],
  [OcgOpCode.BAND, (a, b) => a & b],
  [OcgOpCode.BOR, (a, b) => a | b],
  [OcgOpCode.BXOR, (a, b) => a ^ b],
  [OcgOpCode.LSHIFT, (a, b) => a << b],
  [OcgOpCode.RSHIFT, (a, b) => a >> b],
]);

/**
 * Operadores que precisam de dado cru que o registry não guarda: setcode,
 * ou a máscara numérica de tipo/raça/atributo (o `CardDefinition` do
 * catálogo só tem os textos já traduzidos para exibição — "Effect Monster",
 * "Zombie", "DARK" — não os bitmasks originais do ocgcore).
 */
const ANNOUNCE_UNSUPPORTED_OPS = new Set<bigint>([
  OcgOpCode.ISSETCARD,
  OcgOpCode.ISRACE,
  OcgOpCode.ISATTRIBUTE,
  OcgOpCode.GETCODE,
  OcgOpCode.GETSETCARD,
  OcgOpCode.GETTYPE,
  OcgOpCode.GETRACE,
  OcgOpCode.GETATTRIBUTE,
]);

/** TYPE_MONSTER e TYPE_EXTRA — os dois únicos literais de ISTYPE que os scripts do pool Goat usam. */
const ANNOUNCE_TYPE_MONSTER = BigInt(OcgType.MONSTER);
const ANNOUNCE_TYPE_EXTRA = BigInt(
  OcgType.FUSION | OcgType.SYNCHRO | OcgType.XYZ | OcgType.LINK,
);

/**
 * Decide se `card` é um nome válido para um prompt ANNOUNCE_CARD.
 *
 * Avalia a pilha RPN de opcodes contra os dados que o registry realmente tem
 * (nome, `type` e `frameType` em texto). Isso já cobre o padrão dominante nos
 * scripts do pool Goat — `[TYPE_EXTRA, ISTYPE, NOT]` ("não pode ser monstro
 * de Extra Deck") e variações com AND/OR — porque o pool não tem Synchro/Xyz/
 * Link/Pendulum: "Extra Deck" aqui é sinônimo de `frameType === "fusion"`.
 *
 * Quando a pilha usa algo que não dá pra avaliar com esses dados (setcode,
 * raça, atributo) ou não fecha num resultado booleano único, devolve `true`
 * — sem filtro confiável é mais seguro liberar o pool inteiro do que travar
 * o duelo de novo com uma restrição inventada.
 */
export function announceCardMatches(
  opcodes: readonly OcgOpCode[],
  card: CardDefinition,
  /**
   * Dados oficiais da carta. Com eles a avaliação é a MESMA do core
   * (`announce-filter.ts`); sem eles cai na aproximação abaixo, que só lê o
   * tipo em texto e libera o resto.
   */
  official?: OfficialCardData | null,
): boolean {
  if (official) {
    return isDeclarable(opcodes as readonly bigint[], {
      code: card.passcode,
      alias: official.alias,
      type: official.type,
      race: official.race,
      attribute: official.attribute,
      setcodes: official.setcodes,
    });
  }
  if (opcodes.length === 0) return true;

  const isMonster = card.type.includes("Monster");
  const isExtraDeck = card.frameType === "fusion";

  const stack: bigint[] = [];
  for (const value of opcodes) {
    if (value === OcgOpCode.ALLOW_ALIASES || value === OcgOpCode.ALLOW_TOKENS) {
      continue; // flags do engine — não empilham nada
    }

    if (value === OcgOpCode.ISTYPE) {
      const a = stack.pop();
      if (a === ANNOUNCE_TYPE_MONSTER) stack.push(isMonster ? 1n : 0n);
      else if (a === ANNOUNCE_TYPE_EXTRA) stack.push(isExtraDeck ? 1n : 0n);
      else return true; // máscara de tipo que não sabemos decodificar
      continue;
    }

    if (value === OcgOpCode.ISCODE) {
      const a = stack.pop();
      if (a === undefined) return true;
      stack.push(a === BigInt(card.passcode) ? 1n : 0n);
      continue;
    }

    const unary = ANNOUNCE_UNARY_OPS.get(value);
    if (unary) {
      const a = stack.pop();
      if (a === undefined) return true;
      stack.push(unary(a));
      continue;
    }

    const binary = ANNOUNCE_BINARY_OPS.get(value);
    if (binary) {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return true;
      stack.push(binary(a, b));
      continue;
    }

    if (ANNOUNCE_UNSUPPORTED_OPS.has(value)) return true;

    // Não é um operador conhecido: é um literal (código, máscara...) —
    // empilha para o próximo operador consumir.
    stack.push(value);
  }

  // Pilha malformada, ou um literal "solto" sem operador que o consuma (ex.:
  // Question empilha só TYPE_MONSTER, sem ISTYPE) — o resultado é ambíguo, e
  // liberar é mais seguro do que barrar por engano.
  return stack.length === 1 ? stack[0] !== 0n : true;
}
