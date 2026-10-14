"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  OcgLocation,
  OcgMessageType,
  type OcgResponse,
  type SelectFieldPlace,
} from "@n1xx1/ocgcore-wasm";

import { useCardRegistry } from "@/context/CardRegistryProvider";
import { useCardText } from "@/hooks/useCardText";
import { useDuelFeedback, type DuelFlash } from "@/hooks/useDuelFeedback";
import { NARROW_TABLE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useTips } from "@/hooks/useTips";
import { nextTip } from "@/lib/duel/tips";
import { ATTRIBUTE_KANJI } from "@/lib/duel/attributes";
import { playSfx } from "@/lib/audio/sfx";
import type { DuelEventListener } from "@/lib/duel/duel-events";
import {
  attributeLabel,
  monsterTypeParts,
  translateRace,
  translateType,
} from "@/lib/card-labels";
import {
  buildPromptPlan,
  cardKey,
  locationLabel,
  type CardAction,
  type CounterSelection,
  type GlobalAction,
  type PromptPlan,
} from "@/lib/duel/duel-actions";
import {
  EMPTY_ENGINE_STRINGS,
  fetchEngineStrings,
  type EngineStringsDb,
} from "@/lib/duel/engine-strings";
import { actionReach, needsCardPicker } from "@/lib/duel/prompt-reach";
import { isTriggerWindow } from "@/lib/duel/chain-mode";
import type { BoardCard, BoardPlayer } from "@/lib/duel/board-state";
import {
  fetchOfficialCardDb,
  type OfficialCardDb,
} from "@/lib/duel/official-card-data";
import { linkedZones } from "@/lib/duel/link-geometry";
import { placeResponseFor, zonesBeforeCommand } from "@/lib/duel/zone-first";
import { localizeLogText } from "@/lib/duel/log-names";
import { cardMarks, slotChips, type CardMark } from "@/lib/duel/card-marks";
import type {
  DuelChainLink,
  DuelLogEntry,
  DuelReveal,
  DuelSnapshot,
} from "@/lib/duel/duel-session";
import type { CardRegistry } from "@/lib/domain/card-registry";

import {
  CARD_SHAPE,
  commandKind,
  DuelCardSlot,
  DuelPile,
  StatValue,
  type SlotIntent,
} from "@/components/duel/DuelCardSlot";
import { HudButtons, LifePlate, PhaseButton } from "@/components/duel/DuelHud";
import { DuelInfo, EffectsPanel, FieldCracks } from "@/components/duel/DuelInfo";
import { FieldStatsLayer, type FieldGrade, type FieldStat } from "@/components/duel/FieldStats";
import {
  MonsterHologramsLayer,
  useHologramIndex,
  type HoloMonster,
} from "@/components/duel/MonsterHolograms";
import { AttackFlightLayer } from "@/components/duel/AttackFlight";
import { ChainSpotlight, ORIGEM } from "@/components/duel/ChainSpotlight";
import { ChainStack } from "@/components/duel/ChainStack";
import type { ChainBadge } from "@/components/duel/DuelCardSlot";
import { DrawFlightLayer } from "@/components/duel/DrawFlight";
import { SortCardModal } from "@/components/duel/SortCardModal";
import { AnnounceCardModal } from "@/components/duel/AnnounceCardModal";
import { DecisionSheet, DecisionShell, PeekButton } from "@/components/duel/DecisionShell";
import { CardStrip, CardTile, GridTab } from "@/components/duel/MdCardList";
import { FinalBlow, PhaseBanner } from "@/components/duel/MdBanners";
import { SummonCutIn } from "@/components/duel/SummonCutIn";
import { GlossaryText } from "@/components/duel/GlossaryText";
import { LeaveFlightLayer } from "@/components/duel/LeaveFlight";
import { DuelSettings } from "@/components/duel/DuelSettings";
import {
  DEFAULT_DUEL_PREFS,
  SPEED_SCALE,
  type DuelPrefs,
} from "@/lib/duel/duel-prefs";

interface DuelBoardProps {
  snapshot: DuelSnapshot;
  /**
   * Assento que esta tela está assistindo.
   *
   * Tudo o que é "seu" na mesa deriva daqui: a fileira de baixo, a barra de LP
   * da esquerda, o lado que treme ao levar dano. Num duelo local é sempre 0;
   * online o servidor é quem diz.
   */
  me: 0 | 1;
  playerName: string;
  opponentName: string;
  onRespond: (response: OcgResponse) => void;
  /**
   * Desistir do duelo.
   *
   * Ausente (duelo já terminado, ou modo sem rendição) esconde a opção — não
   * adianta oferecer um botão que não faz nada.
   */
  onSurrender?: () => void;
  /** Assinatura dos eventos transitórios — alimenta som e animações. */
  subscribeEvents: ((listener: DuelEventListener) => () => void) | null;
  /** Preferências da mesa (modo de resposta, velocidade) — ver `duel-prefs.ts`. */
  prefs?: DuelPrefs;
  onPrefsChange?: (next: Partial<DuelPrefs>) => void;
  /**
   * Ctrl apertado/solto: enquanto apertado o jogador é perguntado em toda
   * janela de resposta (o *hold* do Master Duel). Quem roda o engine decide.
   */
  onForceAsk?: (held: boolean) => void;
  /**
   * Encerra a pausa em curso — o clique que pula a animação. Só no duelo
   * local: no online a pausa é da sala, e o clique só tira o destaque da tela.
   */
  onHurry?: () => void;
  /**
   * De quem é o ritmo: `local` (a velocidade escolhida vale para as pausas e
   * as animações) ou `room` (online — o servidor pausa igual para os dois).
   */
  pacing?: "local" | "room";
  /**
   * Bot × bot: quem olha não joga. Sem botão de modo de resposta, sem dicas,
   * e o selo de vez não diz "Sua vez" para um assento que é do bot.
   */
  spectating?: boolean;
  /**
   * O que fazer quando o duelo acaba.
   *
   * Sai de fora porque depende do modo: no duelo local só há "voltar ao
   * lobby"; no online o que se quer é jogar de novo com a mesma pessoa, na
   * mesma sala — recriar sala e reenviar link a cada partida é o atrito que
   * separa "jogamos uma" de "jogamos a tarde toda".
   */
  ending?: {
    backHref: string;
    backLabel: string;
    /**
     * Volta para a sala (duelo online) — um caminho só.
     *
     * Antes havia dois: "jogar de novo com o mesmo deck" e "trocar de deck".
     * Os dois mexiam no mesmo estado da sala por rotas diferentes e travavam
     * um ao outro: quem trocava de deck perdia o "pronto" e não conseguia
     * confirmar de novo, e quem tinha pedido revanche ficava esperando para
     * sempre alguém que já estava pronto. Um caminho só devolve os dois à
     * sala, onde escolher deck e ficar pronto é o mesmo gesto da primeira
     * partida.
     */
    onBackToRoom?: () => void;
    /** Revanche com os mesmos decks (duelo local). */
    onRematch?: () => void;
    /** Rótulo do botão de revanche ("Assistir outra" no bot × bot). */
    rematchLabel?: string;
  };
}

const EMPTY_PLAYER: BoardPlayer = {
  monsters: Array(7).fill(null),
  spells: Array(5).fill(null),
  field: null,
  hand: [],
  grave: [],
  banished: [],
  extra: [],
  graveTop: null,
  deckSize: 0,
  graveSize: 0,
  banishedSize: 0,
  extraSize: 0,
  extraFaceUp: 0,
};

/**
 * O que a leitura lateral precisa para desenhar uma carta.
 *
 * O código já basta — o resto é opcional porque carta oferecida por um modal
 * (candidato de uma seleção) não ocupa zona nenhuma, então não tem ATK/DEF de
 * campo para mostrar; nesses casos o painel cai nos valores do catálogo.
 */
type PreviewCard = Pick<BoardCard, "code"> & Partial<Omit<BoardCard, "code">>;

/** O elo que pôs a carta na leitura (ver `ativacaoLida`). */
interface ActivationRead {
  code: number;
  link: number;
  mine: boolean;
  /** De onde foi ativada (`OcgLocation`). */
  from: number;
  description: string | null;
}

/** O cabeçalho de ativação da leitura: o elo, quem, e em que pé está. */
interface ActivationHeader extends ActivationRead {
  who: string;
  state: DuelChainLink["state"] | null;
}

/** Sequência da zona de campo dentro da SZONE (as 5 primeiras são magia/armadilha). */
const FIELD_ZONE_SEQUENCE = 5;

/**
 * Materiais Xyz como "cartas" de pilha, para reaproveitar o modal das pilhas.
 * São públicos (ficam com a face para cima embaixo do monstro).
 */
function overlayCards(card: BoardCard): BoardCard[] {
  return card.overlays.map((code, index) => ({
    ...card,
    code,
    sequence: index,
    location: OcgLocation.OVERLAY,
    faceDown: false,
    defense: false,
    attack: null,
    defenseValue: null,
    baseAttack: null,
    baseDefense: null,
    level: null,
    rank: null,
    link: null,
    scales: null,
    overlays: [],
    counters: [],
    equippedTo: null,
    targets: [],
    negated: false,
    hints: [],
  }));
}

export function DuelBoard({
  snapshot,
  me,
  playerName,
  opponentName,
  onRespond,
  onSurrender,
  subscribeEvents,
  ending = { backHref: "/duel", backLabel: "Voltar ao lobby" },
  prefs = DEFAULT_DUEL_PREFS,
  onPrefsChange,
  onForceAsk,
  onHurry,
  pacing = "local",
  spectating = false,
}: DuelBoardProps) {
  /** O outro assento — usado o tempo todo, e `1 - me` espalhado confunde. */
  const foeSeat = (1 - me) as 0 | 1;
  const texto = useCardText();
  /**
   * Escala das animações. No local é a velocidade escolhida — a mesma das
   * pausas da sessão, senão a carta ainda estaria no ar quando o tabuleiro
   * muda. No online as pausas são da sala, em ritmo normal.
   */
  const animationScale = pacing === "local" ? SPEED_SCALE[prefs.speed] : 1;
  const {
    flashes,
    shake,
    toss,
    flight,
    reveal,
    draw,
    spotlight,
    leaves,
    banner,
    cutIn,
    dismissSpotlight,
    dismissCutIn,
  } = useDuelFeedback(
      subscribeEvents,
      me,
      animationScale,
      spectating
        ? { mine: `VEZ DE ${playerName.toUpperCase()}`, foe: `VEZ DE ${opponentName.toUpperCase()}` }
        : undefined,
    );
  const fieldRef = useRef<HTMLDivElement | null>(null);
  /** A área abaixo da faixa do topo — a régua do HUD (botão de fase). */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { registry, cards } = useCardRegistry();
  /**
   * A carta em leitura no painel da esquerda.
   *
   * **Fica** na última carta lida: o painel do Tag Force nunca esvazia. Antes
   * ele zerava ao tirar o mouse e passava a maior parte do duelo dizendo "passe
   * o mouse sobre uma carta" — justamente quando o jogador olhava para o
   * campo pensando na jogada. Quem quer outra carta passa o mouse nela.
   */
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  /**
   * A ativação que pôs a carta em leitura, quando foi ela (e não o mouse).
   *
   * A leitura segue a ativação, como no Master Duel: cada elo novo vai para o
   * painel da esquerda com quem ativou e o efeito, e fica lá até o jogador
   * passar o mouse em outra carta. Antes o texto do que foi ativado só
   * aparecia no diálogo "deseja responder?" — que no modo Automático quase
   * nunca abre —, e o destaque do centro some em um segundo: um Raigeki do
   * oponente passava mostrando a carta e nada do que ela fazia.
   */
  const [ativacaoLida, setAtivacaoLida] = useState<ActivationRead | null>(null);
  const showPreview = useCallback((card: PreviewCard | null) => {
    // Zona vazia e carta virada do oponente não têm o que ler — não apagam a
    // leitura que está no painel.
    if (card?.code) {
      setPreview(card);
      setAtivacaoLida(null);
    }
  }, []);
  // Um destaque de ativação novo (token novo) leva a carta para a leitura.
  // Estado derivado durante o render — o padrão do React para "reagir a uma
  // prop nova" sem efeito e sem render a mais.
  const [destaqueLido, setDestaqueLido] = useState<number | null>(null);
  if (spotlight && spotlight.kind === "activate" && spotlight.token !== destaqueLido) {
    setDestaqueLido(spotlight.token);
    const elo = snapshot.chainLinks.find(
      (l) => l.link === spotlight.link && l.code === spotlight.code,
    );
    setPreview(
      elo
        ? {
            code: elo.code,
            controller: elo.zone.controller as 0 | 1,
            location: elo.zone.location as OcgLocation,
            sequence: elo.zone.sequence,
          }
        : { code: spotlight.code },
    );
    setAtivacaoLida({
      code: spotlight.code,
      link: spotlight.link,
      mine: spotlight.mine,
      from: spotlight.from,
      description: spotlight.description ?? elo?.description ?? null,
    });
  }
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /**
   * Jogada esperando a zona — "Invocar" escolhido, zona ainda não. Nada foi
   * enviado ao core: "Cancelar" (ou Esc) só fecha. Ver `zone-first.ts`.
   */
  const [zonaAntes, setZonaAntes] = useState<{
    action: CardAction;
    key: string;
    zones: SelectFieldPlace[];
  } | null>(null);
  /**
   * A zona já escolhida para a jogada enviada: quando o core perguntar a zona
   * (o próximo prompt), a resposta é esta. `antes` é o prompt em que a jogada
   * foi feita — a resposta vale para o PRÓXIMO. Consumida uma vez só (ver
   * `zonaConsumida`); depois fica inerte até a próxima escolha.
   */
  const [zonaEscolhida, setZonaEscolhida] = useState<{
    zona: SelectFieldPlace;
    antes: number;
  } | null>(null);
  const zonaConsumida = useRef<object | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  /** Painel do próprio deck, de onde se desiste. */
  const [deckAberto, setDeckAberto] = useState(false);
  /**
   * Pilha aberta para consulta (cemitério, banidas, extra, materiais).
   *
   * Guarda COMO achar a lista, não a lista: com o modal aberto a pilha muda
   * (uma carta cai no cemitério, um Pêndulo volta para o Extra Deck) e uma
   * cópia tirada no clique mostraria o passado.
   */
  const [openPile, setOpenPile] = useState<{
    title: string;
    pick: (players: { you: BoardPlayer; foe: BoardPlayer }) => BoardCard[];
  } | null>(null);
  /** Histórico de revelações aberto. */
  const [revelacoesAbertas, setRevelacoesAbertas] = useState(false);
  /**
   * Modal de decisão momentaneamente escondido para o jogador olhar a mesa.
   *
   * Decidir se encadeia depende do tabuleiro — quantos monstros ele tem, o que
   * está baixado, quanto LP sobrou — e o modal cobre exatamente isso. Some sem
   * responder nada; a decisão continua pendurada e volta pelo botão flutuante.
   */
  const [modalEspiado, setModalEspiado] = useState(false);
  /** Lista de "Outras jogadas" (cartas fora da mesa e das pilhas) aberta. */
  const [outrasAbertas, setOutrasAbertas] = useState(false);
  /** Resultado do duelo encolhido para ver a mesa final. */
  const [resultadoEspiado, setResultadoEspiado] = useState(false);
  /** Ctrl segurado — força a pergunta em toda janela (ver `onForceAsk`). */
  const [ctrlHeld, setCtrlHeld] = useState(false);
  /**
   * Mesa estreita (tablet em pé, celular): sem os trilhos laterais. A leitura
   * da carta abre numa folha (toque longo) e o histórico num painel.
   */
  const estreita = useMediaQuery(NARROW_TABLE_QUERY);
  /**
   * Hologramas: na mesa estreita, nenhum — sem câmera inclinada nem espaço
   * entre as fileiras, ele só cobriria a fileira de trás. O índice (quem tem
   * holograma) é lido uma vez e serve à camada dos hologramas e à saída do
   * campo (o holograma se estilhaça antes da carta).
   */
  const modoHolograma = estreita ? "off" : prefs.holograms;
  const holoIndex = useHologramIndex(modoHolograma !== "off");
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  /** O "i" do Master Duel: ATK em campo e o tamanho das pilhas de cada um. */
  const [infoAberta, setInfoAberta] = useState(false);
  /** O "!" do Master Duel: o que está limitando as jogadas agora. */
  const [efeitosAbertos, setEfeitosAbertos] = useState(false);
  /**
   * Altura (na tela) da linha do meio da mesa — onde o botão de fase do MD
   * fica, à direita. Medida, e não fixa: depende da inclinação da câmera, do
   * formato (o TCG tem a fileira das Zonas Extra no meio) e do tamanho da
   * janela.
   */
  const [centroDaMesa, setCentroDaMesa] = useState<number | null>(null);
  /** Dicas de primeira vez (`tips.ts`) — desligáveis na engrenagem. */
  const dicas = useTips();

  /**
   * Rótulos das opções de efeito. Recurso estático e igual para qualquer
   * duelo, então é buscado aqui e não carregado pela sessão. Se a busca
   * falhar, o pior caso é voltar a "Opção 1" — o duelo não quebra por isso.
   */
  const [engineStrings, setEngineStrings] = useState<EngineStringsDb>(
    EMPTY_ENGINE_STRINGS,
  );
  useEffect(() => {
    let cancelado = false;
    fetchEngineStrings()
      .then((db) => {
        if (!cancelado) setEngineStrings(db);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  /**
   * Nomes que se pode declarar (ANNOUNCE_CARD): o pool do formato do duelo.
   * O catálogo traz o TCG inteiro; num duelo Goat, oferecer um Link para
   * declarar seria oferecer um nome que nem existia em 2005.
   */
  const announcePool = useMemo(
    () =>
      cards.filter((card) =>
        snapshot.format === "goat" ? card.goat : card.playable !== false,
      ),
    [cards, snapshot.format],
  );

  const prompt = snapshot.pendingPrompt;

  /**
   * Banco oficial (tipos, raça, atributo, setcodes em bitfield), buscado só
   * quando um ANNOUNCE_CARD aparece: é com ele que a busca de nomes avalia o
   * filtro do core. No duelo online a tela não roda o engine e não o tinha.
   */
  const [officialDb, setOfficialDb] = useState<OfficialCardDb | null>(null);
  const precisaDoBanco = prompt?.type === OcgMessageType.ANNOUNCE_CARD;
  useEffect(() => {
    if (!precisaDoBanco || officialDb) return;
    let cancelado = false;
    fetchOfficialCardDb()
      .then((db) => {
        if (!cancelado) setOfficialDb(db);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [precisaDoBanco, officialDb]);

  const plan = useMemo(
    () => (prompt ? buildPromptPlan(prompt, engineStrings) : null),
    [prompt, engineStrings],
  );

  // A zona escolhida antes do comando responde a pergunta de zona do core.
  // É consumida no PRIMEIRO prompt deste assento depois do comando: se ele
  // não for a pergunta de zona (ou não oferecer a zona escolhida), a escolha
  // é descartada e o jogador escolhe como sempre — ela nunca responde outra
  // pergunta por engano.
  useEffect(() => {
    const escolha = zonaEscolhida;
    if (!escolha || zonaConsumida.current === escolha) return;
    // Pelo `promptId`, e não pela identidade do objeto: no online cada
    // mensagem do servidor traz um prompt novo, mesmo sendo a mesma pergunta.
    if (
      !prompt ||
      snapshot.promptId === escolha.antes ||
      snapshot.promptPlayer !== me ||
      snapshot.isProcessing
    )
      return;
    zonaConsumida.current = escolha;
    const resposta =
      plan && plan.places.length > 0 ? placeResponseFor(plan.places, escolha.zona) : null;
    if (resposta) onRespond(resposta);
  }, [zonaEscolhida, prompt, plan, snapshot.promptId, snapshot.promptPlayer, snapshot.isProcessing, me, onRespond]);

  // Um prompt novo zera seleção/menu do anterior. Ajustar durante o render (em
  // vez de num efeito) evita exibir por um frame o menu do prompt antigo.
  const [lastPrompt, setLastPrompt] = useState(prompt);
  if (prompt !== lastPrompt) {
    setLastPrompt(prompt);
    setMenuFor(null);
    setZonaAntes(null);
    setPicked([]);
    setModalEspiado(false);
    setOutrasAbertas(false);
  }

  // A leitura já vem mascarada na ótica de `me` (ver `readBoardState`), então
  // `boards[me]` é o único tabuleiro que esta tela tem direito de mostrar.
  const board = snapshot.boards[me];
  const you = board?.players[me] ?? EMPTY_PLAYER;
  const foe = board?.players[foeSeat] ?? EMPTY_PLAYER;

  /**
   * A carta em leitura com os valores de AGORA.
   *
   * Como o painel fica na última carta lida, ela pode ter mudado desde então
   * (perdeu ATK, ganhou contador) ou saído do campo. Se ainda está na mesma
   * zona, o painel mostra a versão atual; se saiu, mostra a carta impressa —
   * nunca um ATK de três jogadas atrás.
   */
  const previewShown = useMemo((): PreviewCard | null => {
    if (!preview) return null;
    const { controller, location, sequence } = preview;
    if (
      controller === undefined ||
      sequence === undefined ||
      (location !== OcgLocation.MZONE && location !== OcgLocation.SZONE)
    ) {
      return preview;
    }
    const lado = controller === me ? you : foe;
    const atual =
      location === OcgLocation.MZONE
        ? lado.monsters[sequence]
        : sequence === FIELD_ZONE_SEQUENCE
          ? lado.field
          : lado.spells[sequence];
    return atual && atual.code === preview.code ? atual : { code: preview.code };
  }, [preview, me, you, foe]);

  // Antes da primeira carta lida, a leitura mostra a carta de que se trata
  // agora — o elo da corrente, ou a carta que a pergunta cita —, em vez de um
  // "passe o mouse" vazio.
  const cartaEmLeitura: PreviewCard | null =
    previewShown ??
    (snapshot.chain
      ? { code: snapshot.chain.code }
      : snapshot.promptCard
        ? { code: snapshot.promptCard }
        : null);

  /**
   * Quem ativou. "Você"/"Oponente" como no resto da mesa — o nome do deck do
   * bot ("Baralho Inicial: Kaiba") não cabe no selo; quem só assiste bot × bot
   * não é "Você", e lá vão os nomes.
   */
  const nomesDaAtivacao = spectating
    ? { mine: playerName, foe: opponentName }
    : { mine: "Você", foe: "Oponente" };
  /**
   * O cabeçalho "⛓ Elo N — fulano ativou" na leitura, enquanto ela mostra a
   * carta que a ativação trouxe. O estado do elo (negado?) vem da corrente
   * viva; depois do fim dela fica o que se sabia.
   */
  const ativacaoEmLeitura: ActivationHeader | null =
    ativacaoLida && cartaEmLeitura?.code === ativacaoLida.code
      ? {
          ...ativacaoLida,
          who: ativacaoLida.mine ? nomesDaAtivacao.mine : nomesDaAtivacao.foe,
          state:
            snapshot.chainLinks.find(
              (l) => l.link === ativacaoLida.link && l.code === ativacaoLida.code,
            )?.state ?? null,
        }
      : null;

  /**
   * Mesa de Master Rule 2020: Zonas de Monstro Extra, Pêndulo nas pontas da
   * fileira de magias, Nível/Rank/Link à vista. No Goat a mesa continua a de
   * 2005 — cinco zonas por fileira e nada que a regra não tinha.
   */
  const isTcg = snapshot.format === "tcg";

  /** Zona → nomes dos Links que apontam para ela. */
  const linkedBy = useMemo(() => {
    const names = new Map<string, string[]>();
    if (!board || !isTcg) return names;
    linkedZones(board).forEach((codes, key) => {
      names.set(
        key,
        codes.map((code) => {
          const definition = registry?.get(code);
          return definition ? texto.name(definition) : `Carta ${code}`;
        }),
      );
    });
    return names;
  }, [board, isTcg, registry, texto]);

  /**
   * As marcas de uma carta (`card-marks.ts`), com os nomes resolvidos NA
   * ÓTICA DE QUEM OLHA: "equipada a" uma carta baixada do oponente diz "carta
   * baixada", não o nome dela.
   */
  const marksOf = useCallback(
    (card: BoardCard | null | undefined): CardMark[] => {
      if (!card || card.code === null) return [];
      return cardMarks(card, {
        engineStrings,
        cardName: (code) => {
          const definition = registry?.get(code);
          return definition ? texto.name(definition) : `Carta ${code}`;
        },
        nameAt: (zone) => {
          const lado = zone.controller === me ? you : foe;
          const alvo =
            zone.location === OcgLocation.MZONE
              ? lado.monsters[zone.sequence]
              : zone.sequence === FIELD_ZONE_SEQUENCE
                ? lado.field
                : lado.spells[zone.sequence];
          if (!alvo) return "uma carta";
          if (alvo.code === null) return "uma carta baixada";
          const definition = registry?.get(alvo.code);
          return definition ? texto.name(definition) : `Carta ${alvo.code}`;
        },
      });
    },
    [engineStrings, registry, me, you, foe, texto],
  );

  /**
   * Zona inutilizada? A máscara do core vem na ótica do jogador 0 (bits 0–6
   * monstros e 8–12 magias dele; +16 para o jogador 1).
   */
  const isDisabledZone = useCallback(
    (owner: 0 | 1, location: number, sequence: number) => {
      const bit =
        (owner === 0 ? 0 : 16) + (location === OcgLocation.SZONE ? 8 : 0) + sequence;
      return ((snapshot.disabledZones >>> bit) & 1) === 1;
    },
    [snapshot.disabledZones],
  );

  // Online o snapshot já vem recortado (`projectSnapshot`); num duelo local ele
  // traz as duas óticas, e o filtro aqui é o que impede o histórico de mostrar
  // uma revelação que era do outro assento.
  const minhasRevelacoes = useMemo(
    () => snapshot.reveals.filter((reveal) => reveal.visibleTo === me),
    [snapshot.reveals, me],
  );

  /** O engine está esperando o outro assento — nada aqui é clicável. */
  const waitingForFoe =
    snapshot.promptPlayer !== null && snapshot.promptPlayer !== me;

  /**
   * "O oponente está jogando…": no turno dele nada é clicável e a mesa anda
   * sozinha, no ritmo das animações. Sem aviso, uma pausa longa parecia
   * travamento — é o que os testes de navegador chegaram a acusar como
   * "TRAVOU". O aviso entra com atraso (no CSS), para não piscar a cada
   * jogada curta.
   */
  const foeIsPlaying =
    snapshot.isProcessing && snapshot.turnPlayer === foeSeat && snapshot.winner === null;

  // Enquanto o engine espera o outro assento não há nada a clicar aqui — e o
  // `plan` já vem vazio, mas travar explicitamente evita que um resquício de
  // seleção do prompt anterior continue respondendo ao mouse.
  const busy = snapshot.isProcessing || waitingForFoe;
  const selection = plan?.selection ?? null;
  const announce = plan?.announce ?? null;
  const placeSelection = plan?.placeSelection ?? null;
  /**
   * Instrução de uma seleção: a dica do core quando houver ("Selecione o(s)
   * card(s) para usar como Matéria de Sincro"), senão a genérica do plano.
   * A contagem já aparece ao lado, na barra.
   */
  const selectionInstruction = snapshot.promptHint ?? plan?.instruction ?? "";

  function respond(response: OcgResponse) {
    setMenuFor(null);
    setPicked([]);
    onRespond(response);
  }

  const actionableKeys = useMemo(() => {
    const keys = new Set<string>();
    plan?.byCard.forEach((_, key) => keys.add(key));
    selection?.keys.forEach((key) => keys.add(key));
    return keys;
  }, [plan, selection]);

  const placeByKey = useMemo(() => {
    const map = new Map<string, OcgResponse>();
    plan?.places.forEach(({ place, response }) => {
      map.set(cardKey(place.player, place.location, place.sequence), response);
    });
    return map;
  }, [plan]);

  /** Índice de cada zona candidata em `placeSelection.places` (SELECT_PLACE/DISFIELD com count>1). */
  const placeSelectionKeys = useMemo(() => {
    const map = new Map<string, number>();
    placeSelection?.places.forEach((place, index) => {
      map.set(cardKey(place.player, place.location, place.sequence), index);
    });
    return map;
  }, [placeSelection]);

  /** Cartas já incluídas na soma sem precisar de clique (SELECT_SUM: `selects_must`). */
  const lockedKeys = useMemo(() => {
    const keys = new Set<string>();
    selection?.locked?.forEach((candidate) => {
      keys.add(cardKey(candidate.controller, candidate.location, candidate.sequence));
    });
    return keys;
  }, [selection]);

  function togglePick(index: number) {
    setPicked((current) => {
      if (current.includes(index)) {
        return current.filter((value) => value !== index);
      }
      const max = selection?.max ?? announce?.count ?? placeSelection?.count;
      if (max !== undefined && current.length >= max) {
        return [...current.slice(1), index];
      }
      return [...current, index];
    });
  }

  /**
   * Uma jogada escolhida no menu da carta. Se a zona pode ser escolhida antes
   * do comando (ver `zone-first.ts`), abre a escolha — sem falar com o core,
   * para que "Cancelar" ainda seja possível; senão, vai direto.
   */
  function escolherJogada(action: CardAction, key: string) {
    const definition = registry?.get(action.code);
    const zonas = definition
      ? zonesBeforeCommand(
          {
            label: action.label,
            detail: action.detail,
            response: action.response,
            location: action.location,
            level: definition.level ?? null,
            kind: /monster/i.test(definition.type)
              ? "monster"
              : /spell/i.test(definition.type)
                ? "spell"
                : /trap/i.test(definition.type)
                  ? "trap"
                  : "other",
            isFieldSpell: /spell/i.test(definition.type) && definition.race === "Field",
            isPendulum: definition.frameType.includes("pendulum"),
          },
          { seat: me, monsters: you.monsters, spells: you.spells, isDisabled: isDisabledZone },
        )
      : null;
    if (!zonas) {
      respond(action.response);
      return;
    }
    playSfx("click");
    setMenuFor(null);
    setZonaAntes({ action, key, zones: zonas });
  }

  /** A zona escolhida: agora sim o comando vai ao core. */
  function confirmarZona(zona: SelectFieldPlace) {
    if (!zonaAntes) return;
    setZonaEscolhida({ zona, antes: snapshot.promptId });
    const { action } = zonaAntes;
    setZonaAntes(null);
    respond(action.response);
  }

  const slotProps: SlotPropsFn = (card, zone) => {
    const key = cardKey(zone.player, zone.location, zone.sequence);
    // Escolhendo a zona de uma jogada: só as zonas candidatas respondem ao
    // clique — o resto da mesa espera (Esc ou "Cancelar" desistem).
    if (zonaAntes) {
      const candidata =
        !card &&
        zonaAntes.zones.some(
          (z) => z.player === zone.player && z.location === zone.location && z.sequence === zone.sequence,
        );
      const origem = key === zonaAntes.key;
      return {
        // Só as zonas brilham (são o que se clica); a carta que vai para a
        // zona fica marcada, sem parecer jogada.
        highlighted: candidata,
        intent: "place" as const,
        selected: origem,
        onClick: candidata ? () => confirmarZona(zone) : undefined,
        menu: null,
        onChoose: () => {},
        onCloseMenu: () => {},
      };
    }
    const placeResponse = placeByKey.get(key);
    const placeSelectionIndex = placeSelectionKeys.get(key) ?? -1;
    const hasActions = card ? actionableKeys.has(key) : false;
    const selectionIndex = selection?.keys.indexOf(key) ?? -1;
    const isLocked = lockedKeys.has(key);
    const alreadyChosen =
      selectionIndex >= 0 && (selection?.alreadyChosen?.includes(selectionIndex) ?? false);
    const isPicked =
      isLocked ||
      // Seleção imediata: a marca é só o que o core já tem escolhido.
      (selectionIndex >= 0 &&
        (selection?.immediate
          ? alreadyChosen
          : picked.includes(selectionIndex) !== alreadyChosen)) ||
      (placeSelectionIndex >= 0 && picked.includes(placeSelectionIndex));

    const clickable =
      !busy &&
      !isLocked &&
      (Boolean(placeResponse) || hasActions || placeSelectionIndex >= 0);

    // O realce diz QUAL é a oferta, como no Master Duel: amarelo é efeito a
    // ativar, azul é jogada comum (Invocar, Baixar, Atacar, mudar posição) —
    // e as duas cores juntas quando a carta tem as duas. Alvo de seleção e
    // zona vazia têm realce próprio.
    const acoes = hasActions ? (plan?.byCard.get(key) ?? []) : [];
    const temEfeito = acoes.some((acao) => commandKind(acao.label) === "activate");
    const temComum = acoes.some((acao) => commandKind(acao.label) !== "activate");
    const intent: SlotIntent = hasActions
      ? temEfeito && temComum
        ? "both"
        : temEfeito
          ? "activate"
          : "action"
      : selectionIndex >= 0
        ? "select"
        : "place";

    return {
      highlighted: clickable || isPicked,
      intent,
      selected: isPicked,
      onClick: clickable
        ? () => {
            if (placeSelectionIndex >= 0 && !card) {
              togglePick(placeSelectionIndex);
              return;
            }
            if (placeResponse && !card) {
              respond(placeResponse);
              return;
            }
            if (selectionIndex >= 0) {
              // SELECT_UNSELECT_CARD: o clique marca/desmarca no core na hora.
              if (selection?.immediate) {
                respond(selection.build([selectionIndex]));
                return;
              }
              // Escolha de exatamente 1 carta: clicar de novo na marcada
              // confirma — o clique duplo do Master Duel. "Confirmar"
              // continua lá para quem prefere.
              if (
                selection &&
                selection.min === 1 &&
                selection.max === 1 &&
                !selection.alreadyChosen?.length &&
                picked.length === 1 &&
                picked[0] === selectionIndex &&
                (selection.isValid?.(picked) ?? true)
              ) {
                respond(selection.build(picked));
                return;
              }
              togglePick(selectionIndex);
              return;
            }
            setMenuFor((current) => (current === key ? null : key));
          }
        : undefined,
      menu: menuFor === key ? (plan?.byCard.get(key) ?? null) : null,
      onChoose: (action: CardAction) => escolherJogada(action, key),
      onCloseMenu: () => setMenuFor(null),
    };
  };

  /** Abre os materiais Xyz de um monstro (selo no slot). */
  const openMaterials = (card: BoardCard) => () =>
    setOpenPile({
      title: `Materiais Xyz — ${(() => {
        const definition = registry?.get(card.code ?? 0);
        return definition ? texto.name(definition) : "monstro";
      })()}`,
      // O monstro é reencontrado pela zona: os materiais mudam (desanexar é
      // o custo mais comum de um Xyz) com o modal aberto.
      pick: (players) => {
        const lado = card.controller === me ? players.you : players.foe;
        const atual = lado.monsters[card.sequence];
        return atual ? overlayCards(atual) : [];
      },
    });

  /**
   * Número do elo em cada carta do campo que está na corrente — como os
   * números de corrente do Master Duel: dá para ver de relance quem ativou o
   * quê e em que ordem vai resolver. Quem saiu da mão (hand trap) aparece na
   * pilha da corrente e no destaque, não tem slot.
   */
  const chainAt = useMemo(() => {
    const map = new Map<string, ChainBadge>();
    for (const link of snapshot.chainLinks ?? []) {
      const { controller, location, sequence } = link.zone;
      if (location !== OcgLocation.MZONE && location !== OcgLocation.SZONE) continue;
      map.set(cardKey(controller, location, sequence), {
        link: link.link,
        mine: link.player === me,
        state: link.state,
      });
    }
    return map;
  }, [snapshot.chainLinks, me]);
  const chainBadgeOf = useCallback((key: string) => chainAt.get(key), [chainAt]);

  /**
   * O ATK/DEF grande de cada monstro de face para cima — desenhado numa camada
   * plana por cima da mesa inclinada (ver `FieldStatsLayer`).
   */
  const statsDaMesa = useMemo((): FieldStat[] => {
    const lista: FieldStat[] = [];
    const incluir = (card: BoardCard | null) => {
      if (!card || card.code === null || card.faceDown || card.attack === null) return;
      const definition = registry?.get(card.code);
      const isXyz = Boolean(definition?.frameType.includes("xyz"));
      // Nível/Rank/Link ATUAIS do core; o impresso vem do catálogo (no Xyz o
      // catálogo guarda o Rank em `level`).
      const grade: FieldGrade | null = card.link
        ? { kind: "link", value: card.link.rating, base: definition?.linkval ?? null, tuner: false }
        : card.rank
          ? { kind: "rank", value: card.rank, base: isXyz ? (definition?.level ?? null) : null, tuner: false }
          : card.level
            ? {
                kind: "level",
                value: card.level,
                base: !isXyz ? (definition?.level ?? null) : null,
                tuner: Boolean(
                  definition?.type?.includes("Tuner") || definition?.humanReadableCardType?.includes("Tuner"),
                ),
              }
            : null;
      lista.push({
        zoneKey: cardKey(card.controller, OcgLocation.MZONE, card.sequence),
        atk: card.attack,
        def: card.defenseValue,
        baseAtk: card.baseAttack ?? definition?.atk ?? null,
        baseDef: card.baseDefense ?? definition?.def ?? null,
        isLink: Boolean(card.link || definition?.linkval),
        attribute: card.attribute ?? definition?.attribute ?? null,
        baseAttribute: definition?.attribute ?? null,
        grade,
      });
    };
    you.monsters.forEach(incluir);
    foe.monsters.forEach(incluir);
    return lista;
  }, [you.monsters, foe.monsters, registry]);

  /**
   * Os monstros de face para cima que podem ganhar holograma (ver
   * `MonsterHologramsLayer`). Carta virada não tem: nem a do oponente (a mesa
   * nem sabe o que é) nem a sua, que você vê translúcida.
   */
  const hologramas = useMemo((): HoloMonster[] => {
    const lista: HoloMonster[] = [];
    const incluir = (card: BoardCard | null, foeSide: boolean) => {
      if (!card || card.code === null || card.faceDown) return;
      lista.push({
        zoneKey: cardKey(card.controller, OcgLocation.MZONE, card.sequence),
        code: card.code,
        foeSide,
        defense: Boolean(card.defense),
        // O brilho na cor do atributo ATUAL, o mesmo do círculo.
        attribute: (card.attribute ?? registry?.get(card.code)?.attribute ?? "").toLowerCase(),
      });
    };
    you.monsters.forEach((card) => incluir(card, false));
    foe.monsters.forEach((card) => incluir(card, true));
    return lista;
  }, [you.monsters, foe.monsters, registry]);

  /**
   * O ataque que acabou de ser declarado tira todos os LP de quem o recebe?
   * É o "Final Blow!" do Master Duel. Conta com a mesa de agora: ataque direto
   * com ATK ≥ LP, ou contra monstro em posição de ataque com a diferença ≥ LP.
   * Contra defesa não há dano (perfurar é exceção rara) e não há anúncio.
   */
  const [golpeFinal, setGolpeFinal] = useState<number | null>(null);
  const [ataqueVisto, setAtaqueVisto] = useState<number | null>(null);
  if (flight && flight.token !== ataqueVisto) {
    setAtaqueVisto(flight.token);
    const lado = (controller: number) => (controller === me ? you : foe);
    const atacante = lado(flight.from.controller).monsters[flight.from.sequence];
    const defensor = (flight.mine ? foeSeat : me) as 0 | 1;
    const lp = snapshot.lifePoints[defensor];
    const atk = atacante?.attack ?? null;
    let letal = false;
    if (atk !== null && lp > 0) {
      if (!flight.to) {
        letal = atk >= lp;
      } else {
        const alvo = lado(flight.to.controller).monsters[flight.to.sequence];
        letal =
          Boolean(alvo) &&
          !alvo!.faceDown &&
          !alvo!.defense &&
          alvo!.attack !== null &&
          atk - alvo!.attack >= lp;
      }
    }
    if (letal) setGolpeFinal(flight.token);
  }
  useEffect(() => {
    if (golpeFinal === null) return;
    playSfx("finalBlow");
    const timer = setTimeout(() => setGolpeFinal(null), Math.round(1900 * animationScale));
    return () => clearTimeout(timer);
  }, [golpeFinal, animationScale]);

  /** Toque longo numa carta: na mesa estreita, a leitura sobe numa folha. */
  const abrirLeitura = useCallback(
    (card: BoardCard) => {
      showPreview(card);
      setFolhaAberta(true);
    },
    [showPreview],
  );
  const onLongPress = estreita ? abrirLeitura : undefined;

  const shared = {
    registry,
    onHover: showPreview,
    onLongPress,
    slotProps,
    isTcg,
    linkedBy,
    openMaterials,
    marksOf,
    isDisabledZone,
    chainBadgeOf,
  };

  /**
   * Uma Zona de Monstro Extra, vista de `me`.
   *
   * As duas Zonas Extra são compartilhadas: a da esquerda (na tela de quem
   * olha) é a zona 5 de `me` e a zona 6 do oponente. Quem estiver nela é
   * desenhado — de cabeça para baixo se for do oponente —, e é pela identidade
   * DELE que a zona casa com as ações e as seleções do engine.
   */
  function extraZone(side: "left" | "right") {
    const mineSeq = side === "left" ? 5 : 6;
    const foeSeq = side === "left" ? 6 : 5;
    const mine = you.monsters[mineSeq] ?? null;
    const theirs = foe.monsters[foeSeq] ?? null;
    const card = mine ?? theirs;
    const owner = theirs && !mine ? foeSeat : me;
    const sequence = owner === me ? mineSeq : foeSeq;
    let zone: SelectFieldPlace = { player: owner, location: OcgLocation.MZONE, sequence };
    let props = slotProps(card, zone);
    // Vazia: a zona pode ter sido oferecida pela identidade do oponente (um
    // efeito que invoca para o lado dele) — vale a que estiver clicável.
    if (!card && !props.onClick) {
      const alt: SelectFieldPlace = {
        player: foeSeat,
        location: OcgLocation.MZONE,
        sequence: foeSeq,
      };
      const altProps = slotProps(null, alt);
      if (altProps.onClick) {
        zone = alt;
        props = altProps;
      }
    }
    const key = cardKey(zone.player, zone.location, zone.sequence);
    return (
      <DuelCardSlot
        card={card}
        registry={registry}
        placeholder=""
        zoneKind="emz"
        foeSide={owner === foeSeat}
        zoneKey={key}
        onHover={showPreview}
        onLongPress={onLongPress}
        linkedBy={linkedBy.get(key)}
        onOpenMaterials={card?.overlays.length ? openMaterials(card) : undefined}
        marks={slotChips(marksOf(card))}
        disabledZone={isDisabledZone(zone.player as 0 | 1, zone.location, zone.sequence)}
        chainBadge={chainBadgeOf(key)}
        {...props}
      />
    );
  }
  const showModal = plan?.presentation === "modal" && !busy;

  // A regra mora em `prompt-reach.ts` porque o harness também precisa dela:
  // um teste que reimplementasse "o que dá para clicar" deixaria de valer no
  // dia em que a mesa mudasse.
  const needsPicker =
    selection != null && needsCardPicker(selection.candidates, me);

  /**
   * Qual diálogo de decisão está aberto agora, se algum.
   *
   * Uma resposta só, e não uma condição por modal espalhada no JSX, porque é
   * ela que decide o que o "Ver a mesa" esconde e o que o Esc alterna — e todo
   * diálogo de decisão tem de poder ser escondido (`DecisionShell`).
   */
  const decision: "prompt" | "picker" | "sort" | "announce" | "counters" | null =
    needsPicker && selection && plan
      ? "picker"
      : plan?.sorting && !busy
        ? "sort"
        : showModal && plan?.announceCard
          ? "announce"
          : showModal && plan?.counters
            ? "counters"
            : showModal && plan
              ? "prompt"
              : null;
  const peek = () => setModalEspiado(true);

  /** A seleção em curso já pode ser confirmada? (Enter e o duplo clique.) */
  const selectionReady =
    selection != null &&
    picked.length >= selection.min &&
    picked.length <= selection.max &&
    (selection.isValid?.(picked) ?? true);
  const placeReady = placeSelection != null && picked.length === placeSelection.count;

  /** A dica da vez, se houver — uma por vez, no momento em que serve. */
  const minhaPergunta = Boolean(prompt) && snapshot.promptPlayer === me && !busy;
  const dica =
    // Quem escondeu a decisão para olhar a mesa quer a mesa limpa: a dica
    // espera, como a própria decisão.
    spectating || dicas.tips.off || modalEspiado || snapshot.turnCount === 0 || snapshot.winner !== null
      ? null
      : nextTip(
          {
            myPrompt: minhaPergunta,
            canPlay:
              minhaPergunta && prompt?.type === OcgMessageType.SELECT_IDLECMD && actionableKeys.size > 0,
            battle: minhaPergunta && prompt?.type === OcgMessageType.SELECT_BATTLECMD,
            chainWindow: minhaPergunta && prompt?.type === OcgMessageType.SELECT_CHAIN,
            decisionOpen: decision !== null && !modalEspiado,
            inlineSelection: minhaPergunta && ((selection != null && !needsPicker) || placeSelection != null),
          },
          new Set(dicas.tips.seen),
        );

  /**
   * Teclado da mesa. Num ref, e não nas dependências de um efeito: o efeito
   * registra o ouvinte uma vez, e o ouvinte sempre lê o estado do render mais
   * recente — sem recadastrar a cada clique.
   */
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const handleKey = (event: KeyboardEvent) => {
    const alvo = event.target as HTMLElement | null;
    const digitando =
      alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA" || alvo?.tagName === "SELECT";

    if (event.key === "Escape") {
      // Primeiro o que é consulta (fecha), depois a decisão (esconde/mostra).
      if (zonaAntes) setZonaAntes(null);
      else if (menuFor) setMenuFor(null);
      else if (folhaAberta) setFolhaAberta(false);
      else if (historicoAberto) setHistoricoAberto(false);
      else if (openPile) setOpenPile(null);
      else if (revelacoesAbertas) setRevelacoesAbertas(false);
      else if (outrasAbertas) setOutrasAbertas(false);
      else if (deckAberto) setDeckAberto(false);
      else if (decision) setModalEspiado((atual) => !atual);
      else if (snapshot.winner != null) setResultadoEspiado((atual) => !atual);
      else return;
      event.preventDefault();
      return;
    }

    // Enter num elemento clicável (botão, carta focada) é dele: a carta marca
    // a si mesma no mesmo toque, e confirmar junto mandaria a seleção de
    // ANTES do clique.
    const clicavel = alvo?.tagName === "BUTTON" || alvo?.getAttribute("role") === "button";
    if (event.key === "Enter" && !digitando && !clicavel && !event.defaultPrevented && !busy) {
      if (selection?.immediate && (!needsPicker || !modalEspiado)) {
        // Enter = "Concluir", quando o core já aceita encerrar.
        const concluir = plan?.global[0];
        if (concluir) {
          event.preventDefault();
          respond(concluir.response);
        }
      } else if (selection && selectionReady && (!needsPicker || !modalEspiado)) {
        event.preventDefault();
        respond(selection.build(picked));
      } else if (placeSelection && placeReady) {
        event.preventDefault();
        respond(placeSelection.build(picked.map((index) => placeSelection.places[index])));
      }
    }
  };
  useEffect(() => {
    onKeyRef.current = handleKey;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl segurado = perguntar em toda janela. Soltar a tecla, e também perder
  // o foco da janela com ela apertada (Ctrl+Tab), desliga. O callback mora num
  // ref: quem passa uma função nova a cada render não pode derrubar o gesto no
  // meio (a limpeza do efeito soltaria o Ctrl).
  const onForceAskRef = useRef(onForceAsk);
  useEffect(() => {
    onForceAskRef.current = onForceAsk;
  }, [onForceAsk]);
  useEffect(() => {
    let segurando = false;
    const set = (valor: boolean) => {
      if (segurando === valor) return;
      segurando = valor;
      setCtrlHeld(valor);
      onForceAskRef.current?.(valor);
    };
    const down = (event: KeyboardEvent) => {
      if (event.key === "Control") set(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Control") set(false);
    };
    const blur = () => set(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      set(false);
    };
  }, []);

  // O botão de fase acompanha a linha do meio da mesa. Medida depois de cada
  // render que muda a mesa (formato, janela, mão que cresce e empurra a
  // câmera): um ResizeObserver na área e na própria linha cobre os dois.
  useEffect(() => {
    const stage = stageRef.current;
    const field = fieldRef.current;
    if (!stage || !field) return;
    const medir = () => {
      const linha = field.querySelector<HTMLElement>("[data-center-line]");
      if (!linha) return;
      const s = stage.getBoundingClientRect();
      const r = linha.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2 - s.top);
      setCentroDaMesa((atual) => (atual === y ? atual : y));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(stage);
    observador.observe(field);
    window.addEventListener("resize", medir);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [isTcg, estreita]);

  /**
   * Jogadas em cartas FORA da mesa desenhada (Extra Deck, Cemitério, banidas,
   * Deck, materiais), num prompt em que se joga clicando na carta.
   *
   * Agrupadas por pilha (`controller:location`): a pilha brilha e abre com as
   * cartas jogáveis em destaque. O que não mora numa pilha desenhada (Deck,
   * material Xyz) vai para "Outras jogadas", para nunca haver jogada que o
   * engine oferece e a tela esconde.
   */
  const { pilhasComJogada, outrasJogadas } = useMemo(() => {
    const pilhas = new Set<string>();
    const outras: CardAction[] = [];
    if (plan && plan.presentation === "inline" && !busy) {
      plan.byCard.forEach((actions, key) => {
        const [controller, location] = key.split(":").map(Number);
        const onde = actionReach(location);
        if (onde === "pile") pilhas.add(`${controller}:${location}`);
        else if (onde === "other") outras.push(...actions);
      });
    }
    return { pilhasComJogada: pilhas, outrasJogadas: outras };
  }, [plan, busy]);
  const pilhaAcionavel = (owner: 0 | 1, location: number) =>
    pilhasComJogada.has(`${owner}:${location}`);

  /** Abre a lista de uma pilha. Cemitério e banidas são públicos dos dois
   *  lados; do Extra Deck do oponente só se vê o que está virado para cima. */
  const openWith =
    (title: string, pick: (players: { you: BoardPlayer; foe: BoardPlayer }) => BoardCard[]) =>
    () =>
      setOpenPile({ title, pick });

  /**
   * O conteúdo da pilha aberta, vindo do tabuleiro de agora.
   *
   * Durante uma jogada em andamento a sessão lê o tabuleiro no modo leve, sem
   * o conteúdo das pilhas — a lista chega vazia por um instante. Nesse caso
   * fica a última lista cheia, em vez de o modal piscar "Vazio".
   */
  const pileCards = useMemo(
    () => (openPile ? openPile.pick({ you, foe }) : []),
    [openPile, you, foe],
  );
  // Ajustado durante o render (o mesmo padrão do `lastPrompt` acima): a última
  // lista cheia DESTA pilha.
  const [ultimaPilha, setUltimaPilha] = useState<{
    de: typeof openPile;
    cards: BoardCard[];
  }>({ de: null, cards: [] });
  if (pileCards.length > 0 && (ultimaPilha.de !== openPile || ultimaPilha.cards !== pileCards)) {
    setUltimaPilha({ de: openPile, cards: pileCards });
  }
  const pileShown =
    pileCards.length === 0 && snapshot.isProcessing && ultimaPilha.de === openPile
      ? ultimaPilha.cards
      : pileCards;

  /**
   * "Aguardando Fulano…" / "Fulano está jogando…". Mora debaixo da placa do
   * oponente, junto da luz de quem decide — em cima do campo ele tapava a mão
   * do oponente. Na mesa estreita, logo abaixo dessa mão.
   */
  const avisoDeEspera = waitingForFoe
    ? `Aguardando ${opponentName}…`
    : foeIsPlaying
      ? `${opponentName} está jogando…`
      : null;

  /** As placas de LP, nos cantos — como no Master Duel. */
  const placaMinha = (
    <LifePlate
      name={playerName}
      role={spectating ? "Bot" : "Você"}
      lp={snapshot.lifePoints[me]}
      side="me"
      active={snapshot.turnPlayer === me}
      acting={minhaPergunta}
    />
  );
  const placaDoOponente = (
    <LifePlate
      name={opponentName}
      role="Oponente"
      lp={snapshot.lifePoints[foeSeat]}
      side="foe"
      active={snapshot.turnPlayer === foeSeat}
      acting={waitingForFoe || foeIsPlaying}
    />
  );

  /** Quantos avisos de jogador ("não pode Invocar…") estão valendo — o "!" do MD. */
  const efeitosAtivos = snapshot.playerHints[me].length + snapshot.playerHints[foeSeat].length;

  /** A engrenagem: modo de resposta, velocidade, som, idioma, dicas e saída. */
  const engrenagem = (
    <DuelSettings
      prefs={prefs}
      onChange={onPrefsChange}
      pacing={pacing}
      tips={spectating ? undefined : { on: !dicas.tips.off, onToggle: (on) => dicas.setOff(!on), onReset: dicas.reset }}
      onSurrender={onSurrender && snapshot.winner === null ? onSurrender : undefined}
      leave={{ href: ending.backHref, label: ending.backLabel, confirm: snapshot.winner === null && !spectating }}
    />
  );

  const botoesDaMesa = (
    <HudButtons
      chainMode={onPrefsChange && !spectating ? prefs.chainMode : null}
      forcing={ctrlHeld}
      onChainMode={(chainMode) => onPrefsChange?.({ chainMode })}
      infoOpen={infoAberta}
      onInfo={() => setInfoAberta((aberta) => !aberta)}
      effectsCount={efeitosAtivos}
      effectsOpen={efeitosAbertos}
      onEffects={() => setEfeitosAbertos((abertos) => !abertos)}
      logOpen={historicoAberto}
      onLog={() => setHistoricoAberto((aberto) => !aberto)}
    />
  );

  const botaoDeFase = (
    <PhaseButton
      phase={snapshot.phase}
      turn={snapshot.turnCount}
      mine={snapshot.turnPlayer === me}
      actions={plan?.global ?? []}
      // Escolhendo a zona de uma jogada, a fase não anda: primeiro termina
      // (ou cancela) a jogada.
      disabled={busy || zonaAntes !== null || spectating}
      onRespond={respond}
    />
  );

  return (
    <div
      // Tela cheia, como o Master Duel: a mesa cobre o cabeçalho do site (que
      // fica montado por baixo) e a largura máxima da página. Sair do duelo é
      // pela engrenagem — e, no fim, pelo resultado.
      className={`tf-playmat md-duel fixed inset-0 z-30 flex flex-col overflow-hidden ${
        estreita ? "md-narrow" : "md-wide"
      }`}
      // Estado do motor para quem observa a mesa de fora (os testes de
      // navegador): o turno do bot é ritmado — cada ataque espera a investida
      // inteira —, e sem isto um turno longo dele parecia "nada clicável, mesa
      // parada". O texto "Processando" que o teste procurava já não existe.
      data-processing={snapshot.isProcessing ? "1" : undefined}
      data-waiting-foe={waitingForFoe ? "1" : undefined}
      // De quem é o turno: a borda da metade dele acende na cor dele (azul
      // seu, vermelho do oponente) — a luz de turno do MD.
      data-turn-side={snapshot.turnCount > 0 ? (snapshot.turnPlayer === me ? "me" : "foe") : undefined}
      data-format={snapshot.format}
    >
      {/* O cenário: o fundo que no MD é o ambiente 3D em volta da mesa. */}
      <div aria-hidden className="md-arena" />

      {/* As faixas do MD atravessando a tela inteira ("TURN CHANGE", "BATTLE
          PHASE") e o corte de invocação — por cima do HUD, por baixo das
          decisões. */}
      <PhaseBanner banner={banner} />
      <FinalBlow token={golpeFinal} duration={Math.round(1900 * animationScale)} />
      <SummonCutIn
        cutIn={pacing === "room" || prefs.cutIns ? cutIn : null}
        registry={registry}
        onSkip={() => {
          dismissCutIn();
          onHurry?.();
        }}
      />

      {/* Mesa estreita (celular, tablet em pé): as placas numa faixa no
          topo — nos cantos elas cobririam a mesa. */}
      {estreita && (
        <div className="md-narrow-top relative z-20 flex shrink-0 items-stretch gap-1.5 px-1.5 pt-1.5">
          <div className="shrink-0">{engrenagem}</div>
          <div className="relative flex min-w-0 flex-1">
            {placaMinha}
            <FlashLayer flashes={flashes} anchor="player" />
          </div>
          <div className="relative flex min-w-0 flex-1">
            {placaDoOponente}
            <FlashLayer flashes={flashes} anchor="opponent" />
          </div>
        </div>
      )}

      <div ref={stageRef} className="md-stage relative flex min-h-0 flex-1 overflow-hidden">
        {/* -------- campo -------- */}
        <div
          ref={fieldRef}
          className={`md-field relative flex min-h-0 min-w-0 flex-1 flex-col ${shake !== null ? "tf-shake" : ""}`}
          // Teto das cartas pela LARGURA do campo (ver `CARD_SHAPE`): o
          // `.md-field` faz a conta em `cqw` deste contêiner.
          style={{ containerType: "inline-size" }}
          data-field
        >
          {/* Clarão no lado atingido. */}
          {shake !== null && (
            <div
              className={`tf-hit-flash pointer-events-none absolute inset-x-0 z-30 h-1/2 bg-red-600/60 ${
                shake === "mine" ? "bottom-0" : "top-0"
              }`}
            />
          )}

          <FlashLayer flashes={flashes} anchor="center" />

          {/* Dica de primeira vez — acima dos diálogos (é deles que ela fala),
              no canto, sem tapar a jogada. */}
          {dica && (
            <div data-tip={dica.id} className="md-tip absolute left-2 top-[12%] z-[55] w-[min(300px,80%)] p-2.5">
              <p className="text-[12px] leading-snug text-zinc-100 [@media(max-height:500px)]:text-[11px]">
                {dica.text}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-table-control
                  onClick={() => dicas.markSeen(dica.id)}
                  className="md-pill md-pill-primary px-3 py-1 text-[11px]"
                >
                  Entendi
                </button>
                <button
                  type="button"
                  data-table-control
                  onClick={() => dicas.setOff(true)}
                  className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  Desligar dicas
                </button>
              </div>
            </div>
          )}

          {estreita && avisoDeEspera && <WaitingBanner text={avisoDeEspera} place="field" />}
          <AttackFlightLayer flight={flight} fieldRef={fieldRef} />
          <LeaveFlightLayer
            leaves={leaves}
            fieldRef={fieldRef}
            registry={registry}
            me={me}
            holoIndex={holoIndex}
            holoMode={modoHolograma}
          />
          <ChainSpotlight
            spotlight={spotlight}
            registry={registry}
            names={nomesDaAtivacao}
            onSkip={() => {
              dismissSpotlight();
              onHurry?.();
            }}
          />
          <DrawFlightLayer draw={draw} fieldRef={fieldRef} />
          {toss && <TossOverlay toss={toss} />}
          {reveal && <RevealOverlay reveal={reveal} registry={registry} />}

          {/* Mão do oponente: versos no alto, cortados pela borda da tela — e
              as faces das que o core marcou como públicas (Olho Mágico da
              Verdade). */}
          <OpponentHand
            cards={foe.hand}
            seat={foeSeat}
            registry={registry}
            onHover={showPreview}
            onLongPress={onLongPress}
          />

          {/* A câmera do Master Duel: a mesa vista de trás e de cima do
              jogador, deitada em perspectiva — o campo do oponente fica mais
              longe e menor, o seu mais perto. Só as fileiras entram no plano
              inclinado; mãos, avisos, voos e diálogos ficam em pé, na tela. As
              animações de voo leem a caixa de cada zona com
              `getBoundingClientRect`, que já devolve a posição projetada. */}
          <div data-board-camera className="md-camera flex min-h-0 flex-1 flex-col">
            <div data-board3d className="md-board flex min-h-0 flex-col justify-center">
              {/* A Magia de Campo muda a mesa, como no MD: a arte dela tinge a
                  metade de quem a controla. */}
              <FieldSpellArt card={foe.field} registry={registry} side="foe" />
              <FieldSpellArt card={you.field} registry={registry} side="me" />
              <FieldCracks lp={snapshot.lifePoints[foeSeat]} side="foe" />
              <FieldCracks lp={snapshot.lifePoints[me]} side="me" />
              {/* Oponente — espelhado (a zona 1 dele fica à direita de quem
                  olha), mas com as cartas de pé, como no MD. */}
              <FieldRow
                cards={foe.spells}
                owner={foeSeat}
                zone="spell"
                mirrored
                left={
                  <DuelPile
                    label="Deck"
                    kind="deck"
                    count={foe.deckSize}
                    warnLow
                    // Índice ABSOLUTO: o voo da compra procura a pilha por
                    // `[data-pile="deck-${player}"]`, com o número que o engine
                    // usa. Fixar "deck-1" aqui mandava a carta do assento 1 para
                    // o deck errado quando ele é quem assiste.
                    dataPile={`deck-${foeSeat}`}
                  />
                }
                right={
                  <DuelPile
                    label="Extra"
                    kind="extra"
                    dataPile={`extra-${foeSeat}`}
                    count={foe.extraSize}
                    badge={faceUpBadge(foe.extraFaceUp)}
                    // Do Extra Deck do oponente só se vê o que é público: os
                    // Pêndulos virados para cima.
                    onOpen={
                      foe.extraFaceUp > 0
                        ? openWith("Extra Deck do oponente — viradas para cima", (p) => p.foe.extra)
                        : undefined
                    }
                    openTitle="Ver os Pêndulos virados para cima no Extra Deck do oponente"
                  />
                }
                {...shared}
              />
              <FieldRow
                cards={foe.monsters.slice(0, 5)}
                owner={foeSeat}
                zone="monster"
                mirrored
                left={
                  <GraveColumn
                    // Do lado de lá, espelhado: o Cemitério em cima (perto do
                    // Deck dele), as banidas embaixo, perto do meio da mesa.
                    order="grave-first"
                    grave={
                      <DuelPile
                        label="Cemit."
                        kind="grave"
                        dataPile={`grave-${foeSeat}`}
                        count={foe.graveSize}
                        onOpen={openWith("Cemitério do oponente", (p) => p.foe.grave)}
                        topCard={foe.graveTop}
                        registry={registry}
                      />
                    }
                    banished={
                      <DuelPile
                        label="Banidas"
                        kind="banished"
                        dataPile={`banished-${foeSeat}`}
                        count={foe.banishedSize}
                        onOpen={openWith("Banidas do oponente", (p) => p.foe.banished)}
                        topCard={foe.banished[foe.banished.length - 1] ?? null}
                        registry={registry}
                      />
                    }
                  />
                }
                right={<FieldSpellSlot player={foe} owner={foeSeat} ownedFaceDown={false} {...shared} />}
                {...shared}
              />

              {/* O meio da mesa. No TCG, a fileira das Zonas Extra: as duas
                  zonas ficam exatamente sobre as colunas 2 e 4, que é o que faz
                  as setas Link de quem está nelas se lerem. No Goat, só a linha
                  que separa os dois campos. O botão de fase se alinha por ela
                  (`data-center-line`). */}
              {isTcg ? (
                <div
                  data-row="extra-monster-zones"
                  data-center-line
                  className="md-row md-row-center flex min-h-0 items-center justify-center"
                >
                  <div className={`${CARD_SHAPE} md-row-spacer`} />
                  <div className={`${CARD_SHAPE} md-row-spacer`} />
                  {extraZone("left")}
                  <div className={`${CARD_SHAPE} md-row-spacer`} />
                  {extraZone("right")}
                  <div className={`${CARD_SHAPE} md-row-spacer`} />
                  <div className={`${CARD_SHAPE} md-row-spacer`} />
                </div>
              ) : (
                <div data-center-line className="md-center-line shrink-0" />
              )}

              <FieldRow
                cards={you.monsters.slice(0, 5)}
                owner={me}
                zone="monster"
                left={<FieldSpellSlot player={you} owner={me} ownedFaceDown {...shared} />}
                right={
                  <GraveColumn
                    order="banished-first"
                    banished={
                      <DuelPile
                        label="Banidas"
                        kind="banished"
                        dataPile={`banished-${me}`}
                        count={you.banishedSize}
                        onOpen={openWith("Suas banidas", (p) => p.you.banished)}
                        topCard={you.banished[you.banished.length - 1] ?? null}
                        registry={registry}
                        actionable={pilhaAcionavel(me, OcgLocation.REMOVED)}
                      />
                    }
                    grave={
                      <DuelPile
                        label="Cemit."
                        kind="grave"
                        dataPile={`grave-${me}`}
                        count={you.graveSize}
                        onOpen={openWith("Seu Cemitério", (p) => p.you.grave)}
                        topCard={you.graveTop}
                        registry={registry}
                        actionable={pilhaAcionavel(me, OcgLocation.GRAVE)}
                      />
                    }
                  />
                }
                {...shared}
              />
              <FieldRow
                cards={you.spells}
                owner={me}
                zone="spell"
                left={
                  <DuelPile
                    label="Extra"
                    kind="extra"
                    dataPile={`extra-${me}`}
                    count={you.extraSize}
                    badge={faceUpBadge(you.extraFaceUp)}
                    onOpen={openWith("Seu Extra Deck", (p) => p.you.extra)}
                    actionable={pilhaAcionavel(me, OcgLocation.EXTRA)}
                  />
                }
                right={
                  <DuelPile
                    label="Deck"
                    kind="deck"
                    count={you.deckSize}
                    warnLow
                    dataPile={`deck-${me}`}
                    // O deck é a única pilha que não se abre para consulta — o
                    // conteúdo é secreto. Sobra como o lugar natural para o
                    // gesto que encerra a partida, como empurrar o deck na mesa
                    // (a engrenagem também tem a rendição, como no MD).
                    onOpen={
                      onSurrender && snapshot.winner === null
                        ? () => setDeckAberto(true)
                        : undefined
                    }
                    openTitle="Seu Deck — desistir do duelo"
                  />
                }
                {...shared}
              />
            </div>
          </div>

          <MonsterHologramsLayer
            monsters={hologramas}
            fieldRef={fieldRef}
            index={holoIndex}
            mode={modoHolograma}
            flight={flight}
            animationScale={animationScale}
          />
          <FieldStatsLayer stats={statsDaMesa} fieldRef={fieldRef} />

          <Hand cards={you.hand} seat={me} {...shared} />

          {/* Janela de resposta na corrente (Master Duel): as cartas que
              respondem brilham, e a barra diz a quê e oferece passar. */}
          {plan &&
            prompt?.type === OcgMessageType.SELECT_CHAIN &&
            snapshot.promptPlayer === me &&
            !busy && (
              <ChainResponseBar
                // Uma pergunta nova zera a escolha e o painel recolhido.
                key={snapshot.promptId}
                plan={plan}
                trigger={isTriggerWindow(prompt)}
                chain={snapshot.chain}
                registry={registry}
                me={me}
                onRespond={respond}
                onHover={showPreview}
              />
            )}

          {/* Escolhendo a zona de uma jogada (ver `zone-first.ts`): nada foi
              enviado ao core ainda, então "Cancelar" de fato desiste. */}
          {zonaAntes && (
            <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center">
              <div data-zone-first data-menu-avoid className="md-banner pointer-events-auto">
                <span className="md-banner-text">
                  {(() => {
                    const definition = registry?.get(zonaAntes.action.code);
                    const nome = definition ? texto.name(definition) : "a carta";
                    return `${zonaAntes.action.label}: escolha a zona para ${nome}`;
                  })()}
                </span>
                <button
                  type="button"
                  data-cancel-zone-first
                  onClick={() => {
                    playSfx("click");
                    setZonaAntes(null);
                  }}
                  className="md-pill md-pill-ghost px-4 py-1.5 text-[13px]"
                >
                  Cancelar <span className="opacity-60">(Esc)</span>
                </button>
              </div>
            </div>
          )}

          {/* A barra da seleção no campo: fica sobre a mesa, centrada, porque
              o jogador precisa continuar vendo as cartas que marca. */}
          {selection && !needsPicker && (
            <SelectionBar
              instruction={selectionInstruction}
              selection={selection}
              picked={picked}
              chosen={selection.immediate ? (selection.alreadyChosen?.length ?? 0) : undefined}
              onConfirm={() => respond(selection.build(picked))}
              extras={plan?.global ?? []}
              onRespond={respond}
            />
          )}

          {/* Decisão escondida: ela continua pendurada, e este é o caminho de
              volta. Vale para TODO diálogo de decisão — sem ele "ver a mesa"
              seria um beco sem saída. */}
          {decision && modalEspiado && plan && (
            <PendingDecisionBar
              instruction={decision === "picker" ? selectionInstruction : plan.instruction}
              chain={snapshot.chain}
              registry={registry}
              onBack={() => setModalEspiado(false)}
            />
          )}

          {/* A pergunta de uma zona só (SELECT_PLACE): as zonas brilham na mesa
              e a faixa diz o que se escolhe — antes não havia instrução
              nenhuma, só as zonas acesas. */}
          {plan && plan.places.length > 0 && !placeSelection && !zonaAntes && !busy && (
            <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center">
              <div data-place-banner data-menu-avoid className="md-banner pointer-events-auto">
                <span className="md-banner-text">{selectionInstruction || "Escolha uma zona"}</span>
              </div>
            </div>
          )}

          {/* SELECT_PLACE/SELECT_DISFIELD com mais de 1 zona: todo candidato é
              sempre uma zona do campo (nunca "fora do tabuleiro"), então só
              precisa da barra — nunca do modal de busca. */}
          {placeSelection && (
            <SelectionBar
              instruction={selectionInstruction}
              selection={{ min: placeSelection.count, max: placeSelection.count }}
              picked={picked}
              onConfirm={() =>
                respond(
                  placeSelection.build(picked.map((index) => placeSelection.places[index])),
                )
              }
              extras={plan?.global ?? []}
              onRespond={respond}
            />
          )}

          {outrasJogadas.length > 0 && !outrasAbertas && (
            <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center">
              <button
                type="button"
                data-other-actions={outrasJogadas.length}
                onClick={() => setOutrasAbertas(true)}
                className="md-pill md-pill-primary pointer-events-auto px-4 py-2 text-[13px]"
              >
                ⚡ Outras jogadas ({outrasJogadas.length})
              </button>
            </div>
          )}
        </div>

        {/* -------- HUD (mesa larga) --------
            Os cantos do Master Duel: a engrenagem em cima à esquerda, a placa
            do oponente em cima à direita, a sua embaixo à esquerda, os botões
            redondos embaixo à direita e o botão de fase à direita, na altura
            da linha do meio da mesa. A leitura da carta flutua à esquerda. */}
        {!estreita && (
          <>
            <div className="md-hud-gear absolute z-[45]">{engrenagem}</div>

            <aside className="md-detail-rail absolute z-[44] flex flex-col gap-2">
              <ChainStack links={snapshot.chainLinks ?? []} me={me} registry={registry} />
              <CardPreview
                card={cartaEmLeitura}
                registry={registry}
                marksOf={marksOf}
                activation={ativacaoEmLeitura}
                viewer={me}
                hideEmpty
              />
            </aside>

            <div className="md-hud-foe absolute z-[45]">
              {placaDoOponente}
              <FlashLayer flashes={flashes} anchor="opponent" />
              {/* Altura reservada: o aviso entra e sai a cada jogada do
                  oponente, e sem a reserva o resto pulava junto. */}
              <div className="flex h-6 justify-end pr-2 pt-1">
                {avisoDeEspera && <WaitingBanner text={avisoDeEspera} place="rail" />}
              </div>
            </div>

            <div className="md-hud-me absolute z-[45]">
              {placaMinha}
              <FlashLayer flashes={flashes} anchor="player" up />
            </div>

            <div className="md-hud-phase absolute z-[46]" style={{ top: centroDaMesa ?? undefined }}>
              {botaoDeFase}
            </div>

            <div className="md-hud-corner absolute z-[46]">{botoesDaMesa}</div>
          </>
        )}

        {/* -------- mesa estreita: coluna da direita -------- */}
        {estreita && (
          <aside className="md-narrow-rail relative z-20 flex shrink-0 flex-col items-center justify-center gap-2 p-1.5">
            {botaoDeFase}
            {botoesDaMesa}
            <button
              type="button"
              data-table-control
              data-open-card
              onClick={() => setFolhaAberta(true)}
              className="md-round"
              title="Ler a carta em foco"
            >
              <span aria-hidden className="md-round-i">🔍</span>
            </button>
            {avisoDeEspera && <span className="sr-only">{avisoDeEspera}</span>}
          </aside>
        )}

        {/* Informações do duelo ("i") e o que limita as jogadas ("!"). */}
        {infoAberta && (
          <DuelInfo
            you={you}
            foe={foe}
            estreita={estreita}
            onClose={() => setInfoAberta(false)}
          />
        )}
        {efeitosAbertos && (
          <EffectsPanel
            mine={snapshot.playerHints[me]}
            theirs={snapshot.playerHints[foeSeat]}
            onClose={() => setEfeitosAbertos(false)}
          />
        )}

        {/* Registro do duelo, à direita — o "Duel Log" do Master Duel, a um
            botão de distância. Fica MONTADO fechado: o que se lê dele
            (testes, leitores de tela) continua lá, e abrir não perde a
            rolagem. Sem pano escuro: dá para jogar com ele aberto. */}
        {!estreita && (
          <div data-log-drawer hidden={!historicoAberto} className="md-log-drawer absolute z-[47] flex flex-col">
            <DuelLog
              entries={snapshot.log}
              reveals={minhasRevelacoes}
              onOpenReveals={() => setRevelacoesAbertas(true)}
              me={me}
              onHover={showPreview}
              registry={registry}
              onClose={() => setHistoricoAberto(false)}
            />
          </div>
        )}

        {/* Mesa estreita: o histórico e a leitura em painéis que se abrem —
            sem os trilhos, a largura inteira fica para as cartas. */}
        {estreita && historicoAberto && (
          <div
            data-log-sheet
            className="tf-modal-scrim absolute inset-0 z-50 flex justify-end"
            onClick={() => setHistoricoAberto(false)}
          >
            <div
              role="dialog"
              aria-label="Histórico"
              className="flex h-full w-[min(340px,88vw)] flex-col gap-2 p-2"
              onClick={(event) => event.stopPropagation()}
            >
              <ChainStack links={snapshot.chainLinks ?? []} me={me} registry={registry} />
              <DuelLog
                entries={snapshot.log}
                reveals={minhasRevelacoes}
                onOpenReveals={() => setRevelacoesAbertas(true)}
                me={me}
                onHover={showPreview}
                registry={registry}
                onClose={() => setHistoricoAberto(false)}
              />
            </div>
          </div>
        )}
        {estreita && folhaAberta && (
          <div
            data-card-sheet
            className="tf-modal-scrim absolute inset-0 z-50 flex items-end justify-center"
            onClick={() => setFolhaAberta(false)}
          >
            <div
              role="dialog"
              aria-label="Leitura da carta"
              className="flex h-[78%] w-full max-w-[560px] flex-col gap-2 p-2"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setFolhaAberta(false)}
                className="md-pill md-pill-ghost self-end px-3 py-1 text-[12px]"
              >
                ✕ Fechar
              </button>
              <CardPreview
                card={cartaEmLeitura}
                registry={registry}
                marksOf={marksOf}
                activation={ativacaoEmLeitura}
                viewer={me}
              />
            </div>
          </div>
        )}

        {/* Os diálogos nascem AQUI, por cima do campo e entre as margens da
            tela (`.tf-modal-area`): a leitura da carta, à esquerda, continua
            nítida e clicável — é com um diálogo aberto (conferindo o
            cemitério, escolhendo alvo) que mais se precisa ler a carta. O fim
            de duelo é a exceção e cobre a tela toda. */}
        {deckAberto && (
          <PainelDoDeck
            restantes={you.deckSize}
            onSurrender={() => {
              setDeckAberto(false);
              onSurrender?.();
            }}
            onClose={() => setDeckAberto(false)}
          />
        )}

        {revelacoesAbertas && (
          <RevealHistoryModal
            reveals={minhasRevelacoes}
            registry={registry}
            onHover={showPreview}
            onClose={() => setRevelacoesAbertas(false)}
          />
        )}

        {openPile && (
          <PileModal
            title={openPile.title}
            cards={pileShown}
            actions={plan?.presentation === "inline" && !busy ? plan.byCard : undefined}
            onChoose={(action) => {
              setOpenPile(null);
              respond(action.response);
            }}
            registry={registry}
            onHover={showPreview}
            onClose={() => setOpenPile(null)}
          />
        )}

        {/* Diálogos de decisão: todos escondíveis (`hidden` os mantém
            montados — o que já foi marcado sobrevive à espiada). */}
        {decision === "picker" && selection && plan && (
          <CardPickerModal
            instruction={selectionInstruction}
            selection={selection}
            picked={picked}
            registry={registry}
            me={me}
            onToggle={togglePick}
            onConfirm={() => respond(selection.build(picked))}
            extras={plan.global}
            onRespond={respond}
            onHover={showPreview}
            hidden={modalEspiado}
            onPeek={peek}
          />
        )}

        {decision === "sort" && plan?.sorting && (
          <SortCardModal
            instruction={plan.instruction}
            sorting={plan.sorting}
            registry={registry}
            onRespond={(order) => respond(plan.sorting!.build(order))}
            keepLabel={plan.global[0]?.label ?? "Manter a ordem atual"}
            onKeep={() =>
              respond(plan.global[0]?.response ?? plan.sorting!.build(null))
            }
            onHover={showPreview}
            hidden={modalEspiado}
            onPeek={peek}
          />
        )}

        {decision === "announce" && plan?.announceCard && (
          <AnnounceCardModal
            instruction={plan.instruction}
            opcodes={plan.announceCard.opcodes}
            cards={announcePool}
            officialDb={officialDb}
            onRespond={(code) => respond(plan.announceCard!.build(code))}
            onHover={showPreview}
            hidden={modalEspiado}
            onPeek={peek}
          />
        )}

        {outrasAbertas && (
          <div
            className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6"
            onClick={() => setOutrasAbertas(false)}
          >
            <div
              className="tf-modal tf-anim-modal-in flex max-h-full w-[min(520px,94%)] flex-col overflow-hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="tf-modal-head shrink-0 px-5 py-2.5 text-center text-[15px] font-semibold text-[color:var(--tf-gold-bright)]">
                Jogadas com cartas fora da mesa
              </p>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3.5">
                {outrasJogadas.map((action, index) => (
                  <CardChoiceButton
                    key={index}
                    action={action}
                    registry={registry}
                    onClick={() => {
                      setOutrasAbertas(false);
                      respond(action.response);
                    }}
                    onHover={showPreview}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {decision === "counters" && plan?.counters && (
          <CounterSelectModal
            instruction={plan.instruction}
            selection={plan.counters}
            registry={registry}
            onRespond={respond}
            onHover={showPreview}
            hidden={modalEspiado}
            onPeek={peek}
          />
        )}

        {decision === "prompt" && plan && (
          <PromptModal
            plan={plan}
            onRespond={respond}
            registry={registry}
            promptCard={snapshot.promptCard}
            chain={snapshot.chain}
            picked={picked}
            onTogglePick={togglePick}
            onPeek={peek}
            onHover={showPreview}
            hidden={modalEspiado}
          />
        )}
      </div>

      {snapshot.winner != null &&
        (resultadoEspiado ? (
          <ResultPeekBar
            winner={snapshot.winner}
            me={me}
            onBack={() => setResultadoEspiado(false)}
          />
        ) : (
          <ResultOverlay
            winner={snapshot.winner}
            reason={snapshot.winReason}
            me={me}
            playerName={playerName}
            opponentName={opponentName}
            ending={ending}
            turns={snapshot.turnCount}
            lifePoints={snapshot.lifePoints}
            onPeek={() => setResultadoEspiado(true)}
            spectating={spectating}
          />
        ))}

      {snapshot.error && (
        <p className="relative z-20 shrink-0 border-t border-red-900/50 bg-red-950/80 px-4 py-2 text-sm text-red-200">
          {snapshot.error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

type SlotPropsFn = (
  card: BoardCard | null,
  zone: SelectFieldPlace,
) => {
  highlighted: boolean;
  intent: SlotIntent;
  selected: boolean;
  onClick?: () => void;
  menu: CardAction[] | null;
  onChoose: (action: CardAction) => void;
  onCloseMenu: () => void;
};

interface SharedSlotProps {
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
  /** Toque longo numa carta (mesa estreita) — ver `DuelCardSlot.onLongPress`. */
  onLongPress?: (card: BoardCard) => void;
  slotProps: SlotPropsFn;
  /** Mesa de Master Rule 2020 (ver `isTcg` no `DuelBoard`). */
  isTcg: boolean;
  /** Zona → nomes dos Links que apontam para ela. */
  linkedBy: Map<string, string[]>;
  openMaterials: (card: BoardCard) => () => void;
  /** Marcas de uma carta, já resolvidas para quem olha. */
  marksOf: (card: BoardCard | null | undefined) => CardMark[];
  isDisabledZone: (owner: 0 | 1, location: number, sequence: number) => boolean;
  /** Número do elo da corrente da carta nesta zona, se ela estiver numa. */
  chainBadgeOf: (key: string) => ChainBadge | undefined;
}

/** Selo de "N viradas para cima" do Extra Deck, quando houver alguma. */
function faceUpBadge(count: number): { text: string; title: string } | null {
  return count > 0
    ? { text: `↑${count}`, title: `${count} carta(s) virada(s) para cima (públicas)` }
    : null;
}

function FieldRow({
  cards,
  owner,
  zone,
  mirrored = false,
  left,
  right,
  registry,
  onHover,
  onLongPress,
  slotProps,
  isTcg,
  linkedBy,
  openMaterials,
  marksOf,
  isDisabledZone,
  chainBadgeOf,
}: SharedSlotProps & {
  cards: (BoardCard | null)[];
  owner: 0 | 1;
  zone: "monster" | "spell";
  mirrored?: boolean;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  // O lado do oponente é espelhado só na apresentação — as sequences reais
  // seguem intactas para casar com o que o engine espera.
  const ordered = cards.map((card, sequence) => ({ card, sequence }));
  if (mirrored) ordered.reverse();

  const location = zone === "monster" ? OcgLocation.MZONE : OcgLocation.SZONE;

  return (
    <div
      data-row={`${mirrored ? "foe" : "me"}-${zone}`}
      className={`md-row md-row-${zone} md-row-${mirrored ? "foe" : "me"} flex min-h-0 flex-1 items-center justify-center`}
    >
      {left}
      {ordered.map(({ card, sequence }) => {
        const key = cardKey(owner, location, sequence);
        // Pêndulo nas pontas da fileira de magias (zonas 1 e 5) vale como
        // escala — a da esquerda usa a escala esquerda da carta.
        const pendulumZone = isTcg && zone === "spell" && (sequence === 0 || sequence === 4);
        const isPendulum =
          card?.code != null &&
          (registry?.get(card.code)?.frameType.includes("pendulum") ?? false);
        return (
          <DuelCardSlot
            key={sequence}
            card={card}
            registry={registry}
            // Zona vazia sem texto: "Mon3" e "M/A5 · P" eram nomes de
            // engenharia, não de jogo. Só a Zona de Pêndulo ganha um "P" —
            // é o que muda o que se pode pôr ali.
            placeholder={pendulumZone ? "P" : ""}
            zoneKind={zone === "monster" ? "monster" : "spell"}
            rotated={zone === "monster" && Boolean(card?.defense)}
            // Do lado de lá as cartas ficam DE PÉ, como no Master Duel (que
            // não as vira de cabeça para baixo): só as setas Link giram, porque
            // elas apontam para casas da mesa.
            foeSide={mirrored}
            ownedFaceDown={!mirrored}
            zoneKey={key}
            onHover={onHover}
            onLongPress={onLongPress}
            scaleSide={
              pendulumZone && isPendulum && !card?.faceDown
                ? sequence === 0
                  ? "left"
                  : "right"
                : null
            }
            linkedBy={zone === "monster" ? linkedBy.get(key) : undefined}
            onOpenMaterials={card?.overlays.length ? openMaterials(card) : undefined}
            marks={slotChips(marksOf(card))}
            disabledZone={isDisabledZone(owner, location, sequence)}
            chainBadge={chainBadgeOf(key)}
            {...slotProps(card, { player: owner, location, sequence })}
          />
        );
      })}
      {right}
    </div>
  );
}

/**
 * A coluna do Cemitério e das banidas — os dois "poços" redondos do Master
 * Duel, um sobre o outro, ao lado da fileira de monstros.
 *
 * Ocupam o lugar de UMA carta: a coluna tem a largura e a altura de uma zona,
 * e cada poço fica com metade da altura. Antes as banidas ficavam penduradas
 * para fora da fileira, e a conta da largura da mesa tinha de reservar esse
 * pedaço dos dois lados.
 *
 * `order` diz quem fica em cima: do seu lado, as banidas em cima (como no MD);
 * do lado do oponente, espelhado — o Cemitério em cima, perto do Deck dele.
 */
function GraveColumn({
  grave,
  banished,
  order,
}: {
  grave: React.ReactNode;
  banished: React.ReactNode;
  order: "banished-first" | "grave-first";
}) {
  return (
    <div className={`md-wells relative ${CARD_SHAPE}`}>
      {order === "banished-first" ? (
        <>
          <div className="md-well-slot md-well-slot-small">{banished}</div>
          <div className="md-well-slot">{grave}</div>
        </>
      ) : (
        <>
          <div className="md-well-slot">{grave}</div>
          <div className="md-well-slot md-well-slot-small">{banished}</div>
        </>
      )}
    </div>
  );
}

/**
 * A arte da Magia de Campo ativa tingindo a metade da mesa de quem a controla
 * — o ambiente do MD mudando com o campo. Some quando a carta sai (ou está
 * baixada). A troca entre duas artes faz um esmaecer.
 */
function FieldSpellArt({
  card,
  registry,
  side,
}: {
  card: BoardCard | null;
  registry: CardRegistry | null;
  side: "me" | "foe";
}) {
  if (!card || card.code === null || card.faceDown) return null;
  const definition = registry?.get(card.code);
  const arte = definition?.images[0]?.image_url_cropped ?? `/card-images/cropped/${card.code}.jpg`;
  return (
    <div
      key={card.code}
      aria-hidden
      data-field-art={side}
      className={`md-field-art md-field-art-${side}`}
      style={{ backgroundImage: `url("${arte}")` }}
    />
  );
}

/** Zona de campo — canto externo da fileira de magias, como na mesa oficial. */
function FieldSpellSlot({
  player,
  owner,
  ownedFaceDown,
  registry,
  onHover,
  onLongPress,
  slotProps,
  marksOf,
  chainBadgeOf,
}: Pick<
  SharedSlotProps,
  "registry" | "onHover" | "onLongPress" | "slotProps" | "marksOf" | "chainBadgeOf"
> & {
  player: BoardPlayer;
  owner: 0 | 1;
  ownedFaceDown: boolean;
}) {
  return (
    <DuelCardSlot
      card={player.field}
      registry={registry}
      placeholder=""
      zoneKind="field"
      ownedFaceDown={ownedFaceDown}
      zoneKey={cardKey(owner, OcgLocation.SZONE, FIELD_ZONE_SEQUENCE)}
      onHover={onHover}
      onLongPress={onLongPress}
      marks={slotChips(marksOf(player.field))}
      // Uma Magia de Campo ativada também é um elo — o número dela aparece aqui.
      chainBadge={chainBadgeOf(cardKey(owner, OcgLocation.SZONE, FIELD_ZONE_SEQUENCE))}
      {...slotProps(player.field, {
        player: owner,
        location: OcgLocation.SZONE,
        sequence: FIELD_ZONE_SEQUENCE,
      })}
    />
  );
}

/**
 * O passo entre as cartas de uma mão: o vão normal enquanto cabe; quando não
 * cabe, a sobreposição exata para a fileira caber na largura — em `cqw`/`cqh`
 * da própria mão (ela é contêiner de tamanho, ver `.md-hand`). A carta tem a
 * altura da mão, então a largura dela é 59/86 = 68,6% dessa altura. O piso
 * (-52cqh) deixa sempre uma tira de cada carta à mostra para clicar.
 */
function passoDaMao(n: number, vao: string, altura = 1): string {
  if (n <= 1) return vao;
  // A carta tem `altura` vezes a altura da mão (a do MD passa da borda da
  // tela): a largura dela é 59/86 disso.
  const largura = 68.6 * altura;
  return `max(${-(largura * 0.76).toFixed(1)}cqh, min(${vao}, calc((100cqw - 24px - ${n} * ${largura.toFixed(1)}cqh) / ${n - 1})))`;
}

function Hand({
  cards,
  seat,
  registry,
  onHover,
  onLongPress,
  slotProps,
}: Pick<SharedSlotProps, "registry" | "onHover" | "onLongPress" | "slotProps"> & {
  cards: BoardCard[];
  seat: 0 | 1;
}) {
  // A mão do Master Duel: cartas grandes, soltas sobre a borda de baixo da
  // mesa, sem caixa em volta — e encavaladas quando passam de seis, em vez de
  // encolher (encolher de novo era a mão de 100 px que não deixava ler a arte).
  // O passo é medido em `cqh` (altura da própria mão): a carta tem a altura
  // dela, então a sobreposição acompanha o tamanho em qualquer tela.
  // A carta é 32% mais alta que a faixa da mão: o pé dela passa da borda de
  // baixo da tela, como no Master Duel, e sobe inteira ao passar o mouse.
  const passo = passoDaMao(cards.length, "1.5cqh", 1.32);
  return (
    <div
      // Índice ABSOLUTO — ver o comentário no `dataPile` da fileira acima.
      data-hand={seat}
      // Tela baixa (celular deitado): a mão encolhe para sobrar fileira de
      // campo — com 104 px fixos as cartas da mesa ficavam com 24 px.
      className="md-hand md-hand-mine z-10 flex h-[15%] min-h-[92px] shrink-0 items-start justify-center px-3 [@media(max-height:500px)]:min-h-[56px]"
      style={{
        ["--md-hand-step" as string]: passo,
        // Sem o teto de largura do campo: na mão as cartas encavalam em vez
        // de encolher, então só a altura da mão manda.
        ["--tf-card-max-h" as string]: "none",
      }}
    >
      {cards.length === 0 ? (
        <span className="self-center text-[13px] text-zinc-500">Mão vazia</span>
      ) : (
        cards.map((card) => (
          <DuelCardSlot
            key={card.sequence}
            card={card}
            registry={registry}
            inHand
            // `seat`, nunca 0: a chave da zona é ABSOLUTA e é por ela que a
            // ação do engine casa com a carta na tela. Fixado em 0, a mão do
            // assento 1 nunca ficava clicável — o jogador de baixo não
            // conseguia invocar nem baixar nada, e o duelo parava ali.
            zoneKey={cardKey(seat, OcgLocation.HAND, card.sequence)}
            onHover={onHover}
            onLongPress={onLongPress}
            {...slotProps(card, {
              player: seat,
              location: OcgLocation.HAND,
              sequence: card.sequence,
            })}
          />
        ))
      )}
    </div>
  );
}

/**
 * Seletor para cartas que não estão no tabuleiro.
 *
 * Efeitos de busca ("adicione 1 Magia de Ritual do seu Deck à mão") apontam
 * para o Deck, onde não existe nada clicável: sem esta lista o duelo trava com
 * um "Selecione 1 carta(s)" impossível de atender. Só as cartas que o engine
 * ofereceu aparecem aqui — o resto do deck continua oculto.
 */
function CardPickerModal({
  instruction,
  selection,
  picked,
  registry,
  me,
  onToggle,
  onConfirm,
  extras,
  onRespond,
  onHover,
  hidden,
  onPeek,
}: {
  instruction: string;
  selection: NonNullable<PromptPlan["selection"]>;
  picked: number[];
  registry: CardRegistry | null;
  /** Quem olha — separa "suas" cartas das do oponente na lista. */
  me: 0 | 1;
  onToggle: (index: number) => void;
  onConfirm: () => void;
  extras: GlobalAction[];
  onRespond: (response: OcgResponse) => void;
  /** Passar o mouse num candidato manda a carta para a leitura da esquerda. */
  onHover: (card: PreviewCard | null) => void;
  /** Escondido para ver a mesa (continua montado). */
  hidden: boolean;
  onPeek: () => void;
}) {
  const texto = useCardText();
  const [grade, setGrade] = useState(false);
  const canConfirm =
    picked.length >= selection.min &&
    picked.length <= selection.max &&
    (selection.isValid?.(picked) ?? true);
  /** Escolha de exatamente uma carta: clicar de novo na marcada confirma. */
  const umaSo =
    selection.min === 1 &&
    selection.max === 1 &&
    !selection.alreadyChosen?.length &&
    !selection.immediate;
  /** SELECT_UNSELECT_CARD: cada clique já responde; só "Concluir" encerra. */
  const imediata = selection.immediate === true;
  const marcadas = selection.alreadyChosen?.length ?? 0;

  const progress = imediata
    ? `${marcadas} marcada${marcadas === 1 ? "" : "s"}`
    : selection.progress
      ? `soma ${selection.progress(picked)}`
      : `${picked.length}/${
          selection.min === selection.max
            ? selection.min
            : `${selection.min}-${selection.max}`
        }`;

  /**
   * A ordem de exibição: as cartas do OPONENTE primeiro.
   *
   * A lição do Tag Force 1, cujo cursor começava nas próprias cartas — num
   * "destrua 1 carta no campo" o jogador destruía a própria sem querer. Os
   * índices continuam os do engine (é por eles que a resposta é montada); só
   * a ordem na tela muda.
   */
  const ordem = selection.candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        Number(a.candidate.controller === me) - Number(b.candidate.controller === me),
    );
  const misturado =
    selection.candidates.some((candidate) => candidate.controller === me) &&
    selection.candidates.some((candidate) => candidate.controller !== me);
  const temVerso = selection.candidates.some((candidate) => candidate.code === 0);

  return (
    <DecisionSheet
      label={instruction}
      hidden={hidden}
      onPeek={onPeek}
      tabs={<GridTab grid={grade} onToggle={() => setGrade((g) => !g)} />}
      head={
        <>
          <p className="md-sheet-title">{instruction}</p>
          <p className="md-sheet-sub">
            <span className="md-sheet-count">{progress}</span>
            {temVerso
              ? "Cartas de verso são as que você ainda não pode ver — escolha e a face aparece."
              : `${selection.candidates.length} carta${selection.candidates.length === 1 ? "" : "s"}`}
            {umaSo ? " · clique de novo na marcada para confirmar" : ""}
          </p>
        </>
      }
      foot={
        <>
          {extras.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onRespond(action.response)}
              className="md-pill md-pill-ghost px-5 py-2 text-[13px]"
            >
              {action.label}
            </button>
          ))}
          {!imediata && (
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                playSfx("click");
                onConfirm();
              }}
              className="md-pill md-pill-ok min-w-[180px] px-6 py-2 text-[13px]"
            >
              Confirmar
            </button>
          )}
        </>
      }
    >
      {/* Obrigatórias (SELECT_SUM: `selects_must`) — já contam para o alvo
          sem o jogador marcar, então aparecem à parte e não são clicáveis. */}
      {selection.locked && selection.locked.length > 0 && (
        <div className="mb-2 flex items-center gap-2 px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--md-text-dim)]">
            Já incluídas
          </span>
          <div className="flex gap-1.5">
            {selection.locked.map((candidate, index) => {
              const definition = registry?.get(candidate.code);
              return (
                <CardTile
                  key={`locked-${candidate.code}-${index}`}
                  image={definition?.images[0]?.image_url_small}
                  alt={definition ? texto.name(definition) : "Carta"}
                  picked
                  onHover={() => onHover({ code: candidate.code })}
                  title={definition ? texto.name(definition) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      <CardStrip grid={grade}>
        {ordem.map(({ candidate, index }) => {
          // `code: 0` é o candidato que este assento não tem direito de ver
          // (`maskHiddenCards`) — carta na mão do adversário, virada para
          // baixo no campo dele. Escolhe-se pelo verso, e a face aparece
          // depois, quando o efeito revelar.
          const oculta = candidate.code === 0;
          const definition = oculta ? undefined : registry?.get(candidate.code);
          const jaEscolhida = selection.alreadyChosen?.includes(index) ?? false;
          // Clicar numa já escolhida desfaz: a marca inverte.
          const isPicked = imediata ? jaEscolhida : picked.includes(index) !== jaEscolhida;
          const doOponente = candidate.controller !== me;
          return (
            <CardTile
              key={`${candidate.code}-${index}`}
              data={{ "data-picker-card": index, "data-picker-owner": doOponente ? "foe" : "me" }}
              image={definition?.images[0]?.image_url_small}
              alt={definition ? texto.name(definition) : oculta ? "Carta oculta" : "Carta"}
              faceDown={oculta}
              place={`${locationLabel(candidate.location)}${misturado ? (doOponente ? " · oponente" : " · sua") : ""}`}
              owner={misturado ? (doOponente ? "foe" : "me") : null}
              picked={isPicked}
              title={definition ? texto.name(definition) : oculta ? "Carta oculta" : undefined}
              onHover={() => onHover(oculta ? null : { code: candidate.code })}
              onClick={() => {
                playSfx("click");
                if (imediata) {
                  onRespond(selection.build([index]));
                  return;
                }
                if (umaSo && canConfirm && picked.length === 1 && picked[0] === index) {
                  onConfirm();
                  return;
                }
                onToggle(index);
              }}
            />
          );
        })}
      </CardStrip>
    </DecisionSheet>
  );
}

/**
 * Mão do oponente — versos, com a quantidade sempre visível (é informação
 * pública e essencial para decidir jogadas).
 *
 * Quando o core marca uma carta da mão dele como PÚBLICA, ela vem do
 * `readBoardState` com `code` preenchido e aparece de cara para cima aqui — é
 * o que o Olho Mágico da Verdade faz. Nesse caso a fileira cresce: uma carta
 * de 48px de altura é boa para contar versos e ruim para reconhecer arte, e a
 * mão revelada é justamente o que se quer LER. O hover manda a carta para o
 * painel de leitura da esquerda, como qualquer outra da mesa.
 */
function OpponentHand({
  cards,
  seat,
  registry,
  onHover,
  onLongPress,
}: {
  cards: BoardCard[];
  seat: 0 | 1;
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
  onLongPress?: (card: BoardCard) => void;
}) {
  const revelada = cards.some((card) => card.code !== null);
  // Como a mão do Master Duel: versos encavalados no alto da tela, com a
  // borda de cima cortada pela tela (a carta tem 1,25× a faixa; o pé dela
  // encosta no pé da faixa). Do tamanho de carta de verdade — pedido do
  // Gustavo: miúda, ela sumia perto do resto. Passa de seis e as cartas se
  // sobrepõem mais, em vez de empurrar a contagem para fora.
  const passo = passoDaMao(cards.length, "3cqh", 1.25);

  return (
    <div
      data-hand={seat}
      // A altura mora no CSS (`.md-hand-foe`): do tamanho de uma carta de
      // verdade, e não de um ícone — 48 px ficavam miúdos perto da mão de
      // baixo e do campo. A revelada (Olho Mágico da Verdade) desce mais,
      // para a arte se ler.
      className={`md-hand md-hand-foe z-10 flex shrink-0 items-start justify-center gap-0 px-3 ${
        revelada ? "md-hand-foe-revealed" : ""
      }`}
      style={{ ["--md-hand-step" as string]: passo, ["--tf-card-max-h" as string]: "none" }}
    >
      {cards.length === 0 ? (
        <span className="self-center text-[11px] text-zinc-500">Mão do oponente vazia</span>
      ) : (
        cards.map((card) => (
          <DuelCardSlot
            key={card.sequence}
            card={card}
            registry={registry}
            inHand
            onHover={onHover}
            onLongPress={onLongPress}
          />
        ))
      )}
      {/* A contagem, sempre — é informação pública e decide jogada. */}
      {cards.length > 0 && (
        <span
          data-hand-count
          title={revelada ? "Mão do oponente — revelada" : "Cartas na mão do oponente"}
          className="md-hand-count ml-3 self-center"
        >
          {revelada ? "👁 " : "✋ "}
          {cards.length}
        </span>
      )}
    </div>
  );
}

/**
 * Mostra cartas que um efeito revelou.
 *
 * Efeitos com "revelando-as" (compra revelada, olhar o topo do deck) mudam o
 * estado sem deixar rastro na tela — sem isso o jogador vê a consequência
 * (cartas indo pro cemitério) mas nunca as cartas em si.
 */
function RevealOverlay({
  reveal,
  registry,
}: {
  reveal: { codes: number[]; title: string };
  registry: CardRegistry | null;
}) {
  const texto = useCardText();
  return (
    // As cartas mostradas grandes no meio da mesa, com o brilho do MD — o
    // que um efeito "revelando" põe à vista.
    <div data-reveal className="md-reveal pointer-events-none absolute inset-x-0 top-[12%] z-40 flex flex-col items-center gap-3">
      <span className="md-reveal-title">{reveal.title}</span>
      <div className="flex items-start justify-center gap-4">
        {reveal.codes.map((code, index) => {
          const definition = registry?.get(code);
          const image = definition?.images[0]?.image_url ?? definition?.images[0]?.image_url_small;
          return (
            <div
              key={`${code}-${index}`}
              className="md-reveal-card flex flex-col items-center gap-1.5"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={definition ? texto.name(definition) : "Carta"} className="md-reveal-img" />
              ) : (
                <div className="tf-card-back md-reveal-img" />
              )}
              <span className="md-reveal-name">{definition ? texto.name(definition) : code}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Moeda ou dado rolando no centro da tela, com o resultado. */
function TossOverlay({
  toss,
}: {
  toss: { kind: "coin" | "dice"; results: (boolean | number)[]; duration: number };
}) {
  // O giro acompanha a velocidade escolhida (a sessão espera o mesmo).
  const giro = Math.round((toss.duration * 1200) / 1900);
  return (
    <div data-toss={toss.kind} className="md-toss pointer-events-none absolute inset-0 z-40 flex items-center justify-center gap-8">
      {toss.results.map((result, index) => (
        <div key={index} className="flex flex-col items-center gap-3">
          <div
            style={{ animationDelay: `${index * 120}ms`, animationDuration: `${giro}ms` }}
            // Classes estáticas: o Tailwind não enxerga nomes montados em runtime.
            className={toss.kind === "coin" ? "tf-coin md-coin" : "tf-dice md-die"}
          >
            {toss.kind === "coin" ? (
              <span aria-hidden className="md-coin-face">
                {result ? "★" : "✦"}
              </span>
            ) : (
              <span className="md-die-face">{String(result)}</span>
            )}
          </div>
          <span className="md-toss-result" style={{ animationDelay: `${giro + index * 120}ms` }}>
            {toss.kind === "coin" ? (result ? "CARA" : "COROA") : String(result)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Os números que saltam na mesa: o dano grande e vermelho (e a cura verde) do
 * Master Duel, junto da placa de LP de quem foi atingido; e os avisos do
 * centro, quando houver.
 */
function FlashLayer({
  flashes,
  anchor,
  up = false,
}: {
  flashes: DuelFlash[];
  anchor: DuelFlash["anchor"];
  /** Junto de uma placa no canto de baixo: o número sobe em vez de descer. */
  up?: boolean;
}) {
  const visible = flashes.filter((flash) => flash.anchor === anchor);
  if (visible.length === 0) return null;
  const centered = anchor === "center";

  return (
    <div
      className={`pointer-events-none absolute z-40 flex ${
        centered
          ? "inset-0 items-center justify-center"
          : up
            ? "bottom-full left-0 right-0 items-end justify-center pb-2"
            : "left-0 right-0 top-full items-start justify-center pt-1"
      }`}
    >
      <div className="flex flex-col items-center gap-1">
        {visible.map((flash) => {
          const cura = flash.text.startsWith("+");
          return (
            <span
              key={flash.id}
              data-flash={cura ? "recover" : centered ? "center" : "damage"}
              style={{ ["--tf-flash-duration" as string]: `${flash.duration}ms` }}
              className={`tf-flash-text select-none whitespace-nowrap ${
                centered ? "md-flash-center" : cura ? "md-flash-number md-flash-recover" : "md-flash-number md-flash-damage"
              }`}
            >
              {flash.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lista o conteúdo de uma pilha (cemitério, banidas, extra, materiais) em
 * grade.
 *
 * Com `actions`, a pilha vira lugar de jogada: as cartas que o engine deixa
 * usar agora (Invocar do Extra Deck, ativar efeito de Cemitério, de banida)
 * brilham, e clicar numa delas mostra as jogadas dela. No Goat isso quase não
 * aparecia; no TCG é rotina — sem isto não havia como invocar um Sincro.
 */
function PileModal({
  title,
  cards,
  registry,
  onHover,
  onClose,
  actions,
  onChoose,
}: {
  title: string;
  cards: BoardCard[];
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
  onClose: () => void;
  /** Jogadas por carta (`cardKey`), quando o prompt atual oferece alguma aqui. */
  actions?: Map<string, CardAction[]>;
  onChoose?: (action: CardAction) => void;
}) {
  const texto = useCardText();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [grade, setGrade] = useState(false);
  const jogadas = escolhida ? (actions?.get(escolhida) ?? []) : [];
  const temJogada = (card: BoardCard) =>
    Boolean(actions?.get(cardKey(card.controller, card.location, card.sequence))?.length);
  const quantasComJogada = cards.filter(temJogada).length;

  return (
    // A lista de cartas do MD, aberta sobre a parte de baixo do campo. Fecha
    // no X, no clique fora e no Esc.
    <div className="md-sheet-area md-sheet-scrim tf-modal-area z-50 flex items-end justify-center" onClick={onClose}>
      <div
        data-pile-modal
        role="dialog"
        aria-label={title}
        className="tf-panel md-sheet md-sheet-neutral pointer-events-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="md-sheet-tabs">
          <GridTab grid={grade} onToggle={() => setGrade((g) => !g)} />
          <button type="button" onClick={onClose} aria-label="Fechar" className="md-sheet-tab">
            ✕
          </button>
        </div>
        <header className="md-sheet-head">
          <h3 className="md-sheet-title">
            {title} <span className="md-sheet-count">({cards.length})</span>
          </h3>
          {quantasComJogada > 0 && (
            <p className="md-sheet-sub">
              {quantasComJogada} com jogada agora — clique numa que brilha
            </p>
          )}
        </header>

        <div className="md-sheet-body">
          {cards.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-zinc-500">Vazio.</p>
          ) : (
            <CardStrip grid={grade}>
              {cards.map((card, index) => {
                const definition = card.code ? registry?.get(card.code) : undefined;
                const key = cardKey(card.controller, card.location, card.sequence);
                const acionavel = temJogada(card);
                return (
                  <CardTile
                    key={`${card.sequence}-${index}`}
                    data={{ "data-pile-card": key, "data-actionable": acionavel || undefined, role: acionavel ? "button" : undefined }}
                    image={definition?.images[0]?.image_url_small}
                    alt={definition ? texto.name(definition) : "Carta"}
                    faceDown={!definition}
                    title={definition ? texto.name(definition) : undefined}
                    picked={escolhida === key}
                    actionable={acionavel && escolhida !== key}
                    dimmed={quantasComJogada > 0 && !acionavel}
                    place={card.location === OcgLocation.EXTRA && !card.faceDown ? "↑ face para cima" : undefined}
                    onHover={() => onHover(card)}
                    onClick={acionavel ? () => setEscolhida(key) : undefined}
                  />
                );
              })}
            </CardStrip>
          )}
        </div>

        {jogadas.length > 0 && (
          <footer className="md-sheet-foot">
            {jogadas.map((action, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  playSfx("click");
                  onChoose?.(action);
                }}
                className={`md-pill px-5 py-2 text-left text-[13px] ${
                  commandKind(action.label) === "activate" ? "md-pill-effect" : "md-pill-primary"
                }`}
              >
                {action.label}
                {action.detail && (
                  <span className="block max-w-[260px] text-[11px] font-semibold opacity-80">
                    {action.detail}
                  </span>
                )}
              </button>
            ))}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Tudo o que já foi revelado a este assento, da revelação mais recente para a
 * mais antiga.
 *
 * O aviso que aparece no meio da mesa dura três segundos — e é nele que vem a
 * informação que decide o resto do duelo: a carta que o Boneca Chamariz virou e
 * devolveu, a que o Espião viu na mão do adversário, a que o adversário olhou
 * da sua. Quem piscou perdia o dado para sempre; aqui ele continua consultável.
 */
function RevealHistoryModal({
  reveals,
  registry,
  onHover,
  onClose,
}: {
  reveals: DuelReveal[];
  registry: CardRegistry | null;
  onHover: (card: PreviewCard | null) => void;
  onClose: () => void;
}) {
  const texto = useCardText();
  return (
    <div
      className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="tf-panel flex max-h-full w-[min(560px,92%)] flex-col overflow-hidden rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="tf-modal-head flex shrink-0 items-center justify-between px-4 py-2">
          <h3 className="text-base font-bold text-[color:var(--tf-gold-bright)]">
            👁 Reveladas{" "}
            <span className="text-[color:var(--tf-gold-dim)]">
              ({reveals.length})
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-black/50 hover:text-zinc-100"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {reveals.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-zinc-500">
              Nenhuma carta foi revelada ainda.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {[...reveals].reverse().map((reveal) => (
                <li
                  key={reveal.id}
                  className="border-b border-white/5 pb-2 last:border-0"
                >
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-[color:var(--tf-gold-dim)]">
                    {reveal.title}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {reveal.codes.map((code, index) => {
                      const definition = registry?.get(code);
                      const image = definition?.images[0]?.image_url_small;
                      return (
                        <div
                          key={`${reveal.id}-${code}-${index}`}
                          onMouseEnter={() => onHover({ code })}
                          title={definition ? texto.name(definition) : undefined}
                          className="w-[64px] shrink-0 overflow-hidden rounded-[3px] border border-[color:var(--tf-slot-border)]"
                        >
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={image}
                              alt={(definition ? texto.name(definition) : "Carta")}
                              loading="lazy"
                              className="aspect-[59/86] w-full object-cover"
                            />
                          ) : (
                            <div className="tf-card-back aspect-[59/86] w-full" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Modal central para decisões puras (sim/não, escolher efeito, encadear). */
function PromptModal({
  plan,
  onRespond,
  registry,
  promptCard,
  chain,
  picked,
  onTogglePick,
  onPeek,
  onHover,
  hidden,
}: {
  plan: PromptPlan;
  onRespond: (response: OcgResponse) => void;
  registry: CardRegistry | null;
  /** Carta de que o prompt trata, quando o core informou via HINT. */
  promptCard: number | null;
  /** Efeito que está na corrente agora — o "a que estou respondendo". */
  chain: DuelChainLink | null;
  /** Índices marcados em `plan.announce.options` (ANNOUNCE_RACE/ATTRIB). */
  picked: number[];
  onTogglePick: (index: number) => void;
  /** Esconder o modal para olhar a mesa, sem responder. */
  onPeek: () => void;
  /**
   * Manda a carta sob o mouse para o painel de leitura da esquerda.
   *
   * O modal nasce dentro da coluna do campo justamente para os trilhos
   * laterais continuarem à vista — sem isto o texto do efeito ficava preso ao
   * `line-clamp` de três linhas do botão, que é onde ele mais importa.
   */
  onHover: (card: PreviewCard | null) => void;
  /** Escondido para ver a mesa (continua montado). */
  hidden: boolean;
}) {
  const { announce } = plan;

  // Cada opção é mostrada com a carta de verdade — arte, nome, de onde sai e o
  // texto do efeito. Sem isso o jogador clicava "Ativar" sem saber o quê.
  const cardChoices: CardAction[] = [];
  plan.byCard.forEach((actions) => cardChoices.push(...actions));

  // O plano sabe a carta em alguns prompts (SELECT_EFFECTYN); nos outros o
  // único indício é o HINT que o core mandou antes. Quando é a mesma carta que
  // já está anunciada na corrente, o bloco do assunto sai: dois cartões
  // idênticos empilhados só empurram as opções para fora da tela.
  const subjectCode = plan.subject?.code ?? promptCard;
  const subject = subjectCode === chain?.code ? null : subjectCode;
  const temCorpo = Boolean(announce) || Boolean(chain) || subject !== null || cardChoices.length > 0;

  return (
    <DecisionSheet
      label={plan.instruction}
      hidden={hidden}
      onPeek={onPeek}
      className="md-sheet-prompt"
      head={<p className="md-sheet-title">{plan.instruction}</p>}
      foot={
        announce ? (
          <>
            <span className="md-sheet-count">
              {picked.length}/{announce.count} marcado(s)
            </span>
            <button
              type="button"
              disabled={picked.length !== announce.count}
              onClick={() => {
                playSfx("click");
                onRespond(announce.build(picked.map((index) => announce.options[index].value)));
              }}
              className="md-pill md-pill-ok min-w-[180px] px-6 py-2 text-[13px]"
            >
              Confirmar
            </button>
          </>
        ) : (
          plan.global.map((action, index) => (
            <ModalButton
              key={`global-${index}`}
              tone={cardChoices.length === 0 ? action.tone : "default"}
              label={action.label}
              onClick={() => onRespond(action.response)}
            />
          ))
        )
      }
    >
      {temCorpo ? (
        <div className="max-h-[38vh] space-y-1.5 overflow-y-auto px-3 pb-1">
          {announce ? (
            // ANNOUNCE_RACE / ANNOUNCE_ATTRIB: não são cartas, são valores
            // abstratos — cada botão alterna a marcação, e o core só recebe a
            // resposta quando `count` valores estiverem marcados.
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
              {announce.options.map((option, index) => {
                const isPicked = picked.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      playSfx("click");
                      onTogglePick(index);
                    }}
                    className={`md-option ${isPicked ? "md-option-on" : ""}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {/* A que se está respondendo. O core pergunta "deseja responder
                  com algum efeito?" sem nunca repetir o que foi ativado, e a
                  linha do log já rolou para longe quando o modal aparece. */}
              {chain && <ChainLinkPanel chain={chain} registry={registry} onHover={onHover} />}

              {/* O prompt costuma ser sobre uma carta. Mostrar a carta e o
                  texto do efeito é o que transforma "Efeito 1 / Efeito 2" em
                  algo decidível — o core não manda o texto das opções. */}
              {subject !== null && (
                <CardChoiceButton
                  action={{
                    label: "Efeito desta carta",
                    code: subject,
                    location: plan.subject?.location ?? 0,
                    response: { type: -1 } as unknown as OcgResponse,
                  }}
                  registry={registry}
                  onClick={() => {}}
                  onHover={onHover}
                  readOnly
                />
              )}
              {cardChoices.map((action, index) => (
                <CardChoiceButton
                  key={`card-${index}`}
                  action={action}
                  registry={registry}
                  onClick={() => onRespond(action.response)}
                  onHover={onHover}
                />
              ))}
            </>
          )}
        </div>
      ) : undefined}
    </DecisionSheet>
  );
}

/** Opção do modal apresentada como a carta em si, não como um botão genérico. */
function CardChoiceButton({
  action,
  registry,
  onClick,
  onHover,
  readOnly = false,
}: {
  action: CardAction;
  registry: CardRegistry | null;
  onClick: () => void;
  onHover?: (card: PreviewCard | null) => void;
  /** Só exibe a carta, sem ser escolhível (o "assunto" do prompt). */
  readOnly?: boolean;
}) {
  const texto = useCardText();
  const definition = registry?.get(action.code);
  const image = definition?.images[0]?.image_url_small;

  return (
    // O hover mora no wrapper, não no <button>: quando `readOnly` o botão fica
    // `disabled`, e um botão desabilitado não dispara mouseenter — o "assunto"
    // do prompt (a carta de que ele trata) é exatamente o caso `readOnly`, e é
    // a que mais se quer ler.
    <div
      onMouseEnter={() => onHover?.({ code: action.code })}
      onMouseLeave={() => onHover?.(null)}
    >
    <button
      type="button"
      disabled={readOnly}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded border p-2.5 text-left transition ${
        readOnly
          ? "cursor-default border-[color:var(--tf-gold)]/60 bg-black/60"
          : "border-[color:var(--tf-slot-border)] bg-black/40 hover:border-[color:var(--tf-gold)] hover:bg-black/70"
      }`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={(definition ? texto.name(definition) : "Carta")}
          className="h-20 w-auto shrink-0 rounded-[3px] border border-[color:var(--tf-slot-border)]"
        />
      ) : (
        <div className="tf-card-back h-20 w-14 shrink-0 rounded-[3px]" />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-bold text-[color:var(--tf-gold-bright)]">
          {definition ? texto.name(definition) : `Carta ${action.code}`}
        </span>
        <span className="text-[11px] font-semibold text-emerald-400">
          {action.label} · {locationLabel(action.location)}
        </span>
        {/* Qual efeito, quando a carta tem mais de um — ver `CardAction.detail`. */}
        {action.detail && (
          <span className="text-[11px] font-semibold text-sky-300">{action.detail}</span>
        )}
        {definition?.desc && (
          <span className="mt-1 line-clamp-3 text-[11px] leading-snug text-zinc-300">
            {texto.desc(definition)}
          </span>
        )}
      </span>
    </button>
    </div>
  );
}

/**
 * O elo que está na corrente: quem ativou o quê, e o que aquilo faz.
 *
 * É o contexto que faltava no modal de resposta. O core pergunta "deseja
 * responder com algum efeito?" e para nada mais — quem chegou ao modal depois
 * da animação não tinha como saber se o que vinha era um Raigeki ou um Pote da
 * Ganância, e a decisão de encadear é justamente a que depende disso.
 *
 * `description` é o texto do EFEITO ativado (o core diz qual, quando a carta
 * tem mais de um); o texto da carta entra como reserva, que é o caso comum.
 */
function ChainLinkPanel({
  chain,
  registry,
  onHover,
}: {
  chain: DuelChainLink;
  registry: CardRegistry | null;
  onHover?: (card: PreviewCard | null) => void;
}) {
  const texto = useCardText();
  const definition = registry?.get(chain.code);
  const image = definition?.images[0]?.image_url_small;
  const efeito = chain.description ?? (definition ? texto.desc(definition) : null);

  return (
    <div
      onMouseEnter={() => onHover?.({ code: chain.code })}
      onMouseLeave={() => onHover?.(null)}
      className="mb-2 rounded border border-[color:var(--tf-gold)]/45 bg-black/55 p-2.5"
    >
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--tf-gold)]">
        ⛓ Na corrente
      </p>
      <div className="flex items-start gap-3">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={(definition ? texto.name(definition) : "Carta")}
            className="h-20 w-auto shrink-0 rounded-[3px] border border-[color:var(--tf-slot-border)]"
          />
        ) : (
          <div className="tf-card-back h-20 w-14 shrink-0 rounded-[3px]" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] font-bold text-[color:var(--tf-gold-bright)]">
            {definition ? texto.name(definition) : `Carta ${chain.code}`}
          </span>
          <span className="text-[11px] font-semibold text-amber-300">
            ativada por {chain.playerName}
          </span>
          {efeito && (
            <span className="mt-1 line-clamp-4 text-[11px] leading-snug text-zinc-300">
              {efeito}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * A janela de resposta do Master Duel: "O oponente ativou X. Ativar uma carta
 * em resposta?" — o painel de baixo com as cartas que podem responder, o
 * botão de ativar a escolhida e "Não responder".
 *
 * Não bloqueia a mesa: as mesmas cartas brilham onde estão (mão, campo,
 * pilha) e se ativam clicando nelas, como qualquer jogada. A seta do canto
 * recolhe o painel numa faixa, para ver o campo que decide se vale encadear.
 */
function ChainResponseBar({
  plan,
  trigger,
  chain,
  registry,
  me,
  onRespond,
  onHover,
}: {
  plan: PromptPlan;
  /**
   * Janela dos gatilhos (`isTriggerWindow`): as cartas listadas não respondem
   * a nada — são efeitos que acabaram de ser acionados juntos, e o elo
   * anunciado no topo é o que já entrou nesta mesma corrente.
   */
  trigger: boolean;
  chain: DuelChainLink | null;
  registry: CardRegistry | null;
  me: 0 | 1;
  onRespond: (response: OcgResponse) => void;
  onHover: (card: PreviewCard | null) => void;
}) {
  const texto = useCardText();
  const [recolhida, setRecolhida] = useState(false);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const definition = chain ? registry?.get(chain.code) : undefined;
  const nome = definition ? texto.name(definition) : chain ? `Carta ${chain.code}` : null;
  const doOponente = chain ? chain.player !== me : false;
  const cartas = [...plan.byCard.entries()];
  const jogadas = escolhida ? (plan.byCard.get(escolhida) ?? []) : [];
  const pergunta = chain
    ? trigger
      ? `${chain.playerName} ativou ${nome}. Ativar também um efeito de gatilho (mesma corrente)?`
      : `${chain.playerName} ativou ${nome}. Ativar uma carta em resposta (corrente)?`
    : plan.instruction;
  const passar = plan.global.map((action, index) => (
    <button
      key={index}
      type="button"
      onClick={() => {
        playSfx("click");
        onRespond(action.response);
      }}
      className="md-pill md-pill-ghost min-w-[150px] px-5 py-2 text-[13px]"
    >
      {action.label}
    </button>
  ));

  if (recolhida) {
    return (
      <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center px-2">
        <div
          data-chain-response
          data-menu-avoid
          className={`md-banner pointer-events-auto ${doOponente ? "md-banner-foe" : ""}`}
        >
          <span className="md-banner-text">⛓ {pergunta}</span>
          <button
            type="button"
            data-table-control
            onClick={() => setRecolhida(false)}
            className="md-pill md-pill-primary px-4 py-1.5 text-[13px]"
          >
            Ver as cartas
          </button>
          {passar}
        </div>
      </div>
    );
  }

  return (
    <DecisionSheet
      label={pergunta}
      modal={false}
      tone={doOponente ? "foe" : "neutral"}
      onPeek={() => setRecolhida(true)}
      className="md-sheet-chain"
      sheetProps={{ "data-chain-response": true, "data-menu-avoid": true }}
      head={
        <div className="flex items-center gap-3">
          {chain && definition && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={definition.images[0]?.image_url_small}
              alt={nome ?? "Carta"}
              onMouseEnter={() => onHover({ code: chain.code })}
              className="md-sheet-chain-thumb"
            />
          )}
          <div className="min-w-0 text-left">
            <p className="md-sheet-title">
              {chain ? (
                <>
                  <span className={doOponente ? "text-[color:var(--md-red-bright)]" : "text-[color:var(--md-blue-bright)]"}>
                    {chain.playerName}
                  </span>{" "}
                  ativou <span className="text-[color:var(--md-yellow)]">{nome}</span>.
                </>
              ) : (
                plan.instruction
              )}
            </p>
            <p className="md-sheet-sub">
              {trigger
                ? plan.global.length === 0
                  ? // Gatilhos obrigatórios: não há como passar, só a ordem.
                    "Todos entram na corrente; você escolhe a ordem, um de cada vez."
                  : chain
                    ? "Outro efeito foi acionado junto: ativá-lo nesta corrente? Sem ativar agora, ele se perde."
                    : "Acionados ao mesmo tempo: escolha qual entra primeiro na corrente. Sem ativar, o efeito se perde."
                : cartas.length > 0
                  ? "Ativar uma carta em resposta (corrente)? Escolha abaixo — ou clique na que brilha na mesa."
                  : "Responder?"}
            </p>
          </div>
        </div>
      }
      foot={
        <>
          {jogadas.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                playSfx("click");
                onRespond(action.response);
              }}
              className="md-pill md-pill-effect px-5 py-2 text-left text-[13px]"
            >
              {action.label}
              {action.detail && (
                <span className="block max-w-[280px] text-[11px] font-semibold opacity-80">{action.detail}</span>
              )}
            </button>
          ))}
          {passar}
        </>
      }
    >
      {cartas.length > 0 && (
        <CardStrip>
          {cartas.map(([key, acoes]) => {
            const primeira = acoes[0];
            const def = registry?.get(primeira.code);
            const [controller] = key.split(":").map(Number);
            return (
              <CardTile
                key={key}
                data={{ "data-chain-card": key }}
                image={def?.images[0]?.image_url_small}
                alt={def ? texto.name(def) : "Carta"}
                title={def ? texto.name(def) : undefined}
                place={locationLabel(primeira.location)}
                owner={controller === me ? "me" : "foe"}
                picked={escolhida === key}
                actionable={escolhida !== key}
                onHover={() => onHover({ code: primeira.code })}
                onClick={() => {
                  playSfx("click");
                  // Clicar de novo na escolhida, com um efeito só, ativa — o
                  // duplo clique do MD.
                  if (escolhida === key && acoes.length === 1) {
                    onRespond(primeira.response);
                    return;
                  }
                  setEscolhida(key);
                }}
              />
            );
          })}
        </CardStrip>
      )}
    </DecisionSheet>
  );
}

/**
 * Barra do modal escondido — o caminho de volta para a decisão.
 *
 * Fica no mesmo lugar da barra de seleção (sobre a mesa, embaixo) e repete o
 * essencial: o que se está decidindo e sobre qual carta. Assim dá para olhar o
 * tabuleiro sem esquecer que o engine está parado esperando.
 */
function PendingDecisionBar({
  instruction,
  chain,
  registry,
  onBack,
}: {
  instruction: string;
  chain: DuelChainLink | null;
  registry: CardRegistry | null;
  onBack: () => void;
}) {
  const texto = useCardText();
  const definition = chain ? registry?.get(chain.code) : undefined;

  return (
    <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center">
      <div data-menu-avoid className="md-banner pointer-events-auto">
        <span className="md-banner-text">
          {chain ? "⛓ " : ""}
          {instruction}
          {definition && (
            <span className="ml-2 text-[color:var(--md-yellow)]">{texto.name(definition)}</span>
          )}
        </span>
        <button
          type="button"
          data-table-control
          onClick={() => {
            playSfx("click");
            onBack();
          }}
          className="md-pill md-pill-ok px-5 py-1.5 text-[13px]"
        >
          Voltar à decisão
        </button>
      </div>
    </div>
  );
}

function ModalButton({
  label,
  onClick,
  tone = "default",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  tone?: "primary" | "default";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        playSfx("click");
        onClick();
      }}
      className={`md-pill min-w-[150px] px-6 py-2.5 text-[14px] ${
        tone === "primary" ? "md-pill-ok" : "md-pill-ghost"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Barra centrada sobre o campo para confirmar seleções múltiplas — tanto de
 * cartas (`selection`) quanto de zonas do campo (`placeSelection`). Só usa
 * contagem/validação/progresso, então aceita qualquer uma das duas formas.
 */
function SelectionBar({
  instruction,
  selection,
  picked,
  chosen,
  onConfirm,
  extras,
  onRespond,
}: {
  instruction: string;
  selection: {
    min: number;
    max: number;
    isValid?: (indices: number[]) => boolean;
    progress?: (indices: number[]) => string;
  };
  picked: number[];
  /**
   * Seleção imediata (SELECT_UNSELECT_CARD): quantas o core já tem marcadas.
   * Não há "Confirmar" — cada clique já respondeu, e quem encerra é o
   * "Concluir" que vem em `extras`.
   */
  chosen?: number;
  onConfirm: () => void;
  extras: GlobalAction[];
  onRespond: (response: OcgResponse) => void;
}) {
  const canConfirm =
    picked.length >= selection.min &&
    picked.length <= selection.max &&
    (selection.isValid?.(picked) ?? true);

  const progress =
    chosen !== undefined
      ? `${chosen} marcada${chosen === 1 ? "" : "s"}`
      : selection.progress
        ? `soma ${selection.progress(picked)}`
        : `${picked.length}/${
            selection.min === selection.max
              ? selection.min
              : `${selection.min}-${selection.max}`
          }`;

  return (
    // A faixa de instrução do MD sobre a mesa ("Selecione a carta a destruir"):
    // as cartas escolhíveis brilham em amarelo no próprio campo.
    <div className="md-banner-wrap pointer-events-none absolute inset-x-0 z-40 flex justify-center">
      <div
        data-menu-avoid
        data-selection-bar
        // `tf-panel rounded-full` ficam: os testes acham a barra por eles.
        className="tf-panel md-banner pointer-events-auto rounded-full"
      >
        <span className="md-banner-text">{instruction}</span>
        <span className="md-sheet-count">{progress}</span>
        {chosen === undefined && (
          <button
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
            className="md-pill md-pill-ok px-5 py-1.5 text-[13px]"
          >
            Confirmar
          </button>
        )}
        {extras.map((action, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onRespond(action.response)}
            className={`md-pill px-4 py-1.5 text-[13px] ${chosen !== undefined ? "md-pill-ok" : "md-pill-ghost"}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Painel do próprio deck: quantas cartas restam e como desistir.
 *
 * A rendição pede confirmação no próprio botão porque é a única ação da mesa
 * que não dá para desfazer — um clique errado entregaria o duelo.
 */
function PainelDoDeck({
  restantes,
  onSurrender,
  onClose,
}: {
  restantes: number;
  onSurrender: () => void;
  onClose: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div
      className="tf-modal-scrim absolute inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="tf-modal tf-anim-modal-in w-[min(320px,92%)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="tf-modal-head px-5 py-2.5 text-center">
          <p className="text-base font-semibold text-[color:var(--tf-gold-bright)]">
            Seu Deck
          </p>
          <p className="text-[11px] text-[color:var(--tf-gold-dim)]">
            {restantes} carta(s) restante(s)
          </p>
        </header>

        <div className="flex flex-col gap-2 p-4">
          <button
            type="button"
            onClick={() => (confirmando ? onSurrender() : setConfirmando(true))}
            className={`rounded px-4 py-2 text-sm font-bold transition ${
              confirmando
                ? "bg-red-700 text-white hover:bg-red-600"
                : "border border-[color:var(--tf-slot-border)] text-zinc-200 hover:bg-black/60"
            }`}
          >
            🏳️ {confirmando ? "Confirmar rendição?" : "Render-se"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-[13px] text-zinc-400 transition hover:text-zinc-200"
          >
            Voltar ao duelo
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Aviso de que a vez de decidir é do outro lado.
 *
 * Sem ele o duelo online parece travado: o core bloqueia inteiro esperando um
 * jogador, e a tela de quem espera fica idêntica à de um duelo congelado.
 */
function WaitingBanner({ text, place }: { text: string; place: "rail" | "field" }) {
  const aviso = (
    <span
      data-waiting-banner
      className="tf-delayed-in md-waiting max-w-full truncate rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
    >
      {text}
    </span>
  );
  if (place === "rail") return aviso;
  // Mesa estreita: logo abaixo da mão do oponente (a altura dela, ver
  // `OpponentHand`), nunca por cima.
  return (
    <div className="md-waiting-narrow pointer-events-none absolute inset-x-0 z-30 flex justify-center px-2">
      {aviso}
    </div>
  );
}

function ResultOverlay({
  winner,
  reason,
  me,
  playerName,
  opponentName,
  ending,
  turns,
  lifePoints,
  onPeek,
  spectating = false,
}: {
  winner: number;
  /** Por que o duelo acabou, quando se sabe — ver `DuelSnapshot.winReason`. */
  reason: string | null;
  me: 0 | 1;
  playerName: string;
  opponentName: string;
  ending: NonNullable<DuelBoardProps["ending"]>;
  /** Turnos jogados. */
  turns: number;
  /** LP final, por assento absoluto. */
  lifePoints: [number, number];
  /** Encolhe o resultado para ver a mesa final. */
  onPeek: () => void;
  /** Quem só assiste não ganhou nem perdeu: "FINISHED", como o MD. */
  spectating?: boolean;
}) {
  // `winner` é o assento absoluto que o core declarou; 2 é empate.
  const text =
    winner === 2
      ? "Empate"
      : winner === me
        ? `${playerName} venceu!`
        : `${opponentName} venceu!`;
  const foe = (1 - me) as 0 | 1;
  /** A palavra grande do MD — em inglês estilizado, como no jogo. */
  const palavra =
    winner === 2 ? "DRAW" : spectating ? "FINISHED" : winner === me ? "VICTORY" : "LOSE";
  const tom = winner === 2 || spectating ? "draw" : winner === me ? "win" : "lose";

  const placa = (lado: "me" | "foe") => {
    const seat = lado === "me" ? me : foe;
    const nome = lado === "me" ? playerName : opponentName;
    const venceu = winner === seat;
    return (
      <div className={`md-result-player md-result-player-${lado} ${venceu ? "md-result-player-won" : ""}`}>
        {venceu && <span aria-hidden className="md-result-crown" />}
        <span aria-hidden className="md-result-avatar">
          {nome.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="min-w-0">
          <span className="md-result-name">{nome}</span>
          <span className="md-result-lp">
            LP <b>{lifePoints[seat]}</b>
          </span>
        </span>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={text}
      data-result
      data-result-word={palavra}
      className={`md-result md-result-${tom}`}
    >
      <div aria-hidden className="md-result-veil" />
      <div className="md-result-content">
        <p aria-hidden className="md-result-word" data-text={palavra}>
          {palavra}
        </p>
        {/* O motivo embaixo da palavra: nos finais que não passam por dano
            (deck vazio, rendição, Exodia) a tela não dizia nada sobre o que
            aconteceu. */}
        <p className="md-result-reason">
          <span className="sr-only">{text} </span>
          {reason ?? text}
        </p>

        <div className="md-result-players">
          {placa("me")}
          <span aria-hidden className="md-result-vs">VS</span>
          {placa("foe")}
        </div>
        {/* O resumo que o Tag Force mostrava ao fim: quanto durou. */}
        <p className="md-result-turns">
          {turns} turno{turns === 1 ? "" : "s"}
        </p>

        <div className="md-result-actions">
          {ending.onBackToRoom && (
            <>
              <button type="button" onClick={ending.onBackToRoom} className="md-pill md-pill-ok min-w-[240px] px-6 py-2.5 text-[14px]">
                Voltar à sala
              </button>
              <p className="max-w-[22rem] text-center text-[12px] leading-snug text-[color:var(--md-text-dim)]">
                Na sala dá para trocar de deck e ficar pronto de novo — a
                próxima partida começa quando os dois estiverem prontos.
              </p>
            </>
          )}

          {/* Revanche contra o bot: os mesmos decks, um clique. Trocar de deck
              é o "voltar ao lobby" logo abaixo. */}
          {ending.onRematch && (
            <button
              type="button"
              data-rematch
              onClick={ending.onRematch}
              className="md-pill md-pill-ok min-w-[240px] px-6 py-2.5 text-[14px]"
            >
              {ending.rematchLabel ?? "Revanche"}
            </button>
          )}

          <a
            href={ending.backHref}
            className={`md-pill min-w-[240px] px-6 py-2.5 text-center text-[14px] ${
              ending.onBackToRoom || ending.onRematch ? "md-pill-ghost" : "md-pill-ok"
            }`}
          >
            {ending.onRematch && !ending.rematchLabel ? "Trocar de deck" : ending.backLabel}
          </a>

          <button
            type="button"
            data-table-control
            onClick={onPeek}
            className="mt-1 text-[12px] text-[color:var(--md-text-dim)] hover:text-white"
          >
            👁 Ver a mesa final <span className="opacity-60">(Esc)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * O resultado encolhido: uma faixa no topo, para conferir a mesa final (o que
 * ficou no campo, o Cemitério, o histórico) e voltar ao resultado.
 */
function ResultPeekBar({
  winner,
  me,
  onBack,
}: {
  winner: number;
  me: 0 | 1;
  onBack: () => void;
}) {
  const texto = winner === 2 ? "Empate" : winner === me ? "Vitória" : "Derrota";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[12%] z-50 flex justify-center">
      <div className="md-banner pointer-events-auto">
        <span className="md-banner-text">Duelo encerrado — {texto}</span>
        <button
          type="button"
          data-table-control
          onClick={onBack}
          className="md-pill md-pill-ok px-5 py-1.5 text-[13px]"
        >
          Voltar ao resultado
        </button>
      </div>
    </div>
  );
}

/**
 * O registro do duelo — o "Duel Log" do Master Duel: um painel escuro à
 * direita, com o turno em faixa (azul o seu, vermelho o do oponente), as fases
 * em letra miúda e cada jogada com a miniatura da carta e um fio na cor de
 * quem jogou.
 */
function DuelLog({
  entries,
  reveals,
  onOpenReveals,
  me,
  onHover,
  registry,
  onClose,
}: {
  entries: DuelLogEntry[];
  /** Revelações desta ótica — o botão só existe quando houve alguma. */
  reveals: DuelReveal[];
  onOpenReveals: () => void;
  /** Quem olha — pinta as linhas de cada lado com a cor dele. */
  me: 0 | 1;
  /** Passar o mouse numa linha com carta mostra a carta na leitura. */
  onHover: (card: PreviewCard | null) => void;
  /** Para escrever os nomes de carta no idioma escolhido (ver `log-names.ts`). */
  registry: CardRegistry | null;
  onClose?: () => void;
}) {
  const texto = useCardText();
  const noIdioma = (entry: DuelLogEntry) =>
    localizeLogText(
      entry.text,
      entry.codes,
      (code) => registry?.get(code)?.name,
      (code) => {
        const definicao = registry?.get(code);
        return definicao ? texto.name(definicao) : undefined;
      },
    );
  // O que é jogo. Fora: o progresso da carga (`system`) e as dicas do core
  // sobre a escolha em curso (`hint`) — essas já aparecem na barra da seleção,
  // onde servem, e no histórico só empurravam o jogo para fora da tela.
  const linhas = entries.filter((entry) => entry.kind !== "system" && entry.kind !== "hint");

  return (
    <div className="md-log flex min-h-0 flex-1 flex-col">
      <div className="md-log-head flex shrink-0 items-center justify-between gap-2">
        <h3>Duel Log</h3>
        <div className="flex items-center gap-1.5">
          {reveals.length > 0 && (
            <button
              type="button"
              data-table-control
              onClick={onOpenReveals}
              title="Ver as cartas que foram reveladas"
              className="md-pill md-pill-ghost px-2 py-0.5 text-[10px]"
            >
              👁 {reveals.length}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              data-table-control
              onClick={onClose}
              aria-label="Fechar o registro"
              className="md-info-close"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {/* `flex-col-reverse` com a lista invertida gruda a rolagem embaixo: a
          linha mais nova fica sempre visível sem precisar de scroll manual,
          que é justamente a linha que importa. */}
      <div data-duel-log className="md-log-list flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        {linhas
          .slice(-80)
          .map((entry, index) => ({ entry, index }))
          .reverse()
          .map(({ entry, index }) => {
            const carta = entry.codes?.[0];
            const lado =
              entry.actor === undefined ? null : entry.actor === me ? "mine" : "foe";
            if (entry.kind === "turn") {
              // O turno vira separador: é por ele que se rola o histórico
              // ("o que ele fez no turno passado?").
              return (
                <p
                  key={`${index}-${entry.text}`}
                  data-log-kind="turn"
                  className={`md-log-turn ${lado === "foe" ? "md-log-turn-foe" : "md-log-turn-me"}`}
                >
                  {noIdioma(entry)}
                </p>
              );
            }
            if (entry.kind === "phase") {
              return (
                <p key={`${index}-${entry.text}`} data-log-kind="phase" className="md-log-phase">
                  {entry.text}
                </p>
              );
            }
            const definicao = carta ? registry?.get(carta) : undefined;
            return (
              <div
                key={`${index}-${entry.text}`}
                data-log-card={carta}
                onMouseEnter={carta ? () => onHover({ code: carta }) : undefined}
                className={`md-log-entry ${
                  lado === "mine" ? "md-log-mine" : lado === "foe" ? "md-log-foe" : ""
                } ${carta ? "cursor-help" : ""}`}
              >
                {definicao ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={definicao.images[0]?.image_url_small}
                    alt=""
                    loading="lazy"
                    className="md-log-thumb"
                  />
                ) : (
                  <span aria-hidden className="md-log-thumb md-log-thumb-none" />
                )}
                <p className="md-log-text">{noIdioma(entry)}</p>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * "⛓ Elo 2 — Oponente ativou (da mão)" no topo da leitura, com o efeito que o
 * core diz ter sido ativado. O texto completo da carta vem logo abaixo, como
 * em qualquer leitura — este cabeçalho só diz por que ela está ali e qual
 * efeito foi (a carta pode ter mais de um).
 */
function ActivationBanner({ activation }: { activation: ActivationHeader }) {
  const origem = ORIGEM[activation.from];
  const negado = activation.state === "negated" || activation.state === "disabled";
  return (
    <div
      data-preview-activation={activation.link}
      className={`md-detail-activation ${negado ? "md-detail-activation-off" : activation.mine ? "md-detail-activation-me" : "md-detail-activation-foe"}`}
    >
      <p className="md-detail-activation-head">
        <span aria-hidden className="md-detail-activation-link">
          {activation.link}
        </span>
        Elo {activation.link} — {activation.who} ativou{origem ? ` ${origem}` : ""}
        {negado && (
          <span className="md-detail-activation-negated">
            {activation.state === "negated" ? "Ativação negada" : "Efeito negado"}
          </span>
        )}
      </p>
      {activation.description && <p className="md-detail-activation-effect">{activation.description}</p>}
    </div>
  );
}

/** "Magia de Campo", "Armadilha de Resposta" — o subtipo, como o MD escreve. */
function spellTrapSubtype(type: string, race: string | undefined): string {
  const magia = /spell/i.test(type);
  const sub: Record<string, string> = magia
    ? {
        Normal: "Magia Normal",
        Continuous: "Magia Contínua",
        Equip: "Magia de Equipamento",
        Field: "Magia de Campo",
        "Quick-Play": "Magia Rápida",
        Ritual: "Magia de Ritual",
      }
    : {
        Normal: "Armadilha Normal",
        Continuous: "Armadilha Contínua",
        Counter: "Armadilha de Resposta",
      };
  return (race && sub[race]) ?? (magia ? "Magia" : "Armadilha");
}

/**
 * A leitura da carta — o painel do canto esquerdo do Master Duel: o nome numa
 * faixa com o círculo do atributo, a carta à esquerda e, ao lado, Nível, ATK
 * e DEF com os ícones do jogo (os valores ATUAIS, em azul se subiram e em
 * vermelho se caíram); embaixo, a faixa do tipo na cor da moldura da carta e
 * o texto rolável. O fundo diz de quem é a carta (azul sua, vermelho do
 * oponente).
 */
function CardPreview({
  card,
  registry,
  marksOf,
  activation = null,
  viewer,
  hideEmpty = false,
}: {
  card: PreviewCard | null;
  registry: CardRegistry | null;
  marksOf: (card: BoardCard | null | undefined) => CardMark[];
  /** Quando a carta está aqui porque acabou de ser ativada (ver `ativacaoLida`). */
  activation?: ActivationHeader | null;
  /** Quem olha a mesa — decide o fundo azul (sua) ou vermelho (do oponente). */
  viewer: 0 | 1;
  /** Sem carta para ler, não desenha nada (o painel do MD só aparece com carta). */
  hideEmpty?: boolean;
}) {
  const texto = useCardText();
  const definition = card?.code ? registry?.get(card.code) : undefined;
  // O fundo da leitura diz de quem é a carta, como no Master Duel: azul a
  // sua, vermelho a do oponente. Carta sem dono conhecido (lista de busca,
  // seletor) fica neutra.
  const dono =
    card?.controller === undefined || card.controller === null
      ? "neutral"
      : card.controller === viewer
        ? "me"
        : "foe";

  if (!definition) {
    if (hideEmpty) return null;
    return (
      <div className="md-detail md-detail-neutral flex min-h-0 flex-1 items-center justify-center p-3 text-center text-[13px] text-zinc-500">
        Passe o mouse sobre uma carta
        <br />
        para ver os detalhes
      </div>
    );
  }

  const image = definition.images[0]?.image_url ?? definition.images[0]?.image_url_small;
  const isMonster = definition.type.includes("Monster");
  const isLink = Boolean(definition.linkval) || Boolean(card?.link);
  const isXyz = definition.frameType.includes("xyz");
  const isPendulum = definition.frameType.includes("pendulum");
  const moldura = isPendulum ? "pendulum" : definition.frameType.replace(/_pendulum$/, "");
  const isSpell = /spell/i.test(definition.type);
  const isTrap = /trap/i.test(definition.type);

  // Linha de tipo no formato da carta: [Dragão/Sincro/Regulador/Efeito]
  const typeLine = isMonster
    ? `[${[translateRace(definition.race) ?? "?", ...monsterTypeParts(definition.humanReadableCardType, definition.type)].join("/")}]`
    : `[${translateType(definition.type)}${
        definition.race ? ` / ${translateRace(definition.race)}` : ""
      }]`;

  // Valores ATUAIS quando a carta está em campo (o core informa); os impressos
  // quando ela está na mão, numa pilha ou num modal.
  const rating = card?.link?.rating ?? definition.linkval ?? 0;
  const markers = card?.link?.markers ?? definition.linkMarkers ?? 0;
  const rank = card?.rank || (isXyz ? (definition.level ?? 0) : 0);
  const level = card?.level || (!isXyz && !isLink ? (definition.level ?? 0) : 0);
  /** O Nível impresso — para mostrar quando um efeito o mudou. */
  const levelBase = !isXyz && !isLink ? (definition.level ?? 0) : 0;
  const leftScale = card?.scales?.left ?? definition.scale;
  const rightScale = card?.scales?.right ?? definition.scale;
  const materials = card?.overlays ?? [];
  // Só carta EM CAMPO tem marca (a da mão ou de um modal não tem zona).
  const marks =
    card && "counters" in card && card.counters !== undefined
      ? marksOf(card as BoardCard)
      : [];
  // Em campo, o atributo ATUAL (um efeito pode tê-lo trocado); fora dele, o
  // impresso.
  const atributoAtual =
    (card && "attribute" in card && card.attribute ? card.attribute : null) ?? definition.attribute;
  const kanji = isSpell ? "魔" : isTrap ? "罠" : ATTRIBUTE_KANJI[atributoAtual ?? ""];
  const atributo = isSpell ? "spell" : isTrap ? "trap" : (atributoAtual ?? "").toLowerCase();

  return (
    <div
      data-preview-owner={dono}
      data-preview-frame={moldura}
      className={`md-detail md-detail-${dono} md-frame-${moldura} flex min-h-0 flex-col overflow-hidden`}
    >
      {activation && <ActivationBanner activation={activation} />}

      <header className="md-detail-name">
        <h4>{texto.name(definition)}</h4>
        {kanji && (
          <span
            className={`md-attr md-attr-${atributo}`}
            title={
              isMonster
                ? atributoAtual !== definition.attribute && definition.attribute
                  ? `${attributeLabel(atributoAtual ?? undefined)} (original: ${attributeLabel(definition.attribute)})`
                  : (attributeLabel(atributoAtual ?? undefined) ?? undefined)
                : isSpell
                  ? "Magia"
                  : "Armadilha"
            }
          >
            {kanji}
          </span>
        )}
      </header>

      <div className="md-detail-top">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={texto.name(definition)} className="md-detail-art" />
        )}
        <div className="md-detail-stats">
          {isMonster ? (
            <>
              {isLink ? (
                <p data-preview-link={rating} className="md-detail-stat" title={`Link ${rating}`}>
                  <span aria-hidden className="md-detail-icon md-icon-link" />
                  <span className="md-detail-value">LINK-{rating}</span>
                  <LinkArrowsGlyph markers={markers} />
                </p>
              ) : rank ? (
                <p data-preview-rank={rank} className="md-detail-stat" title={`Rank ${rank}`}>
                  <span aria-hidden className="md-detail-icon md-icon-rank" />
                  <span className="md-detail-value">{rank}</span>
                </p>
              ) : level ? (
                <p
                  data-preview-level={level}
                  className="md-detail-stat"
                  title={levelBase && levelBase !== level ? `Nível ${level} (original ${levelBase})` : `Nível ${level}`}
                >
                  <span aria-hidden className="md-detail-icon md-icon-level" />
                  {/* Nível mudado por efeito (Ruído Mental, Fusão do Nível…): a
                      mesma cor do ATK/DEF alterado — azul subiu, vermelho desceu. */}
                  <span
                    className={`md-detail-value ${
                      levelBase && level > levelBase
                        ? "md-stat-up"
                        : levelBase && level < levelBase
                          ? "md-stat-down"
                          : ""
                    }`}
                  >
                    {level}
                  </span>
                </p>
              ) : null}
              <p className="md-detail-stat" title="ATK">
                <span aria-hidden className="md-detail-icon md-icon-atk" />
                <span className="md-detail-value">
                  <StatValue
                    value={card?.attack ?? definition.atk ?? null}
                    base={card?.baseAttack ?? definition.atk ?? null}
                  />
                </span>
              </p>
              {!isLink && (
                <p className="md-detail-stat" title="DEF">
                  <span aria-hidden className="md-detail-icon md-icon-def" />
                  <span className="md-detail-value">
                    <StatValue
                      value={card?.defenseValue ?? definition.def ?? null}
                      base={card?.baseDefense ?? definition.def ?? null}
                    />
                  </span>
                </p>
              )}
              {isPendulum && leftScale !== undefined && (
                <p className="md-detail-stat md-detail-scales" title="Escalas de Pêndulo">
                  <span className="text-sky-300">◂{leftScale}</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-rose-300">{rightScale}▸</span>
                </p>
              )}
            </>
          ) : (
            <p className="md-detail-subtype">
              <span aria-hidden className={`md-detail-icon ${isSpell ? "md-icon-spell" : "md-icon-trap"}`} />
              {spellTrapSubtype(definition.type, definition.race)}
            </p>
          )}
        </div>
      </div>

      <p className="md-detail-band">{typeLine}</p>

      {(marks.length > 0 || materials.length > 0) && (
        <div className="md-detail-extra">
          {marks.length > 0 && (
            <ul data-preview-marks className="space-y-0.5">
              {marks.map((mark, index) => (
                <li
                  key={index}
                  className={`text-[12px] leading-snug ${
                    mark.tone === "negated"
                      ? "font-semibold text-red-300"
                      : mark.tone === "counter"
                        ? "text-amber-200"
                        : mark.tone === "declared"
                          ? "text-fuchsia-200"
                          : mark.tone === "link"
                            ? "text-emerald-200"
                            : mark.tone === "turn"
                              ? "text-sky-200"
                              : "text-zinc-200"
                  }`}
                >
                  {mark.chip.replace(/\d+$/, "")} {mark.text}
                </li>
              ))}
            </ul>
          )}
          {materials.length > 0 && (
            <div className={marks.length > 0 ? "mt-1.5" : undefined}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">
                ◈ Materiais Xyz ({materials.length})
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {materials.map((code, index) => {
                  const material = registry?.get(code);
                  return (
                    <span
                      key={`${code}-${index}`}
                      className="rounded bg-violet-950/70 px-1.5 py-0.5 text-[11px] text-violet-100"
                    >
                      {material ? texto.name(material) : `Carta ${code}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Termos de regra sublinhados, com a definição a um toque (glossário);
          as quebras de linha da carta (as listas "●") ficam como estão. */}
      <GlossaryText text={texto.desc(definition)} className="md-detail-text" />
    </div>
  );
}

/**
 * As setas de um Link em miniatura (3×3), para a leitura da carta — a mesma
 * disposição da carta impressa, com o centro vazio.
 */
function LinkArrowsGlyph({ markers }: { markers: number }) {
  const cells = [0x040, 0x080, 0x100, 0x008, 0, 0x020, 0x001, 0x002, 0x004];
  return (
    <span className="inline-grid grid-cols-3 gap-px" aria-hidden>
      {cells.map((bit, index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-[1px] ${
            bit === 0 ? "bg-transparent" : markers & bit ? "bg-red-500" : "bg-zinc-700"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * De onde saem os marcadores (SELECT_COUNTER): uma linha por carta, com quanto
 * tirar dela — de 0 até o que ela tem —, e o total precisa fechar em N.
 */
function CounterSelectModal({
  instruction,
  selection,
  registry,
  onRespond,
  onHover,
  hidden,
  onPeek,
}: {
  instruction: string;
  selection: CounterSelection;
  registry: CardRegistry | null;
  onRespond: (response: OcgResponse) => void;
  onHover: (card: PreviewCard | null) => void;
  /** Escondido para ver a mesa — a distribuição já feita continua aqui. */
  hidden: boolean;
  onPeek: () => void;
}) {
  const texto = useCardText();
  const [amounts, setAmounts] = useState<number[]>(() => selection.cards.map(() => 0));
  const total = amounts.reduce((sum, value) => sum + value, 0);

  function ajustar(index: number, delta: number) {
    setAmounts((current) =>
      current.map((value, i) =>
        i === index
          ? Math.max(0, Math.min(selection.cards[i].max, value + delta))
          : value,
      ),
    );
  }

  return (
    <DecisionShell
      label={instruction}
      hidden={hidden}
      className="flex max-h-full w-[min(520px,94%)] flex-col overflow-hidden"
    >
        <p className="tf-modal-head shrink-0 px-5 py-2.5 text-center text-[15px] font-semibold text-[color:var(--tf-gold-bright)]">
          {instruction}
        </p>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3.5">
          {selection.cards.map((card, index) => {
            const definition = registry?.get(card.code);
            const image = definition?.images[0]?.image_url_small;
            return (
              <div
                key={`${card.controller}-${card.location}-${card.sequence}`}
                onMouseEnter={() => onHover({ code: card.code })}
                className="flex items-center gap-3 rounded border border-[color:var(--tf-slot-border)] bg-black/40 p-2"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-14 w-auto rounded-[3px]" />
                ) : (
                  <div className="tf-card-back h-14 w-10 rounded-[3px]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-[color:var(--tf-gold-bright)]">
                    {definition ? texto.name(definition) : `Carta ${card.code}`}
                  </span>
                  <span className="text-[11px] text-amber-200">
                    tem {card.max} {selection.counterName}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => ajustar(index, -1)}
                    disabled={amounts[index] === 0}
                    className="h-7 w-7 rounded border border-[color:var(--tf-slot-border)] text-[15px] font-bold text-[color:var(--tf-gold-bright)] disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-mono text-[15px] font-bold text-zinc-100">
                    {amounts[index]}
                  </span>
                  <button
                    type="button"
                    onClick={() => ajustar(index, 1)}
                    disabled={amounts[index] >= card.max || total >= selection.count}
                    className="h-7 w-7 rounded border border-[color:var(--tf-slot-border)] text-[15px] font-bold text-[color:var(--tf-gold-bright)] disabled:opacity-30"
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--tf-slot-border)] p-4">
          <span className="font-mono text-[13px] text-[color:var(--tf-gold-dim)]">
            {total}/{selection.count}
          </span>
          <PeekButton onPeek={onPeek} />
          <ModalButton
            tone="primary"
            label="Confirmar"
            disabled={total !== selection.count}
            onClick={() => onRespond(selection.build(amounts))}
          />
        </div>
    </DecisionShell>
  );
}
