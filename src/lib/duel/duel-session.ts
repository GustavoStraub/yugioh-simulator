import {
  OcgCardHintType,
  OcgDuelMode,
  OcgHintType,
  OcgLocation,
  OcgPlayerHintType,
  OcgLogType,
  OcgMessageType,
  OcgPhase,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response";
import { chainWindowSkip, type ChainResponseMode } from "@/lib/duel/chain-mode";
import { browserAssets } from "@/lib/duel/browser-assets";
import type { DuelAssets } from "@/lib/duel/duel-assets";
import type {
  DuelEvent,
  DuelEventListener,
  DuelZoneRef,
  LeaveReason,
} from "@/lib/duel/duel-events";
import {
  readBoardState,
  type BoardState,
  type CardHint,
} from "@/lib/duel/board-state";
import {
  cardDefinitionToOcgData,
  genericTokenData,
  isTokenCard,
} from "@/lib/duel/card-adapter";
import { findPromptMessage } from "@/lib/duel/bot-responder";
import { BotBrain, type BotContext } from "@/lib/duel/bot/bot-brain";
import { beatFor, leaveBeat, phaseBeat, MAX_BEAT_PER_BATCH_MS } from "@/lib/duel/pacing";
import { phaseLabel } from "@/lib/duel/phase-labels";
import {
  EMPTY_ENGINE_STRINGS,
  type EngineStringsDb,
} from "@/lib/duel/engine-strings";
import {
  EMPTY_CARD_DB,
  type OfficialCardDb,
} from "@/lib/duel/official-card-data";
import { maskHiddenCards, maskKey } from "@/lib/duel/prompt-mask";
import {
  describeWinReason,
  EXODIA_PECAS,
  WIN_REASON,
} from "@/lib/duel/win-reason";
import { preloadCoreScripts, preloadDuelScripts } from "@/lib/duel/script-reader";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { DEFAULT_FORMAT, FORMAT_RULES } from "@/lib/types";
import type { CardDefinition, DuelDeckPayload, DuelFormat } from "@/lib/types";

/**
 * Quem responde por um assento.
 *
 * - `local` — a UI desta aba; a sessão estaciona e espera o clique.
 * - `remote` — alguém do outro lado de um socket; a sessão estaciona igual, e
 *   quem roteia a pergunta é o dono da sala.
 * - `bot` — respondido na hora por `botAutoResponse`, sem nunca chegar à tela.
 *
 * Do ponto de vista do laço de mensagens `local` e `remote` são a mesma coisa;
 * a distinção existe para o `refreshField` saber de quais óticas alguém precisa
 * (ler o tabuleiro do bot seria dobrar as chamadas ao WASM para ninguém olhar).
 */
export type SeatKind = "local" | "remote" | "bot";

export interface SeatConfig {
  kind: SeatKind;
  /** Nome usado na narração do log ("Você invocou...", "Gustavo invocou..."). */
  name: string;
  /**
   * Quando perguntar "deseja responder?" a este assento (ver `chain-mode.ts`).
   * Omitido = automático. Só vale para assento humano; trocável no meio do
   * duelo por `setChainPreference`.
   */
  chainMode?: ChainResponseMode;
}

/** Duelo de hoje: você embaixo, bot em cima. */
const DEFAULT_SEATS: [SeatConfig, SeatConfig] = [
  { kind: "local", name: "Você" },
  { kind: "bot", name: "O oponente" },
];

/**
 * Uma carta já em jogo quando o duelo começa (ver `DuelSessionConfig.scenario`).
 * `location`/`position` são os valores do core (`OcgLocation`/`OcgPosition`).
 */
export interface ScenarioCard {
  player: 0 | 1;
  location: number;
  sequence?: number;
  position?: number;
  code: number;
}

/** Onde um cenário pode pôr carta — nada de Deck reordenado ou zona inventada. */
const SCENARIO_LOCATIONS = new Set<number>([
  OcgLocation.HAND,
  OcgLocation.MZONE,
  OcgLocation.SZONE,
  OcgLocation.GRAVE,
  OcgLocation.REMOVED,
  OcgLocation.EXTRA,
]);

export interface DuelSessionConfig {
  playerName: string;
  playerDeck: DuelDeckPayload;
  opponentName: string;
  opponentDeck: DuelDeckPayload;
  registry: CardRegistry;
  /** Quem responde cada assento. Omitido = jogador local contra o bot. */
  seats?: [SeatConfig, SeatConfig];
  /** De onde vêm wasm, scripts e dados. Omitido = navegador. */
  assets?: DuelAssets;
  /**
   * Regras do duelo. Omitido = Goat, o formato de todo deck salvo antes do
   * TCG existir no app.
   */
  format?: DuelFormat;
  /**
   * Mesa de teste: cartas que já começam em jogo, além dos decks.
   *
   * Existe para os testes de navegador e as capturas chegarem direto a uma
   * situação (um Link na Zona Extra, escalas armadas) sem jogar dez turnos —
   * o mesmo `place` do harness. Não há caminho para isto na interface nem no
   * duelo online: só quem monta o duelo por código.
   */
  scenario?: ScenarioCard[];
  /**
   * Multiplicador das pausas entre jogadas (ver `pacing.ts`): 1 = ritmo
   * normal, menos = mais rápido, 0 = sem pausa nenhuma (testes). Trocável no
   * meio do duelo por `setPace`.
   */
  pace?: number;
}

/**
 * Uma linha do histórico.
 *
 * `visibleTo` é o assento que pode lê-la; `null` é público. Existe porque o log
 * narra revelações de carta — e uma revelação dirigida a um jogador, mostrada
 * aos dois, entrega justamente a informação que o efeito escondeu.
 */
export interface DuelLogEntry {
  text: string;
  visibleTo: 0 | 1 | null;
  /**
   * Que tipo de linha é. Ausente = uma jogada.
   *
   * A tela usa para dar peso — o turno vira separador, a fase fica discreta —
   * e para tirar do histórico o que não é jogo: o progresso da carga
   * (`system`) e as dicas do core sobre a escolha em curso (`hint`, "Selecione
   * o(s) card(s) para usar como Matéria de Sincro"), que já aparecem onde
   * servem, na barra da seleção. Antes as duas enchiam o histórico de linhas
   * que nenhum jogador lia.
   */
  kind?: "turn" | "phase" | "hint" | "system";
  /**
   * Cartas citadas na linha, só as públicas — passar o mouse na linha mostra a
   * primeira na leitura da carta. Atravessa a rede no online, e por isso nunca
   * leva o código de uma carta que a linha não nomeia.
   */
  codes?: number[];
  /** Assento que agiu ou de quem é a carta — a tela pinta a linha com a cor dele. */
  actor?: 0 | 1;
}

/**
 * Motivos que o core guarda na carta (`REASON_*` de constant.lua) — só os que
 * mudam a frase do histórico.
 */
const REASON = {
  DESTROY: 0x1,
  RELEASE: 0x2,
  MATERIAL: 0x8,
  BATTLE: 0x20,
  FUSION: 0x40000,
  SYNCHRO: 0x80000,
  RITUAL: 0x100000,
  XYZ: 0x200000,
  LINK: 0x10000000,
} as const;

/**
 * Uma revelação que já aconteceu, guardada para poder ser reconsultada.
 *
 * O aviso na tela dura poucos segundos, e é justamente nele que mora a
 * informação mais decisiva do duelo — o que o Boneca Chamariz mostrou, o que o
 * Espião viu, qual carta o adversário olhou da sua mão. Perder o momento
 * significava perder o dado; por isso a lista fica no snapshot em vez de viver
 * só na animação.
 *
 * `visibleTo` é o assento com direito de ver os códigos — o mesmo recorte do
 * log, e por isso `projectSnapshot` filtra os dois juntos.
 */
export interface DuelReveal {
  id: number;
  visibleTo: 0 | 1;
  title: string;
  codes: number[];
  /** Turno em que aconteceu — sem isso o histórico é uma lista sem contexto. */
  turn: number | null;
}

/** Quantas revelações o histórico guarda. */
const MAX_REVEALS = 14;

/**
 * "de onde" uma ativação veio, para o histórico — só as origens que não são o
 * campo, que é o caso que o jogador já enxerga. É o que transforma "o oponente
 * ativou Ash Blossom" em "…Ash Blossom (da mão)".
 */
const ORIGIN_LABEL: Partial<Record<number, string>> = {
  [OcgLocation.HAND]: "da mão",
  [OcgLocation.GRAVE]: "do Cemitério",
  [OcgLocation.REMOVED]: "das banidas",
  [OcgLocation.DECK]: "do Deck",
  [OcgLocation.EXTRA]: "do Extra Deck",
};


/**
 * O elo de corrente que está em jogo agora.
 *
 * Existe para o modal de resposta poder dizer **a que** se está respondendo: o
 * core pergunta "deseja responder com algum efeito?" sem nunca repetir o que
 * acabou de ser ativado, e a linha do log já rolou para longe quando o modal
 * aparece. Sem isto a decisão mais importante do jogo — encadear ou não — é
 * tomada às cegas.
 *
 * Vive entre o `CHAINING` e o `CHAIN_END`; fora de uma corrente é `null`.
 */
export interface DuelChainLink {
  code: number;
  /** Assento que ativou. */
  player: number;
  /** Nome desse assento, já resolvido — o mesmo que o log usa. */
  playerName: string;
  /** Texto do efeito ativado, quando o engine diz qual foi. */
  description: string | null;
  /** Número do elo (1 = o primeiro a entrar, o último a resolver). */
  link: number;
  /**
   * De onde a carta foi ativada (`OcgLocation`): mão, campo, Cemitério… É o
   * que diz "foi uma hand trap" — a Ash Blossom sai da mão e, sem isto, só se
   * via a carta já no Cemitério.
   */
  from: number;
  /** Onde a carta está agora — para o número do elo aparecer no slot dela. */
  zone: DuelZoneRef;
  /**
   * `pending` na corrente; `resolving` enquanto resolve; `resolved` depois;
   * `negated` quando a ATIVAÇÃO foi negada; `disabled` quando o EFEITO foi
   * negado (a Ash nega o efeito do elo anterior — ele ainda "resolve", sem
   * fazer nada, e precisa continuar marcado como negado).
   */
  state: "pending" | "resolving" | "resolved" | "negated" | "disabled";
}

export interface DuelSnapshot {
  /**
   * Formato do duelo em andamento.
   *
   * A mesa precisa dele para desenhar o que a regra tem: Zonas de Monstro
   * Extra e escalas de Pêndulo só existem no TCG — no Goat a mesa continua a
   * de 2005, com cinco zonas por fileira.
   */
  format: DuelFormat;
  /**
   * Tabuleiro na ótica de cada assento — `null` onde ninguém olha (o bot).
   *
   * É por ótica, e não um estado só, porque a máscara de carta virada e de mão
   * do oponente é resolvida na leitura (`readBoardState`): um tabuleiro único
   * teria que escolher de quem esconder o quê, e num duelo entre dois humanos
   * não existe escolha certa.
   */
  boards: [BoardState | null, BoardState | null];
  lifePoints: [number, number];
  turnPlayer: number | null;
  /** Turnos já iniciados — o 1 é o primeiro do duelo. */
  turnCount: number;
  phase: number | null;
  /** Efeito em cima da corrente agora, ou `null` fora de uma corrente. */
  chain: DuelChainLink | null;
  /**
   * A corrente inteira, do elo 1 ao último — vazia fora de uma corrente.
   * Pública: tudo o que entra numa corrente é revelado ao ativar.
   */
  chainLinks: DuelChainLink[];
  log: DuelLogEntry[];
  /** Revelações já ocorridas, da mais antiga para a mais recente. */
  reveals: DuelReveal[];
  /**
   * Avisos que valem para um JOGADOR, não para uma carta ("não pode
   * Invocar-Especial neste turno", "não recebe dano neste turno"), por assento
   * e já em texto. São públicos: a mesa mostra junto do LP de cada um.
   */
  playerHints: [string[], string[]];
  /**
   * Zonas inutilizadas agora (`FIELD_DISABLED`), na máscara do core e na ótica
   * do jogador 0: bits 0–6 monstros e 8–12 magias dele, 16–22 e 24–28 do
   * jogador 1. A mesa hachura essas zonas.
   */
  disabledZones: number;
  winner: number | null;
  /**
   * Por que o duelo acabou, em uma frase — "Os pontos de vida de X chegaram a
   * 0", "Exodia obliterou!".
   *
   * O core diz o motivo (`WIN.reason`) e a tela só mostrava quem ganhou. Num
   * duelo em que o adversário se rende, ou perde por não ter carta para
   * comprar, o resultado aparecia sem nenhuma explicação — e são justamente os
   * finais que não passam pelo dano, aquele que a barra de LP já conta.
   */
  winReason: string | null;
  /**
   * Pergunta do engine ao assento de `promptPlayer`.
   *
   * Já **mascarada** (`maskHiddenCards`): os candidatos que esse assento não
   * tem direito de ver chegam com `code: 0`. O core manda o passcode de todo
   * candidato, inclusive de carta na mão do adversário.
   */
  pendingPrompt: OcgMessage | null;
  /** Assento de quem o engine espera resposta — alimenta o "aguardando...". */
  promptPlayer: 0 | 1 | null;
  /**
   * Identifica o prompt corrente. A resposta que vem pela rede precisa citá-lo:
   * um clique atrasado responderia uma pergunta que o core já passou, e isso
   * cai no laço de RETRY que `MAX_CONSECUTIVE_RETRIES` existe para matar.
   */
  promptId: number;
  /** Carta a que o prompt atual se refere, quando o core informa via HINT. */
  promptCard: number | null;
  /**
   * O que a pergunta atual pede, em texto — a dica `SELECTMSG` que o core
   * manda antes de cada escolha ("Selecione o(s) card(s) para usar como
   * Matéria de Sincro"). A barra de seleção mostra isto no lugar do genérico
   * "Selecione 1 carta"; `null` quando o core não disse.
   */
  promptHint: string | null;
  isProcessing: boolean;
  error: string | null;
}

/**
 * Flags do core por formato.
 *
 * `MODE_GOAT` liga as regras de 2005 que o core implementa (compra no primeiro
 * turno, uma Magia de Campo por vez, prioridade de Ignição, Damage Step de
 * seis passos); `MODE_MR5` é a Master Rule 2020, a vigente.
 */
const DUEL_FLAGS: Record<DuelFormat, bigint> = {
  goat: OcgDuelMode.MODE_GOAT,
  tcg: OcgDuelMode.MODE_MR5,
};

/** Um RETRY é recuperável; muitos seguidos significam resposta impossível. */
const MAX_CONSECUTIVE_RETRIES = 5;

/**
 * Um `Error: eof` do binding ao desserializar uma mensagem é recuperável (ver
 * comentário em `runLoop`); muitos seguidos sem nenhuma mensagem válida no
 * meio é que indicam algo mais grave do que uma notificação perdida.
 */
const MAX_CONSECUTIVE_BINDING_ERRORS = 3;

/** Tipos de HINT que carregam texto legível, e não um código interno. */
const HINT_TEXT_TYPES = new Set<number>([
  OcgHintType.MESSAGE,
  OcgHintType.SELECTMSG,
  OcgHintType.OPSELECTED,
]);

/** Mensagens que representam algo que o jogador precisa ver acontecer. */
const PLAY_EVENTS = new Set<OcgMessageType>([
  OcgMessageType.SUMMONING,
  OcgMessageType.SPSUMMONING,
  OcgMessageType.FLIPSUMMONING,
  OcgMessageType.SET,
  OcgMessageType.CHAINING,
  OcgMessageType.CHAIN_SOLVING,
  OcgMessageType.CHAIN_NEGATED,
  OcgMessageType.CHAIN_DISABLED,
  OcgMessageType.ATTACK,
  OcgMessageType.BATTLE,
  OcgMessageType.POS_CHANGE,
  OcgMessageType.DAMAGE,
  OcgMessageType.RECOVER,
  OcgMessageType.MOVE,
  OcgMessageType.TOSS_COIN,
  OcgMessageType.TOSS_DICE,
  OcgMessageType.CONFIRM_CARDS,
  OcgMessageType.CONFIRM_DECKTOP,
  // A compra também precisa atualizar o campo aqui, e não só emitir o evento:
  // a animação da carta comprada mira no slot REAL onde ela vai parar, então
  // ela depende de a mão já ter sido redesenhada quando começa. Sem isto o
  // voo era medido contra a mão antiga e a carta pousava na posição errada.
  OcgMessageType.DRAW,
]);

/**
 * Monstro Normal sem efeito — o core lida com ele sem script nenhum, então a
 * ausência de script não é problema. Serve para não alarmar à toa.
 */
function isVanilla(card: CardDefinition): boolean {
  if (isTokenCard(card)) return true;
  return card.frameType === "normal" && card.type === "Normal Monster";
}

/** Embaralhamento Fisher-Yates — não altera o array recebido. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Seed de 4 x 64 bits para o RNG do core — um duelo diferente a cada partida. */
function randomSeed(): [bigint, bigint, bigint, bigint] {
  const words = crypto.getRandomValues(new BigUint64Array(4));
  return [words[0], words[1], words[2], words[3]];
}

export class DuelSession {
  private core: OcgCoreSync | null = null;
  private handle: OcgDuelHandle | null = null;
  private snapshot: DuelSnapshot = createInitialSnapshot();
  private listeners = new Set<(snapshot: DuelSnapshot) => void>();
  private scriptCache = new Map<string, string>();
  private running = false;
  private started = false;
  /** Catálogo de cartas — usado para narrar as jogadas pelo nome. */
  private registry: CardRegistry | null = null;
  /** Quem responde cada assento; definido no `start`. */
  private seats: [SeatConfig, SeatConfig] = DEFAULT_SEATS;
  /** De onde vêm wasm, scripts e dados; definido no `start`. */
  private assets: DuelAssets = browserAssets;
  /** Contador dos prompts publicados — ver `DuelSnapshot.promptId`. */
  private promptCounter = 0;
  /** Último prompt emitido — reusado quando o core devolve RETRY. */
  private lastPrompt: OcgMessage | null = null;
  /** Respostas seguidas rejeitadas pelo core, para não entrar em loop infinito. */
  private consecutiveRetries = 0;
  /** Mensagens seguidas que o binding não conseguiu desserializar (ver runLoop). */
  private consecutiveBindingErrors = 0;
  /** Ouvintes de eventos transitórios (animação e som). */
  private eventListeners = new Set<DuelEventListener>();
  /** Passcode da última carta apontada por um HINT — contexto dos prompts. */
  private hintedCard: number | null = null;
  /** Texto da última dica de seleção (`HINT SELECTMSG`) — ver `promptHint`. */
  private selectHint: string | null = null;
  /** Dados oficiais das cartas (setcode, alias, type) — regras do engine. */
  private cardDb: OfficialCardDb = EMPTY_CARD_DB;
  /** Textos que o engine referencia por id (instruções, opções de efeito). */
  private engineStrings: EngineStringsDb = EMPTY_ENGINE_STRINGS;
  /**
   * Cartas que cada assento tem direito de ver na resolução CORRENTE, por
   * identidade de zona (`maskKey`).
   *
   * Alimenta a máscara do prompt (`maskHiddenCards`): é o que separa o Confisco
   * — que revela a mão antes de pedir a escolha, e portanto tem que mostrar as
   * faces — do Espião Inexperiente, que pede a escolha primeiro e só revela
   * depois. Zerado quando a resolução termina: uma sequência guardada além dela
   * apontaria para a carta que ocupou aquela posição depois, e aí a máscara
   * vazaria justamente o que existe para esconder.
   */
  private revealedTo: [Set<string>, Set<string>] = [new Set(), new Set()];
  /** Id incremental das revelações do histórico. */
  private revealCounter = 0;
  /**
   * Marcas que o engine anuncia por mensagem (`CARD_HINT`), por zona do campo.
   *
   * Não existe consulta que as devolva: o EDOPro guarda no objeto da carta, do
   * lado do cliente. Aqui a sessão faz o papel desse objeto — a marca anda
   * junto no `MOVE` (troca de controle, mudança de zona) e some quando a carta
   * sai do campo, porque a posição sozinha não identifica a carta: a mesma
   * zona recebe outra carta depois.
   *
   * Cada zona tem UMA marca de valor (turnos, declaração — a nova substitui a
   * anterior, como no EDOPro) e os avisos de texto com contagem (o mesmo aviso
   * pode vir de dois efeitos, e só sai quando os dois acabam).
   */
  private cardHints = new Map<
    string,
    { value: CardHint | null; descs: Map<string, number> }
  >();
  /** Avisos por jogador (`PLAYER_HINT`), texto → quantas vezes está ativo. */
  private playerHintCounts: [Map<string, number>, Map<string, number>] = [
    new Map(),
    new Map(),
  ];
  /**
   * Um cérebro por assento de bot.
   *
   * Guarda estado entre prompts (o alvo do ataque já escolhido, quantas jogadas
   * já foram feitas no turno), então precisa sobreviver de uma pergunta para a
   * seguinte — e ser separado por assento, porque num duelo bot contra bot os
   * dois estão decidindo ao mesmo tempo.
   */
  private readonly brains = new Map<0 | 1, BotBrain>();
  /** Modo de resposta de cada assento — ver `chain-mode.ts`. */
  private chainModes: [ChainResponseMode, ChainResponseMode] = ["auto", "auto"];
  /**
   * "Segurando Ctrl": enquanto valer, o assento é perguntado em toda janela,
   * qualquer que seja o modo. É o *hold* do Master Duel — o jeito de parar
   * numa janela que o automático pularia (a Standby do oponente, para um MST).
   */
  private forceAsk: [boolean, boolean] = [false, false];
  /** Multiplicador das pausas — ver `DuelSessionConfig.pace`. */
  private pace = 1;
  /** Encerra a pausa em curso, quando há uma — ver `hurry`. */
  private endPause: (() => void) | null = null;
  /**
   * Pausa pedida pelas saídas do campo deste lote (ver `narrateFieldExit`).
   *
   * O `MOVE` tem batida mínima porque dispara para toda troca de zona; uma
   * destruição precisa de mais — é o tempo do fantasma da carta se desfazer na
   * zona de onde saiu. Zerado a cada lote.
   */
  private leaveBeatWanted = 0;

  subscribe(listener: (snapshot: DuelSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DuelSnapshot {
    return this.snapshot;
  }

  /** Assina os eventos transitórios do duelo (invocação, ataque, dano...). */
  subscribeEvents(listener: DuelEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: DuelEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  async start(config: DuelSessionConfig): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.registry = config.registry;
    this.seats = config.seats ?? DEFAULT_SEATS;
    // O que o assento trouxe vale; senão fica o que a tela já pediu antes do
    // `start` (a preferência pode chegar antes de o duelo carregar).
    this.chainModes = [
      this.seats[0].chainMode ?? this.chainModes[0],
      this.seats[1].chainMode ?? this.chainModes[1],
    ];
    this.setPace(config.pace ?? this.pace);
    this.assets = config.assets ?? browserAssets;
    const format = config.format ?? DEFAULT_FORMAT;
    const rules = FORMAT_RULES[format];
    this.update({ error: null, isProcessing: true, log: [], format });
    this.appendLog("Carregando engine...", null, { kind: "system" });

    /** Códigos que o catálogo não tinha — quase sempre fichas. */
    const unknownCodes = new Set<number>();

    try {
      const scenario = (config.scenario ?? []).filter(
        (card) =>
          (card.player === 0 || card.player === 1) &&
          SCENARIO_LOCATIONS.has(card.location) &&
          Number.isInteger(card.code),
      );
      const allPasscodes = [
        ...config.playerDeck.main,
        ...config.playerDeck.extra,
        ...config.opponentDeck.main,
        ...config.opponentDeck.extra,
        ...scenario.map((card) => card.code),
      ];
      this.appendLog("Carregando scripts base do engine...", null, { kind: "system" });
      const [{ core: coreScripts, support, patchesAusentes }, cardDb, engineStrings] =
        await Promise.all([
          preloadCoreScripts(this.assets.fetchScript),
          this.assets.cardDb(),
          this.assets.engineStrings(),
        ]);
      this.cardDb = cardDb;
      this.engineStrings = engineStrings;

      // Uma emenda que não encontrou seu trecho é uma correção que evaporou:
      // o script voltou ao original e as cartas que ela consertava quebram de
      // novo, sem nada na tela indicando o motivo.
      if (patchesAusentes.length > 0) {
        this.appendLog(
          `⚠ Correção local não aplicada (${patchesAusentes.join(", ")}) — ` +
            "o script base mudou; ver src/lib/duel/script-patches.ts.",
        );
      }

      this.appendLog("Carregando scripts das cartas...", null, { kind: "system" });
      const { cache, viaAlias, missing } = await preloadDuelScripts(
        allPasscodes,
        cardDb,
        this.assets.fetchScript,
      );
      this.scriptCache = cache;

      if (viaAlias.length > 0) {
        this.appendLog(
          `${viaAlias.length} carta(s) usando script do passcode original.`,
          null,
          { kind: "system" },
        );
      }

      // Cartas com efeito e sem script ficam inertes. Avisar é essencial:
      // antes isso era silencioso e a carta simplesmente não podia ser ativada.
      const inert = missing.filter((passcode) => {
        const card = config.registry.get(passcode);
        return card ? !isVanilla(card) : false;
      });
      if (inert.length > 0) {
        this.appendLog(
          `⚠ Sem script (não terão efeito): ${inert
            .map((passcode) => this.cardName(passcode))
            .join(", ")}`,
        );
      }

      // constant.lua/utility.lua pedem esses via Duel.LoadScript durante o
      // loadScript() abaixo, e o scriptReader é síncrono — logo precisam já
      // estar no cache.
      for (const [name, content] of support) {
        this.scriptCache.set(name, content);
      }

      this.core = await this.assets.loadCore((message) =>
        this.appendLog(`[core] ${message}`, null, { kind: "system" }),
      );

      const core = this.core;
      const team = {
        startingLP: rules.startingLp,
        startingDrawCount: rules.startingHandSize,
        drawCountPerTurn: rules.drawPerTurn,
      };
      const handle = core.createDuel({
        flags: DUEL_FLAGS[format],
        seed: randomSeed(),
        team1: team,
        team2: team,
        cardReader: (code) => {
          const card = config.registry.get(code);
          if (card) return cardDefinitionToOcgData(card, this.cardDb);
          // Códigos fora do catálogo são, na prática, fichas criadas por
          // efeitos. Devolver null aqui quebrava a carta que as cria.
          unknownCodes.add(code);
          return genericTokenData(code, this.cardDb);
        },
        scriptReader: (name) => this.readScript(name),
        errorHandler: (type, text) => {
          if (type === OcgLogType.ERROR) {
            this.appendLog(`Erro: ${text}`);
          }
        },
      });

      if (!handle) {
        throw new Error("Não foi possível criar o duelo.");
      }

      this.handle = handle;

      // constant.lua e utility.lua precisam estar no estado Lua antes de
      // qualquer carta ser criada — é deles que vem GetID(), aux e as
      // constantes que todo script de carta usa na primeira linha.
      for (const [name, content] of coreScripts) {
        const ok = await this.core.loadScript(handle, name, content);
        if (!ok) {
          throw new Error(`O engine rejeitou o script base ${name}.`);
        }
      }

      this.loadDeck(0, config.playerDeck);
      this.loadDeck(1, config.opponentDeck);
      for (const card of scenario) {
        core.duelNewCard(handle, {
          team: card.player,
          duelist: 0,
          code: card.code,
          controller: card.player,
          location: card.location as OcgLocation,
          sequence: card.sequence ?? 0,
          position: (card.position ??
            (card.location === OcgLocation.MZONE
              ? OcgPosition.FACEUP_ATTACK
              : card.location === OcgLocation.SZONE || card.location === OcgLocation.EXTRA
                ? OcgPosition.FACEDOWN
                : OcgPosition.FACEUP)) as OcgPosition,
        });
      }

      this.appendLog(
        `Duelo iniciado — ${config.playerName} vs ${config.opponentName}`,
      );

      await this.core.startDuel(handle);
      await this.runLoop();
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : "Erro ao iniciar duelo.",
        isProcessing: false,
      });
    }
  }

  /**
   * Troca, no meio do duelo, quando o assento é perguntado se quer responder.
   *
   * Não mexe numa pergunta já na tela: o jogador que abriu o modal decide ele.
   * Vale a partir da próxima janela.
   */
  setChainPreference(
    seat: 0 | 1,
    preference: { mode?: ChainResponseMode; forceAsk?: boolean },
  ): void {
    if (preference.mode) this.chainModes[seat] = preference.mode;
    if (preference.forceAsk !== undefined) this.forceAsk[seat] = preference.forceAsk;
  }

  /**
   * "Pula": encerra agora a pausa entre jogadas que está correndo.
   *
   * É o ○ do Tag Force e o clique do Master Duel — quem já leu o destaque da
   * ativação não precisa esperar o resto dele. Só a pausa em curso: a próxima
   * jogada volta ao ritmo escolhido.
   */
  hurry(): void {
    this.endPause?.();
  }

  /** Espera `ms`, ou menos se alguém chamar `hurry`. */
  private pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.endPause === done) this.endPause = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.endPause = done;
    });
  }

  /** Troca o ritmo no meio do duelo (ver `DuelSessionConfig.pace`). */
  setPace(scale: number): void {
    this.pace = Number.isFinite(scale) ? Math.min(2, Math.max(0, scale)) : 1;
  }

  /**
   * Entrega a resposta do assento que estava sendo perguntado.
   *
   * @param promptId quando informado, precisa casar com o prompt corrente. É a
   *   proteção contra a resposta que chega tarde pela rede: sem ela o core
   *   receberia a resposta de uma pergunta que já passou, e devolveria RETRY
   *   até o duelo ser interrompido.
   */
  async respond(response: OcgResponse, promptId?: number): Promise<void> {
    if (!this.core || !this.handle || this.running) return;
    if (promptId !== undefined && promptId !== this.snapshot.promptId) return;
    if (this.snapshot.pendingPrompt === null) return;

    this.core.duelSetResponse(this.handle, response);
    this.hintedCard = null;
    this.selectHint = null;
    this.update({
      pendingPrompt: null,
      promptPlayer: null,
      promptCard: null,
      promptHint: null,
      isProcessing: true,
    });
    await this.runLoop();
  }

  /**
   * O jogador desiste: o outro assento vence na hora.
   *
   * Não passa pelo engine de propósito. O ocgcore não tem "desistir" — e no
   * momento em que alguém desiste ele costuma estar **parado**, esperando uma
   * resposta que não vem (é justamente o caso de quem já se deu por perdido, e
   * o de quem sumiu no meio do duelo). Zerar os LP também não serviria: o core
   * só declara vitória processando dano de verdade, e não há dano nenhum aqui.
   * O resultado é escrito no snapshot, pelo mesmo caminho que a mensagem WIN
   * usaria — daí sair de graça o som, o aviso e a tela de resultado.
   *
   * @param seat quem desistiu.
   * @param razao frase do resultado, quando não for uma rendição comum.
   * @param motivo linha do log; o padrão é a rendição comum.
   */
  surrender(seat: 0 | 1, motivo?: string, razao?: string): void {
    if (this.snapshot.winner !== null) return;

    const vencedor = (1 - seat) as 0 | 1;
    this.appendLog(motivo ?? `🏳 ${this.seatName(seat)} se rendeu.`);
    this.update({
      winner: vencedor,
      // A rendição não passa pelo core, então o motivo não vem de `WIN.reason`
      // — quem sabe por que o duelo acabou é quem o encerrou. `razao` existe
      // porque "não voltou a tempo" também termina por aqui, e chamar isso de
      // rendição seria contar a história errada.
      winReason: razao ?? `${this.seatName(seat)} se rendeu.`,
      pendingPrompt: null,
      promptPlayer: null,
      promptCard: null,
      isProcessing: false,
    });
    this.emit({ kind: "win", player: vencedor });
  }

  /** Mensagem de erro para falhas vindas do binding do core. */
  private reportEngineFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.appendLog(`⚠ Falha do engine: ${detail}`);
    this.update({
      error:
        "O engine falhou ao processar uma jogada. Alguma carta usou um efeito " +
        "que esta versão do ocgcore-wasm não sabe serializar.",
      isProcessing: false,
      pendingPrompt: null,
      promptPlayer: null,
    });
  }

  private loadDeck(team: 0 | 1, deck: DuelDeckPayload): void {
    if (!this.core || !this.handle) return;

    // O ocgcore NÃO embaralha o deck ao iniciar o duelo — as compras saem na
    // ordem em que as cartas foram inseridas. Sem embaralhar aqui, a mão
    // inicial é sempre o fim da decklist (que numa decklist típica é a seção
    // de armadilhas), e o jogador nunca teria um monstro para invocar.
    for (const code of shuffled(deck.main)) {
      this.core.duelNewCard(this.handle, {
        team,
        duelist: 0,
        code,
        controller: team,
        location: OcgLocation.DECK,
        sequence: 0,
        position: OcgPosition.FACEDOWN,
      });
    }

    for (const code of deck.extra) {
      this.core.duelNewCard(this.handle, {
        team,
        duelist: 0,
        code,
        controller: team,
        location: OcgLocation.EXTRA,
        sequence: 0,
        position: OcgPosition.FACEDOWN,
      });
    }
  }

  private readScript(name: string): string | null {
    const cached = this.scriptCache.get(name);
    if (cached) return cached;

    const match = name.match(/c(\d+)\.lua/i);
    if (match) {
      const fileName = `c${match[1]}.lua`;
      return this.scriptCache.get(fileName) ?? null;
    }

    return null;
  }

  private async runLoop(): Promise<void> {
    if (!this.core || !this.handle || this.running) return;

    this.running = true;

    try {
      while (this.core && this.handle) {
        // O binding do ocgcore-wasm lança em algumas mensagens raras (visto
        // com SHUFFLE_SET_CARD: o parser lê a contagem de cartas como u32 — 4
        // bytes — quando o core escreve um u8 — 1 byte —, desalinhando o
        // resto da mensagem até estourar o limite do buffer; ver
        // tools/harness/debug-binding-crash.mjs). `duelProcess` já roda e o
        // core já aplica o passo ANTES de `duelGetMessage` falhar — só a
        // notificação para a UI é que se perde, o estado do duelo continua
        // correto. Tratar isso como fatal matava o duelo por causa de uma
        // mensagem cosmética; em vez disso o lote perdido é descartado e o
        // laço tenta de novo. Um teto evita girar para sempre se a causa for
        // outra (aí sim é uma falha de verdade).
        let status: OcgProcessResult;
        let messages: OcgMessage[];
        try {
          status = await this.core.duelProcess(this.handle);
          messages = this.core.duelGetMessage(this.handle);
        } catch (error) {
          this.consecutiveBindingErrors += 1;
          if (this.consecutiveBindingErrors > MAX_CONSECUTIVE_BINDING_ERRORS) {
            this.reportEngineFailure(error);
            break;
          }
          const detail = error instanceof Error ? error.message : String(error);
          this.appendLog(`⚠ O engine não conseguiu decodificar uma notificação (${detail}) — ignorando.`);
          continue;
        }
        this.consecutiveBindingErrors = 0;
        this.consumeMessages(messages);

        // Deixa a jogada aparecer: atualiza o campo e respira antes de
        // continuar. O campo é sempre atualizado; a espera é que é dosada.
        const hadPlay = messages.some((message) => PLAY_EVENTS.has(message.type));
        const changedPhase = messages.some(
          (message) => message.type === OcgMessageType.NEW_PHASE,
        );

        if (hadPlay || changedPhase) {
          this.refreshField(true);

          // A pausa é dosada por TIPO de acontecimento, não por "houve
          // jogada". Um ataque precisa do tempo inteiro da investida — se o
          // laço seguir antes, o monstro destruído some do tabuleiro com o
          // atacante ainda no ar. Já um MOVE de carta quase não precisa de
          // nada. Uma pausa única para tudo deixava o combate atropelado e as
          // jogadas triviais lentas ao mesmo tempo.
          const isOwnTurn = this.ownTurnDiscount();
          let wanted = 0;
          for (const message of messages) {
            wanted = Math.max(wanted, beatFor(message.type, isOwnTurn));
          }
          if (changedPhase) {
            wanted = Math.max(wanted, phaseBeat(isOwnTurn));
          }
          wanted = Math.max(wanted, this.leaveBeatWanted);

          // O teto vale por LOTE, não pelo turno inteiro. Com um teto por
          // turno as primeiras jogadas gastavam a cota e o resto do turno
          // corria sem pausa nenhuma — o ritmo mudava no meio da jogada, que
          // é justamente o que dá a sensação de engasgo.
          const allowed = Math.round(Math.min(wanted, MAX_BEAT_PER_BATCH_MS) * this.pace);
          if (allowed > 0) await this.pause(allowed);
        }

        // Com o duelo decidido não há mais o que perguntar ao jogador.
        if (this.snapshot.winner !== null) {
          this.refreshField();
          this.update({ isProcessing: false, pendingPrompt: null, promptPlayer: null });
          break;
        }

        if (status === OcgProcessResult.END) {
          this.refreshField();
          this.update({ isProcessing: false, pendingPrompt: null, promptPlayer: null });
          break;
        }

        if (status === OcgProcessResult.CONTINUE) {
          continue;
        }

        const retried = messages.some(
          (message) => message.type === OcgMessageType.RETRY,
        );
        this.consecutiveRetries = retried ? this.consecutiveRetries + 1 : 0;

        // Num RETRY o core não reemite o prompt: espera outra resposta para a
        // MESMA pergunta, e sem reaproveitá-la o duelo travaria em "aguardando".
        // O reaproveitamento é restrito ao RETRY de propósito: reenviar um
        // prompt antigo em qualquer WAITING sem pergunta faz o core repetir
        // ações já resolvidas, num laço que nunca termina.
        const prompt = findPromptMessage(messages) ?? (retried ? this.lastPrompt : null);
        if (!prompt) {
          this.update({ isProcessing: false });
          break;
        }
        this.lastPrompt = prompt;

        if (this.consecutiveRetries > MAX_CONSECUTIVE_RETRIES) {
          this.update({
            error:
              "O engine rejeitou as respostas seguidas vezes — o duelo foi interrompido.",
            isProcessing: false,
            pendingPrompt: null,
            promptPlayer: null,
          });
          break;
        }

        // Mensagens sem `player` são do jogador do turno; na prática todo
        // prompt tem o campo, mas o padrão evita perguntar a ninguém.
        const promptPlayer = (
          "player" in prompt && prompt.player === 1 ? 1 : 0
        ) as 0 | 1;

        // Prompts sem escolha real (o mais comum: "quer encadear?" sem nada
        // encadeável) são respondidos sozinhos — nunca chegam ao jogador.
        //
        // Vem antes do bot de propósito: quando não existe decisão a tomar as
        // duas respostas são a mesma, e passar por aqui poupa o bot de ler o
        // tabuleiro (dezenas de chamadas ao WASM) para escolher a única opção
        // legal. Prompt com escolha real devolve `null` e segue para quem tem
        // que decidir — a UI, ou o cérebro do bot logo abaixo.
        const automatic = autoResponseFor(prompt);
        if (automatic) {
          this.core.duelSetResponse(this.handle, automatic);
          this.selectHint = null;
          continue;
        }

        // Janela de resposta que o modo do jogador manda pular (ver
        // `chain-mode.ts`): "não responder" sem a pergunta chegar à tela. Só
        // para humano — o bot decide as próprias janelas.
        if (
          prompt.type === OcgMessageType.SELECT_CHAIN &&
          this.seats[promptPlayer].kind !== "bot"
        ) {
          const skip = chainWindowSkip(
            prompt,
            this.forceAsk[promptPlayer] ? "always" : this.chainModes[promptPlayer],
            { topLinkPlayer: this.openChainController() },
          );
          if (skip) {
            this.core.duelSetResponse(this.handle, skip);
            this.selectHint = null;
            continue;
          }
        }

        if (this.seats[promptPlayer].kind === "bot") {
          this.core.duelSetResponse(
            this.handle,
            this.botFor(promptPlayer).decide(this.botContext(prompt, promptPlayer)),
          );
          this.selectHint = null;
          continue;
        }

        this.refreshField();
        this.promptCounter += 1;
        this.update({
          // Mascarado ANTES de entrar no snapshot: é o snapshot que atravessa o
          // socket, e o core manda o passcode de todo candidato — inclusive das
          // cartas na mão do adversário.
          pendingPrompt: maskHiddenCards(
            prompt,
            promptPlayer,
            this.revealedTo[promptPlayer],
          ),
          promptPlayer,
          promptId: this.promptCounter,
          promptCard: this.hintedCard,
          promptHint: this.selectHint,
          isProcessing: false,
        });
        break;
      }
    } catch (error) {
      this.reportEngineFailure(error);
    } finally {
      this.running = false;
    }
  }

  private consumeMessages(messages: OcgMessage[]): void {
    this.leaveBeatWanted = 0;
    for (const message of messages) {
      switch (message.type) {
        // HINT carrega códigos internos do core (ids de efeito, timings) que
        // não significam nada para o jogador — fora do log. Mas o tipo CODE
        // traz o passcode da carta que está pedindo a decisão, e é a ÚNICA
        // fonte disso para prompts como SELECT_OPTION, que não citam a carta.
        case OcgMessageType.HINT: {
          if (message.hint_type === OcgHintType.CODE) {
            const code = Number(message.hint);
            if (this.registry?.get(code)) this.hintedCard = code;
            break;
          }
          // MESSAGE/SELECTMSG/OPSELECTED carregam o texto que o engine
          // queria mostrar ("selecione uma carta para descartar", "efeito
          // escolhido: ..."), codificado como id. Descartá-los deixava o log
          // narrando só o mecânico — quem entrou na corrente, quem perdeu LP
          // — sem nunca dizer o que estava sendo pedido.
          if (HINT_TEXT_TYPES.has(message.hint_type)) {
            const text = this.engineStrings.describeOption(Number(message.hint));
            // A dica é dirigida a quem vai escolher; narrá-la aos dois é ruído
            // para o outro e, num efeito de busca, não esconde nada — mas a
            // linha vai só para quem foi perguntado.
            if (text) {
              const para = message.player === 0 || message.player === 1 ? message.player : null;
              this.appendLog(`💬 ${text}`, para, { kind: "hint" });
              // "%ls" é o nome da carta, que o core preenche do lado dele.
              if (message.hint_type === OcgHintType.SELECTMSG && !text.includes("%ls")) {
                this.selectHint = text;
              }
            }
          }
          break;
        }
        case OcgMessageType.NEW_TURN: {
          // O core não numera os turnos; quem conta é aqui. É o número que o
          // jogador usa para tudo o que é "no seu 3º turno" (Espada da Luz,
          // Reckless Greed, Mensagem do Espírito) e não existia na tela.
          const turnCount = this.snapshot.turnCount + 1;
          this.update({ turnPlayer: message.player, turnCount, chain: null, chainLinks: [] });
          this.appendLog(`Turno ${turnCount} — ${this.seatName(message.player)}`, null, {
            kind: "turn",
            actor: seatOf(message.player),
          });
          this.emit({ kind: "turn", player: message.player });
          break;
        }
        case OcgMessageType.NEW_PHASE:
          this.update({ phase: message.phase });
          this.appendLog(`— ${phaseLabel(message.phase)} —`, null, { kind: "phase" });
          this.emit({ kind: "phase", phase: message.phase });
          break;

        // Narração das jogadas: sem isso o turno do bot é uma caixa-preta,
        // o campo muda sozinho e não dá para saber o que aconteceu.
        case OcgMessageType.SUMMONING:
          this.appendLog(
            `${this.seatName(message.controller)} Invocou ${this.cardName(message.code)}`,
            null,
            { codes: [message.code], actor: message.controller },
          );
          this.emit({
            kind: "summon",
            player: message.controller,
            code: message.code,
            special: false,
          });
          break;
        case OcgMessageType.SPSUMMONING:
          this.appendLog(
            `${this.seatName(message.controller)} fez Invocação-Especial de ${this.cardName(message.code)}`,
            null,
            { codes: [message.code], actor: message.controller },
          );
          this.emit({
            kind: "summon",
            player: message.controller,
            code: message.code,
            special: true,
          });
          break;
        case OcgMessageType.FLIPSUMMONING:
          this.appendLog(
            `${this.seatName(message.controller)} virou ${this.cardName(message.code)} para cima`,
            null,
            { codes: [message.code], actor: message.controller },
          );
          this.emit({
            kind: "flip",
            player: message.controller,
            code: message.code,
          });
          break;
        case OcgMessageType.SET:
          // Onde foi baixada é público (a carta está ali na mesa); o que é,
          // não — a linha diz quem e em que fileira, nunca o nome.
          this.appendLog(
            `${this.seatName(message.controller)} baixou ${
              message.location === OcgLocation.MZONE ? "um monstro" : "uma Magia/Armadilha"
            }`,
            null,
            { actor: message.controller },
          );
          this.emit({ kind: "set", player: message.controller });
          break;
        case OcgMessageType.CONFIRM_CARDS:
        case OcgMessageType.CONFIRM_DECKTOP: {
          const cards = message.cards.filter((card) => card.code !== 0);
          if (cards.length === 0) break;
          const title =
            message.type === OcgMessageType.CONFIRM_DECKTOP
              ? "Topo do Deck revelado"
              : "Cartas reveladas";
          // A mensagem é DIRIGIDA: `player` é a quem as cartas estão sendo
          // mostradas. Narrar a lista para os dois lados entregaria justamente
          // o que o efeito escondeu — o caso mais fácil de errar aqui é o
          // "olhe o topo do seu Deck" do oponente virando informação pública.
          const viewer = (message.player === 1 ? 1 : 0) as 0 | 1;
          const other = (1 - viewer) as 0 | 1;

          // Quem viu passa a poder ver a face desses candidatos num prompt
          // desta mesma resolução (Confisco: revela a mão, DEPOIS pede a
          // escolha).
          for (const card of cards) {
            this.revealedTo[viewer].add(
              maskKey(card.controller, card.location, card.sequence),
            );
          }
          this.publishReveal(viewer, message.player, title, cards);

          // O DONO das cartas reveladas também tem direito de ver quais foram:
          // são cartas dele, não há segredo a proteger, e sem isso um Boneca
          // Chamariz do adversário virava um "ele olhou 1 carta" que nunca
          // dizia QUAL — e a carta era justamente sua.
          const suas = cards.filter((card) => card.controller === other);
          if (suas.length > 0) {
            this.publishReveal(
              other,
              message.player,
              `${this.seatName(viewer)} viu`,
              suas,
            );
          } else {
            this.appendLog(
              `👁 ${this.seatName(viewer)} olhou ${cards.length} carta(s)`,
              other,
            );
          }
          break;
        }

        // Um elo começa a resolver: a tela acende ele na pilha e no slot.
        case OcgMessageType.CHAIN_SOLVING: {
          this.revealedTo = [new Set(), new Set()];
          this.updateChainLink(message.chain_size, (current) =>
            // Já negado (a ativação ou o efeito) continua negado ao "resolver".
            current.state === "pending" ? "resolving" : current.state,
          );
          break;
        }

        // Fim de uma resolução: o que foi revelado nela não vale mais como
        // "posso ver esta posição" — ver `revealedTo`.
        case OcgMessageType.CHAIN_SOLVED:
          this.revealedTo = [new Set(), new Set()];
          this.updateChainLink(message.chain_size, (current) =>
            current.state === "resolving" ? "resolved" : current.state,
          );
          break;
        case OcgMessageType.SHUFFLE_HAND:
        case OcgMessageType.SHUFFLE_DECK:
          this.revealedTo = [new Set(), new Set()];
          break;

        // Ativação negada (Solemn Judgment, Magic Jammer) ou efeito negado
        // (Ash Blossom, Effect Veiler): o momento que o jogador mais precisa
        // ver — antes, a carta só ia para o Cemitério e "nada acontecia".
        case OcgMessageType.CHAIN_NEGATED:
        case OcgMessageType.CHAIN_DISABLED: {
          const what = message.type === OcgMessageType.CHAIN_NEGATED ? "activation" : "effect";
          const link = this.updateChainLink(message.chain_size, () =>
            what === "activation" ? "negated" : "disabled",
          );
          if (link) {
            this.appendLog(
              what === "activation"
                ? `✖ Elo ${link.link} — ativação de ${this.cardName(link.code)} negada`
                : `✖ Elo ${link.link} — efeito de ${this.cardName(link.code)} negado`,
              null,
              { codes: [link.code], actor: seatOf(link.player) },
            );
            this.emit({ kind: "chainNegated", link: link.link, player: link.player, code: link.code, what });
          }
          break;
        }

        // A corrente acabou: além do conhecimento da resolução, sai também o
        // efeito anunciado no modal — ele já passou, e continuar mostrando faz
        // o jogador responder a uma pergunta que não existe mais.
        case OcgMessageType.CHAIN_END:
          this.revealedTo = [new Set(), new Set()];
          this.update({ chain: null, chainLinks: [] });
          break;

        // Carta trocando de zona. Só as saídas da MÃO são narradas, e só para
        // pilhas públicas: é o descarte que não tinha rastro nenhum na tela —
        // Goblin Larápio acertava, a mão do adversário encolhia em silêncio e
        // da cadeira do jogador o efeito parecia não ter funcionado.
        case OcgMessageType.MOVE: {
          const line = this.describeHandExit(message);
          if (line) {
            this.appendLog(line, null, {
              actor: message.from.controller,
              // O descarte vai para pilha pública; banida virada para baixo
              // ou de volta ao Deck, não — e aí a linha nem cita o nome.
              codes:
                (message.to.location & OcgLocation.GRAVE) !== 0 ||
                ((message.to.location & OcgLocation.REMOVED) !== 0 &&
                  (message.to.position & OcgPosition.FACEDOWN) === 0)
                  ? [message.card]
                  : undefined,
            });
          } else {
            this.narrateFieldExit(message);
          }
          this.moveCardHints(message.from, message.to);
          break;
        }
        case OcgMessageType.TOSS_COIN:
          this.appendLog(
            `🪙 Moeda: ${message.results.map((r) => (r ? "cara" : "coroa")).join(", ")}`,
          );
          this.emit({
            kind: "coin",
            player: message.player,
            results: message.results,
          });
          break;
        case OcgMessageType.TOSS_DICE:
          this.appendLog(`🎲 Dado: ${message.results.join(", ")}`);
          this.emit({
            kind: "dice",
            player: message.player,
            results: message.results,
          });
          break;
        case OcgMessageType.DRAW:
          // A compra da Draw Phase é implícita — narrá-la todo turno só
          // empurraria o resto para fora da tela —, e a mão inicial também (é
          // sempre a mesma). A que vem de efeito (Pote da Ganância, Upstart
          // Goblin) é a que o jogador quer conferir.
          if (
            this.snapshot.turnCount > 0 &&
            (this.snapshot.phase !== OcgPhase.DRAW || message.drawn.length > 1)
          ) {
            this.appendLog(
              `${this.seatName(message.player)} comprou ${message.drawn.length} carta(s)`,
              null,
              { actor: seatOf(message.player) },
            );
          }
          this.emit({
            kind: "draw",
            player: message.player,
            count: message.drawn.length,
          });
          break;
        case OcgMessageType.CHAINING: {
          const origem = ORIGIN_LABEL[message.triggering_location];
          this.appendLog(
            `⛓ Elo ${message.chain_size} — ${this.seatName(message.controller)} ativou ` +
              `${this.cardName(message.code)}${origem ? ` (${origem})` : ""}`,
            null,
            { codes: [message.code], actor: message.controller },
          );
          const link: DuelChainLink = {
            code: message.code,
            player: message.controller,
            playerName: this.seatName(message.controller),
            // `description` é o id da string do efeito ativado — resolvido
            // aqui, e não na tela, porque no duelo online é o servidor que
            // tem o banco de strings carregado.
            description: this.engineStrings.describeOption(Number(message.description)),
            link: message.chain_size,
            from: message.triggering_location,
            zone: {
              controller: message.controller,
              location: message.location,
              sequence: message.sequence,
            },
            state: "pending",
          };
          this.update({
            chain: link,
            // O número do elo é a posição: um elo novo nunca repete um que
            // ainda está na corrente.
            chainLinks: [...this.snapshot.chainLinks.filter((l) => l.link < link.link), link],
          });
          this.emit({
            kind: "activate",
            player: message.controller,
            code: message.code,
          });
          this.emit({
            kind: "chainLink",
            link: link.link,
            player: link.player,
            code: link.code,
            from: link.from,
          });
          break;
        }
        case OcgMessageType.ATTACK: {
          // Com os nomes: "declarou ataque" sozinho não dizia quem atacou quem,
          // e o combate é o que mais se confere depois. O alvo pode estar
          // virado para baixo — aí ele é "uma carta virada para baixo".
          const { card: atacante, target: alvo } = message;
          const codigoAtacante = this.publicCodeAt(atacante.controller, atacante.location, atacante.sequence);
          const nomeAtacante = this.publicNameAt(atacante.controller, atacante.location, atacante.sequence);
          const codigoAlvo = alvo
            ? this.publicCodeAt(alvo.controller, alvo.location, alvo.sequence)
            : null;
          this.appendLog(
            alvo
              ? `⚔ ${this.seatName(atacante.controller)} atacou ${this.publicNameAt(
                  alvo.controller,
                  alvo.location,
                  alvo.sequence,
                )} com ${nomeAtacante}`
              : `⚔ ${this.seatName(atacante.controller)} atacou diretamente com ${nomeAtacante}`,
            null,
            {
              codes: [codigoAtacante, codigoAlvo].filter((code): code is number => code !== null),
              actor: atacante.controller,
            },
          );
          this.emit({
            kind: "attack",
            player: message.card.controller,
            direct: !message.target,
            from: {
              controller: message.card.controller,
              location: message.card.location,
              sequence: message.card.sequence,
            },
            to: message.target
              ? {
                  controller: message.target.controller,
                  location: message.target.location,
                  sequence: message.target.sequence,
                }
              : null,
          });
          break;
        }
        case OcgMessageType.POS_CHANGE:
          this.appendLog(
            `${this.cardName(message.code)} mudou de posição de batalha`,
            null,
            { codes: [message.code], actor: message.controller },
          );
          this.emit({ kind: "position", player: message.controller });
          break;
        // O core praticamente nunca emite LPUPDATE (que é um valor absoluto);
        // as mudanças de LP chegam como deltas em DAMAGE / RECOVER /
        // PAY_LPCOST. Escutar só LPUPDATE deixava o placar preso em 8000.
        case OcgMessageType.LPUPDATE:
          this.setLifePoints(message.player, message.lp);
          break;
        case OcgMessageType.DAMAGE:
          this.adjustLifePoints(message.player, -message.amount);
          this.appendLog(
            `${this.seatName(message.player)} perdeu ${message.amount} LP`,
            null,
            { actor: seatOf(message.player) },
          );
          this.emit({
            kind: "damage",
            player: message.player,
            amount: message.amount,
          });
          break;
        case OcgMessageType.PAY_LPCOST:
          this.adjustLifePoints(message.player, -message.amount);
          this.appendLog(
            `${this.seatName(message.player)} pagou ${message.amount} LP`,
            null,
            { actor: seatOf(message.player) },
          );
          break;
        case OcgMessageType.RECOVER:
          this.adjustLifePoints(message.player, message.amount);
          this.appendLog(
            `${this.seatName(message.player)} recuperou ${message.amount} LP`,
            null,
            { actor: seatOf(message.player) },
          );
          this.emit({
            kind: "recover",
            player: message.player,
            amount: message.amount,
          });
          break;
        case OcgMessageType.WIN:
          // player 2 = empate (ex.: os dois decks acabaram no mesmo momento).
          // Zera o prompt: com o duelo acabado nenhuma ação faz mais sentido.
          this.update({
            winner: message.player,
            winReason: this.describeWin(message.player, message.reason),
            pendingPrompt: null,
            promptPlayer: null,
          });
          this.appendLog(
            message.player === 2
              ? "Duelo empatado!"
              : `${this.seatName(message.player)} venceu!`,
          );
          this.emit({ kind: "win", player: message.player });
          break;
        case OcgMessageType.START:
          this.appendLog("Duelo começou!");
          break;

        // ---- Marcas nas cartas e nos jogadores ---------------------------
        case OcgMessageType.CARD_HINT:
          this.applyCardHint(message);
          break;
        case OcgMessageType.PLAYER_HINT: {
          if (message.player !== 0 && message.player !== 1) break;
          const text = this.engineStrings.hintText(Number(message.description), (code) =>
            this.cardName(code),
          );
          if (!text) break;
          const counts = this.playerHintCounts[message.player];
          const now = counts.get(text) ?? 0;
          if (message.player_hint === OcgPlayerHintType.DESC_ADD) counts.set(text, now + 1);
          else if (now <= 1) counts.delete(text);
          else counts.set(text, now - 1);
          const playerHints: [string[], string[]] = [
            [...this.playerHintCounts[0].keys()],
            [...this.playerHintCounts[1].keys()],
          ];
          this.update({ playerHints });
          break;
        }
        case OcgMessageType.FIELD_DISABLED:
          this.update({ disabledZones: message.field_mask >>> 0 });
          break;
        case OcgMessageType.ADD_COUNTER:
        case OcgMessageType.REMOVE_COUNTER: {
          const nome = this.publicNameAt(message.controller, message.location, message.sequence);
          const contador = this.engineStrings.counterName(message.counter_type);
          this.appendLog(
            message.type === OcgMessageType.ADD_COUNTER
              ? `✦ ${nome} recebeu ${message.count} ${contador}`
              : `✦ ${nome} perdeu ${message.count} ${contador}`,
          );
          break;
        }
        case OcgMessageType.EQUIP:
          this.appendLog(
            `🔗 ${this.publicNameAt(message.card.controller, message.card.location, message.card.sequence)} ` +
              `foi equipada a ${this.publicNameAt(message.target.controller, message.target.location, message.target.sequence)}`,
          );
          break;
        case OcgMessageType.CARD_TARGET:
          this.appendLog(
            `🎯 ${this.publicNameAt(message.card.controller, message.card.location, message.card.sequence)} ` +
              `passou a ter como alvo ${this.publicNameAt(message.target.controller, message.target.location, message.target.sequence)}`,
          );
          break;
        case OcgMessageType.RETRY:
          this.appendLog("Resposta inválida — tente novamente.");
          break;
        default:
          break;
      }
    }
  }

  /**
   * As pausas do turno do próprio jogador podem ser encurtadas?
   *
   * Só quando quem joga é um humano local e do outro lado está o bot: quem
   * clicou já sabe o que fez, e ninguém mais assiste. Num duelo online os dois
   * assentos são humanos e um deles está sempre só assistindo — antes o teste
   * era `turnPlayer === 0`, e o assento 1 via o turno do 0 em ritmo acelerado
   * (e o 0 via o turno do 1 lento), nos dois sentidos errados.
   */
  private ownTurnDiscount(): boolean {
    const turn = this.snapshot.turnPlayer;
    if (turn !== 0 && turn !== 1) return false;
    return this.seats[turn].kind === "local" && this.seats[1 - turn].kind === "bot";
  }

  /** Quem ativou o último elo ainda por resolver; `null` fora de corrente. */
  private openChainController(): number | null {
    for (let i = this.snapshot.chainLinks.length - 1; i >= 0; i -= 1) {
      const link = this.snapshot.chainLinks[i];
      if (link.state === "pending") return link.player;
    }
    return null;
  }

  /** Chave da zona nas marcas, a mesma do `cardKey` da mesa. */
  private hintKey(controller: number, location: number, sequence: number): string {
    return `${controller}:${location}:${sequence}`;
  }

  /** A carta está no campo (onde as marcas por mensagem valem)? */
  private onField(location: number): boolean {
    return (
      (location === OcgLocation.MZONE || location === OcgLocation.SZONE) &&
      (location & OcgLocation.OVERLAY) === 0
    );
  }

  /**
   * Muda o estado de um elo da corrente; devolve o elo atualizado (ou
   * `undefined` se não há elo com esse número — uma mensagem fora de ordem não
   * pode derrubar a sessão).
   */
  private updateChainLink(
    linkNumber: number,
    next: (current: DuelChainLink) => DuelChainLink["state"],
  ): DuelChainLink | undefined {
    let updated: DuelChainLink | undefined;
    const chainLinks = this.snapshot.chainLinks.map((link) => {
      if (link.link !== linkNumber) return link;
      updated = { ...link, state: next(link) };
      return updated;
    });
    if (!updated) return undefined;
    const top = chainLinks.at(-1) ?? null;
    this.update({ chainLinks, chain: top });
    return updated;
  }

  /**
   * Aplica um `CARD_HINT` à zona da carta.
   *
   * Só no campo: é onde a mesa desenha marca, e fora dele a posição (mão,
   * cemitério) muda o tempo todo sem MOVE da própria carta.
   */
  private applyCardHint(message: {
    controller: 0 | 1;
    location: number;
    sequence: number;
    card_hint: OcgCardHintType;
    description: bigint;
  }): void {
    if (!this.onField(message.location)) return;
    const key = this.hintKey(message.controller, message.location, message.sequence);
    const entry = this.cardHints.get(key) ?? { value: null, descs: new Map<string, number>() };
    const raw = Number(message.description);
    const nome = this.publicNameAt(message.controller, message.location, message.sequence);

    switch (message.card_hint) {
      case OcgCardHintType.TURN:
        // Turno 0 é "zerou/terminou" — não vale marca nenhuma.
        entry.value = raw > 0 ? { kind: "turn", value: raw } : null;
        break;
      case OcgCardHintType.CARD:
        entry.value = { kind: "card", code: raw };
        this.appendLog(`📢 ${nome} — carta declarada: ${this.cardName(raw)}`);
        break;
      case OcgCardHintType.RACE:
        entry.value = { kind: "race", mask: raw };
        this.appendLog(`📢 ${nome} — Tipo declarado`);
        break;
      case OcgCardHintType.ATTRIBUTE:
        entry.value = { kind: "attribute", mask: raw };
        this.appendLog(`📢 ${nome} — Atributo declarado`);
        break;
      case OcgCardHintType.NUMBER:
        entry.value = { kind: "number", value: raw };
        this.appendLog(`📢 ${nome} — número declarado: ${raw}`);
        break;
      case OcgCardHintType.DESC_ADD:
      case OcgCardHintType.DESC_REMOVE: {
        const text = this.engineStrings.hintText(raw, (code) => this.cardName(code));
        if (!text) break;
        const now = entry.descs.get(text) ?? 0;
        if (message.card_hint === OcgCardHintType.DESC_ADD) entry.descs.set(text, now + 1);
        else if (now <= 1) entry.descs.delete(text);
        else entry.descs.set(text, now - 1);
        break;
      }
      default:
        break;
    }

    if (entry.value || entry.descs.size > 0) this.cardHints.set(key, entry);
    else this.cardHints.delete(key);
  }

  /** As marcas andam com a carta; fora do campo, somem. */
  private moveCardHints(
    from: { controller: number; location: number; sequence: number },
    to: { controller: number; location: number; sequence: number },
  ): void {
    if (!this.onField(from.location)) return;
    const key = this.hintKey(from.controller, from.location, from.sequence);
    const entry = this.cardHints.get(key);
    if (!entry) return;
    this.cardHints.delete(key);
    if (this.onField(to.location)) {
      this.cardHints.set(this.hintKey(to.controller, to.location, to.sequence), entry);
    }
  }

  /** As marcas por zona no formato que `readBoardState` mescla nas cartas. */
  private hintsByZone(): Map<string, CardHint[]> {
    const out = new Map<string, CardHint[]>();
    this.cardHints.forEach((entry, key) => {
      const hints: CardHint[] = [];
      if (entry.value) hints.push(entry.value);
      for (const text of entry.descs.keys()) hints.push({ kind: "desc", text });
      out.set(key, hints);
    });
    return out;
  }

  /**
   * Nome de uma carta numa zona, para a narração — ou "uma carta virada para
   * baixo" quando ela não é pública. O log é lido pelos dois lados, e dizer o
   * nome de uma carta baixada entregaria o segredo.
   */
  private publicNameAt(controller: number, location: number, sequence: number): string {
    const raw = this.queryAt(controller, location, sequence);
    if (!raw?.code) return "uma carta";
    if (((raw.position ?? 0) & OcgPosition.FACEDOWN) !== 0) return "uma carta virada para baixo";
    return this.cardName(raw.code);
  }

  /** O passcode numa zona se a carta é pública (face para cima); senão `null`. */
  private publicCodeAt(controller: number, location: number, sequence: number): number | null {
    const raw = this.queryAt(controller, location, sequence);
    if (!raw?.code) return null;
    return ((raw.position ?? 0) & OcgPosition.FACEDOWN) !== 0 ? null : raw.code;
  }

  /** Código, posição e motivo da carta numa zona — `null` se não houver. */
  private queryAt(
    controller: number,
    location: number,
    sequence: number,
  ): { code?: number; position?: number; reason?: number } | null {
    const { core, handle } = this;
    if (!core || !handle) return null;
    try {
      return core.duelQuery(handle, {
        flags: (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.REASON) as OcgQueryFlags,
        controller: controller as 0 | 1,
        location: location as OcgLocation,
        sequence,
        overlaySequence: 0,
      }) as { code?: number; position?: number; reason?: number } | null;
    } catch {
      return null;
    }
  }

  /**
   * Narra uma carta saindo do campo e avisa a mesa para animar a saída.
   *
   * O `MOVE` diz de onde e para onde, mas não por quê: o binding lê a mensagem
   * sem o `reason` que o core escreve no fim dela. O motivo continua guardado
   * na carta, então é lido no destino — conferindo que a carta lá é a mesma (no
   * mesmo lote ela pode ter seguido para outro lugar; aí a frase cai no
   * genérico pelo destino, que nunca mente).
   *
   * Nome só do que é público: uma carta baixada que volta para a mão ou o
   * Deck continua secreta ("uma carta baixada"); a que vai para o Cemitério ou
   * é banida com a face para cima passa a ser vista por todo mundo.
   */
  private narrateFieldExit(message: {
    card: number;
    from: { controller: 0 | 1; location: number; sequence: number; position: number };
    to: { controller: 0 | 1; location: number; sequence: number; position: number };
  }): void {
    const { from, to } = message;
    const campo = OcgLocation.MZONE | OcgLocation.SZONE;
    if ((from.location & campo) === 0) return;
    // Troca de zona dentro do campo (controle, mover de coluna) não é saída.
    if ((to.location & campo) !== 0 && (to.location & OcgLocation.OVERLAY) === 0) return;

    const faceUpBefore = (from.position & OcgPosition.FACEDOWN) === 0;
    const publicDestination =
      (to.location & OcgLocation.GRAVE) !== 0 ||
      ((to.location & (OcgLocation.REMOVED | OcgLocation.EXTRA)) !== 0 &&
        (to.position & OcgPosition.FACEDOWN) === 0);
    const code = message.card && (faceUpBefore || publicDestination) ? message.card : null;
    const nome = code !== null ? this.cardName(code) : "Uma carta baixada";

    // Matéria Xyz desanexada: sai de baixo do monstro, não de uma zona.
    if ((from.location & OcgLocation.OVERLAY) !== 0) {
      if ((to.location & OcgLocation.GRAVE) !== 0) {
        this.appendLog(`◈ ${nome} foi desanexada (matéria Xyz)`, null, {
          codes: code !== null ? [code] : undefined,
          actor: from.controller,
        });
      }
      return;
    }

    const consulta = to.location ? this.queryAt(to.controller, to.location, to.sequence) : null;
    const reason = consulta?.code === message.card ? (consulta.reason ?? 0) : 0;
    const why = leaveReasonOf(to.location, reason);
    const materia =
      reason & REASON.SYNCHRO
        ? " de Sincro"
        : reason & REASON.XYZ
          ? " Xyz"
          : reason & REASON.LINK
            ? " de Link"
            : reason & REASON.FUSION
              ? " de Fusão"
              : reason & REASON.RITUAL
                ? " de Ritual"
                : "";
    const facedownBanish = (to.position & OcgPosition.FACEDOWN) !== 0;

    const texto: Record<LeaveReason, string> = {
      battle: `💥 ${nome} foi destruída em batalha`,
      destroy: `💥 ${nome} foi destruída`,
      tribute: `${nome} foi oferecida como Tributo`,
      material: `${nome} foi usada como matéria${materia}`,
      grave: `⚰ ${nome} foi enviada ao Cemitério`,
      banish: facedownBanish ? `🚫 ${nome} foi banida virada para baixo` : `🚫 ${nome} foi banida`,
      hand: `↩ ${nome} voltou para a mão`,
      deck:
        (to.location & OcgLocation.EXTRA) !== 0
          ? `↩ ${nome} foi para o Extra Deck`
          : `↩ ${nome} voltou para o Deck`,
    };
    this.appendLog(texto[why], null, {
      codes: code !== null ? [code] : undefined,
      actor: from.controller,
    });

    this.leaveBeatWanted = Math.max(this.leaveBeatWanted, leaveBeat(why, this.ownTurnDiscount()));
    this.emit({
      kind: "leave",
      player: from.controller,
      code,
      from: { controller: from.controller, location: from.location, sequence: from.sequence },
      why,
    });
  }

  /**
   * Nome de quem agiu, para as linhas de narração.
   *
   * Vem do assento e não de um "Você"/"Oponente" fixo: o mesmo log é lido pelos
   * dois lados num duelo online, e a segunda pessoa só faz sentido quando o
   * outro assento é um bot. O `player` 2 que o core usa para empate cai no
   * fallback.
   */
  private seatName(player: number): string {
    return this.seats[player as 0 | 1]?.name ?? `Jogador ${player + 1}`;
  }

  /** Nome da carta pelo passcode; cai no código quando o registry não a tem. */
  private cardName(code: number): string {
    return this.registry?.get(code)?.name ?? `carta ${code}`;
  }

  /**
   * Uma frase dizendo por que o duelo acabou, ou `null` quando não se sabe.
   *
   * A tradução mora em `win-reason.ts` (com os códigos e o porquê); aqui só
   * entra o que depende do duelo: os nomes dos assentos e a consulta do Exodia.
   *
   * @param winner assento vencedor; 2 é empate, e aí não há nada a explicar
   *   além do que a tela já diz.
   */
  private describeWin(winner: number, reason: number): string | null {
    if (winner !== 0 && winner !== 1) return null;
    return describeWinReason(
      reason,
      { winner: this.seatName(winner), loser: this.seatName(1 - winner) },
      // Só custa a consulta quando pode mudar a frase.
      reason === WIN_REASON.EFFECT ? this.temExodiaNaMao(winner) : false,
    );
  }

  /**
   * As cinco partes de Exodia estão na mão deste assento?
   *
   * A vitória por efeito é uma só para o core (`reason` 16), e no Goat quem
   * mais a produz é Exodia — dizer o nome dela é a diferença entre "venceu por
   * um efeito" e a frase que o jogador esperava ler.
   *
   * Lido direto do core, e não do snapshot: a mão do bot não é projetada em
   * tabuleiro nenhum (ver `refreshField`), e a vitória dele explicaria menos
   * do que a do jogador.
   */
  private temExodiaNaMao(seat: 0 | 1): boolean {
    const { core, handle } = this;
    if (!core || !handle) return false;
    try {
      const mao = core.duelQueryLocation(handle, {
        flags: OcgQueryFlags.CODE,
        controller: seat,
        location: OcgLocation.HAND,
      }) as ({ code?: number } | null)[];
      // Pelo `scriptPasscode`: arte alternativa tem passcode próprio, e a
      // comparação crua deixaria de reconhecer justamente a carta bonita.
      const naMao = new Set(
        mao
          .map((carta) => carta?.code)
          .filter((code): code is number => typeof code === "number")
          .map((code) => this.cardDb.scriptPasscode(code)),
      );
      return EXODIA_PECAS.every((peca) => naMao.has(peca));
    } catch {
      return false;
    }
  }

  /**
   * Registra uma revelação: linha no log, aviso na tela e entrada no histórico.
   *
   * Os três juntos porque cada um cobre uma falha do outro: o aviso passa e se
   * perde, a linha do log rola para fora, e o histórico é o único que sobrevive
   * ao turno — e é ele que responde "o que era aquela carta que ele revelou?".
   *
   * @param seat quem tem direito de ver os códigos.
   * @param player assento a quem o engine dirigiu a revelação.
   */
  private publishReveal(
    seat: 0 | 1,
    player: number,
    title: string,
    cards: readonly { code: number }[],
  ): void {
    const codes = cards.map((card) => card.code);
    this.appendLog(
      `👁 ${title}: ${codes.map((code) => this.cardName(code)).join(", ")}`,
      seat,
    );
    this.revealCounter += 1;
    this.update({
      reveals: [
        ...this.snapshot.reveals.slice(-(MAX_REVEALS - 1)),
        {
          id: this.revealCounter,
          visibleTo: seat,
          title,
          codes,
          turn: this.snapshot.turnPlayer,
        },
      ],
    });
    this.emit({ kind: "reveal", player, codes, title, visibleTo: seat });
  }

  /**
   * Narração de uma carta que SAIU DA MÃO, ou `null` quando o movimento não é
   * um desses.
   *
   * O nome só aparece quando o destino é público — cemitério, ou banimento com
   * a face para cima. Uma carta devolvida ao Deck ou banida virada para baixo
   * (Espada da Luz) continua secreta, e dizer o nome dela aqui seria entregar
   * pela narração o que o efeito escondeu.
   */
  private describeHandExit(message: {
    card: number;
    from: { controller: 0 | 1; location: number };
    to: { location: number; position: number };
  }): string | null {
    if ((message.from.location & OcgLocation.HAND) === 0) return null;

    const dono = this.seatName(message.from.controller);
    const nome = this.cardName(message.card);
    const paraBaixo = (message.to.position & OcgPosition.FACEDOWN) !== 0;

    if (message.to.location & OcgLocation.GRAVE) {
      return `🗑 ${dono} descartou ${nome}`;
    }
    if (message.to.location & OcgLocation.REMOVED) {
      return paraBaixo
        ? `🚫 1 carta da mão de ${dono} foi banida virada para baixo`
        : `🚫 ${nome} foi banida da mão de ${dono}`;
    }
    if (message.to.location & OcgLocation.DECK) {
      return `↩ 1 carta da mão de ${dono} voltou para o Deck`;
    }
    return null;
  }

  private setLifePoints(player: number, value: number): void {
    const lifePoints: [number, number] = [...this.snapshot.lifePoints];
    if (player === 0 || player === 1) {
      lifePoints[player] = Math.max(0, value);
    }
    this.update({ lifePoints });
  }

  private adjustLifePoints(player: number, delta: number): void {
    if (player !== 0 && player !== 1) return;
    this.setLifePoints(player, this.snapshot.lifePoints[player] + delta);
  }

  private botFor(seat: 0 | 1): BotBrain {
    let brain = this.brains.get(seat);
    if (!brain) {
      brain = new BotBrain();
      this.brains.set(seat, brain);
    }
    return brain;
  }

  /**
   * O que o bot pode consultar para decidir.
   *
   * O tabuleiro entra como **função**, e memoizado: a maior parte dos prompts
   * se resolve sem olhar o campo, e `readBoardState` custa dezenas de chamadas
   * ao WASM. Quem paga é só a decisão que precisa — e paga uma vez, mesmo que a
   * heurística consulte o campo em vários pontos.
   */
  private botContext(prompt: OcgMessage, seat: 0 | 1): BotContext {
    const { core, handle } = this;
    const cache = new Map<boolean, BoardState>();
    return {
      prompt,
      me: seat,
      readBoard: (full: boolean) => {
        const guardado = cache.get(full);
        if (guardado) return guardado;
        if (!core || !handle) {
          throw new Error("duelo encerrado durante a decisão do bot");
        }
        const board = readBoardState(core, handle, seat, !full, this.hintsByZone());
        cache.set(full, board);
        return board;
      },
      cardDb: this.cardDb,
      lifePoints: this.snapshot.lifePoints,
      phase: this.snapshot.phase,
      turnPlayer: this.snapshot.turnPlayer,
      turnCount: this.snapshot.turnCount,
      chainPlayer: this.snapshot.chain?.player ?? null,
    };
  }

  /**
   * Relê o estado do campo.
   *
   * @param light pula o conteúdo das pilhas. Durante uma jogada em andamento
   *   isso corta dezenas de chamadas ao WASM por lote de mensagens — era o que
   *   fazia uma ação simples parecer travada.
   */
  private refreshField(light = false): void {
    const { core, handle } = this;
    if (!core || !handle) return;

    // Uma leitura por assento que alguém realmente olha. Ler o tabuleiro do
    // bot dobraria as chamadas ao WASM por lote de mensagens sem ninguém ver
    // o resultado — e é justamente esse custo que o modo `light` contém.
    const hints = this.hintsByZone();
    const boards = [0, 1].map((seat) =>
      this.seats[seat as 0 | 1].kind === "bot"
        ? null
        : readBoardState(core, handle, seat as 0 | 1, light, hints),
    ) as [BoardState | null, BoardState | null];

    this.update({ boards });
  }

  /** @param visibleTo assento que pode ler a linha; `null` é público. */
  private appendLog(
    text: string,
    visibleTo: 0 | 1 | null = null,
    extra: Pick<DuelLogEntry, "kind" | "codes" | "actor"> = {},
  ): void {
    const entry: DuelLogEntry = { text, visibleTo };
    if (extra.kind) entry.kind = extra.kind;
    if (extra.codes?.length) entry.codes = extra.codes;
    if (extra.actor === 0 || extra.actor === 1) entry.actor = extra.actor;
    this.update({ log: [...this.snapshot.log.slice(-199), entry] });
  }

  private update(partial: Partial<DuelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

/** O assento como `0 | 1`, ou `undefined` para o 2 do empate e afins. */
function seatOf(player: number): 0 | 1 | undefined {
  return player === 0 || player === 1 ? player : undefined;
}

/**
 * O motivo da saída, do destino e dos `REASON_*` que o core guardou.
 *
 * O destino manda quando a carta não foi para o Cemitério (banida, mão,
 * Deck); no Cemitério, o motivo separa destruição em batalha, destruição,
 * Tributo e matéria do "enviado" genérico (custo, efeito, regra).
 */
function leaveReasonOf(to: number, reason: number): LeaveReason {
  if (to & OcgLocation.REMOVED) return "banish";
  if (to & OcgLocation.HAND) return "hand";
  // Pêndulo destruído vai para o Extra Deck com a face para cima — continua
  // sendo uma destruição, e é isso que o jogador quer ler.
  if (to & OcgLocation.EXTRA && reason & REASON.DESTROY) {
    return reason & REASON.BATTLE ? "battle" : "destroy";
  }
  if (to & (OcgLocation.DECK | OcgLocation.EXTRA)) return "deck";
  if (reason & REASON.DESTROY) return reason & REASON.BATTLE ? "battle" : "destroy";
  if (reason & REASON.RELEASE) return "tribute";
  if (reason & REASON.MATERIAL) return "material";
  return "grave";
}

function createInitialSnapshot(): DuelSnapshot {
  return {
    format: DEFAULT_FORMAT,
    playerHints: [[], []],
    disabledZones: 0,
    boards: [null, null],
    lifePoints: [8000, 8000],
    turnPlayer: null,
    turnCount: 0,
    phase: null,
    chain: null,
    chainLinks: [],
    log: [],
    reveals: [],
    winner: null,
    winReason: null,
    pendingPrompt: null,
    promptPlayer: null,
    promptId: 0,
    promptCard: null,
    promptHint: null,
    isProcessing: false,
    error: null,
  };
}

export function createDuelSession(): DuelSession {
  return new DuelSession();
}
