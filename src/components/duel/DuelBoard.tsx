"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OcgLocation, type OcgResponse, type SelectFieldPlace } from "@n1xx1/ocgcore-wasm";

import { useCardRegistry } from "@/context/CardRegistryProvider";
import { useCardText } from "@/hooks/useCardText";
import { useDuelFeedback, type DuelFlash } from "@/hooks/useDuelFeedback";
import { playSfx } from "@/lib/audio/sfx";
import type { DuelEventListener } from "@/lib/duel/duel-events";
import {
  attributeLabel,
  monsterTypeParts,
  translateRace,
  translateType,
} from "@/lib/card-labels";
import { PHASE_TRACK, phaseLabel } from "@/lib/duel/phase-labels";
import {
  buildPromptPlan,
  cardKey,
  locationLabel,
  type CardAction,
  type GlobalAction,
  type PromptPlan,
} from "@/lib/duel/duel-actions";
import {
  EMPTY_ENGINE_STRINGS,
  fetchEngineStrings,
  type EngineStringsDb,
} from "@/lib/duel/engine-strings";
import { needsCardPicker } from "@/lib/duel/prompt-reach";
import type { BoardCard, BoardPlayer } from "@/lib/duel/board-state";
import { linkedZones } from "@/lib/duel/link-geometry";
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
  DuelCardSlot,
  DuelPile,
  StatValue,
} from "@/components/duel/DuelCardSlot";
import { SoundControl } from "@/components/duel/SoundControl";
import { AttackFlightLayer } from "@/components/duel/AttackFlight";
import { DrawFlightLayer } from "@/components/duel/DrawFlight";
import { SortCardModal } from "@/components/duel/SortCardModal";
import { AnnounceCardModal } from "@/components/duel/AnnounceCardModal";

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
}: DuelBoardProps) {
  /** O outro assento — usado o tempo todo, e `1 - me` espalhado confunde. */
  const foeSeat = (1 - me) as 0 | 1;
  const { flashes, shake, toss, flight, reveal, draw } = useDuelFeedback(
    subscribeEvents,
    me,
  );
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const { registry, cards } = useCardRegistry();
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
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
  const plan = useMemo(
    () => (prompt ? buildPromptPlan(prompt, engineStrings) : null),
    [prompt, engineStrings],
  );

  // Um prompt novo zera seleção/menu do anterior. Ajustar durante o render (em
  // vez de num efeito) evita exibir por um frame o menu do prompt antigo.
  const [lastPrompt, setLastPrompt] = useState(prompt);
  if (prompt !== lastPrompt) {
    setLastPrompt(prompt);
    setMenuFor(null);
    setPicked([]);
    setModalEspiado(false);
  }

  // A leitura já vem mascarada na ótica de `me` (ver `readBoardState`), então
  // `boards[me]` é o único tabuleiro que esta tela tem direito de mostrar.
  const board = snapshot.boards[me];
  const you = board?.players[me] ?? EMPTY_PLAYER;
  const foe = board?.players[foeSeat] ?? EMPTY_PLAYER;

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
        codes.map((code) => registry?.get(code)?.name ?? `Carta ${code}`),
      );
    });
    return names;
  }, [board, isTcg, registry]);

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
        cardName: (code) => registry?.get(code)?.name ?? `Carta ${code}`,
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
          return registry?.get(alvo.code)?.name ?? `Carta ${alvo.code}`;
        },
      });
    },
    [engineStrings, registry, me, you, foe],
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

  // Enquanto o engine espera o outro assento não há nada a clicar aqui — e o
  // `plan` já vem vazio, mas travar explicitamente evita que um resquício de
  // seleção do prompt anterior continue respondendo ao mouse.
  const busy = snapshot.isProcessing || waitingForFoe;
  const selection = plan?.selection ?? null;
  const announce = plan?.announce ?? null;
  const placeSelection = plan?.placeSelection ?? null;

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

  const slotProps: SlotPropsFn = (card, zone) => {
    const key = cardKey(zone.player, zone.location, zone.sequence);
    const placeResponse = placeByKey.get(key);
    const placeSelectionIndex = placeSelectionKeys.get(key) ?? -1;
    const hasActions = card ? actionableKeys.has(key) : false;
    const selectionIndex = selection?.keys.indexOf(key) ?? -1;
    const isLocked = lockedKeys.has(key);
    const isPicked =
      isLocked ||
      (selectionIndex >= 0 && picked.includes(selectionIndex)) ||
      (placeSelectionIndex >= 0 && picked.includes(placeSelectionIndex));

    const clickable =
      !busy &&
      !isLocked &&
      (Boolean(placeResponse) || hasActions || placeSelectionIndex >= 0);

    // O realce diz QUAL é a oferta, não só que existe uma. Uma carta com
    // efeito ativável brilha dourado e forte — é o que se procura ao varrer a
    // mesa; um alvo de seleção brilha ciano; uma zona vazia só ganha contorno.
    const intent: "activate" | "select" | "place" = hasActions
      ? "activate"
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
              togglePick(selectionIndex);
              return;
            }
            setMenuFor((current) => (current === key ? null : key));
          }
        : undefined,
      menu: menuFor === key ? (plan?.byCard.get(key) ?? null) : null,
      onChoose: (action: CardAction) => respond(action.response),
      onCloseMenu: () => setMenuFor(null),
    };
  };

  /** Abre os materiais Xyz de um monstro (selo no slot). */
  const openMaterials = (card: BoardCard) => () =>
    setOpenPile({
      title: `Materiais Xyz — ${registry?.get(card.code ?? 0)?.name ?? "monstro"}`,
      // O monstro é reencontrado pela zona: os materiais mudam (desanexar é
      // o custo mais comum de um Xyz) com o modal aberto.
      pick: (players) => {
        const lado = card.controller === me ? players.you : players.foe;
        const atual = lado.monsters[card.sequence];
        return atual ? overlayCards(atual) : [];
      },
    });

  const shared = {
    registry,
    onHover: setPreview,
    slotProps,
    isTcg,
    linkedBy,
    openMaterials,
    marksOf,
    isDisabledZone,
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
        placeholder="Extra"
        upsideDown={owner === foeSeat}
        zoneKey={key}
        onHover={setPreview}
        showLevel
        linkedBy={linkedBy.get(key)}
        onOpenMaterials={card?.overlays.length ? openMaterials(card) : undefined}
        marks={slotChips(marksOf(card))}
        disabledZone={isDisabledZone(zone.player as 0 | 1, zone.location, zone.sequence)}
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

  return (
    <div className="tf-playmat relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ---------------- LP nos cantos, estilo Tag Force ---------------- */}
      <div className="flex shrink-0 items-stretch gap-2 px-2 pt-1.5">
        <div className="relative flex min-w-0 flex-1">
          <LifeBar
            name={playerName}
            role="Você"
            lp={snapshot.lifePoints[me]}
            active={snapshot.turnPlayer === me}
          />
          <PlayerHints hints={snapshot.playerHints[me]} />
          <FlashLayer flashes={flashes} anchor="player" />
        </div>
        <div className="relative flex min-w-0 flex-1">
          <LifeBar
            name={opponentName}
            role="Oponente"
            lp={snapshot.lifePoints[foeSeat]}
            active={snapshot.turnPlayer === foeSeat}
            align="right"
          />
          <PlayerHints hints={snapshot.playerHints[foeSeat]} align="right" />
          <FlashLayer flashes={flashes} anchor="opponent" />
        </div>
        <SoundControl />
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/*
          Leitura da carta à esquerda, histórico à direita.
          As cartas do tabuleiro têm proporção fixa e crescem a partir da
          ALTURA da fileira, então numa tela 16:9 sobra largura de qualquer
          jeito — apertar as colunas laterais não aumentaria carta nenhuma.
          Por isso a sobra vira leitura de carta, que é o que se consulta
          antes de cada jogada, e o histórico ganha coluna própria em vez de
          disputar altura com ela.
        */}
        <aside className="flex w-[var(--tf-rail-left)] shrink-0 flex-col overflow-hidden p-2">
          <CardPreview card={preview} registry={registry} marksOf={marksOf} />
        </aside>

        {/* -------- campo -------- */}
        <div
          ref={fieldRef}
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col gap-1 p-1.5 ${
            shake !== null ? "tf-shake" : ""
          }`}
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
          {waitingForFoe && <WaitingBanner name={opponentName} />}
          <AttackFlightLayer flight={flight} fieldRef={fieldRef} />
          <DrawFlightLayer draw={draw} fieldRef={fieldRef} />
          {toss && <TossOverlay toss={toss} />}
          {reveal && <RevealOverlay reveal={reveal} registry={registry} />}

          {/* Mão do oponente: versos, para se saber quantas ele tem — e as
              faces das que o core marcou como públicas (Olho Mágico da
              Verdade). */}
          <OpponentHand
            cards={foe.hand}
            seat={foeSeat}
            registry={registry}
            onHover={setPreview}
          />

          <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
            {/* Oponente — espelhado e de cabeça para baixo. */}
            <FieldRow
              cards={foe.spells}
              owner={foeSeat}
              zone="spell"
              mirrored
              left={
                <DuelPile
                  label="Deck"
                  count={foe.deckSize}
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
                <GraveCorner
                  banished={
                    <DuelPile
                      label="Banidas"
                      count={foe.banishedSize}
                      onOpen={openWith("Banidas do oponente", (p) => p.foe.banished)}
                    />
                  }
                  grave={
                    <DuelPile
                      label="Cemit."
                      count={foe.graveSize}
                      onOpen={openWith("Cemitério do oponente", (p) => p.foe.grave)}
                      topCard={foe.graveTop}
                      registry={registry}
                      upsideDown
                    />
                  }
                  paraFora="left"
                />
              }
              right={<FieldSpellSlot player={foe} owner={foeSeat} {...shared} />}
              {...shared}
            />

            {/* Trilha de fases entre os dois campos, como no Tag Force —
                clicar avança a fase quando o engine permite. No TCG ela vira
                coluna, no meio da fileira das Zonas Extra: assim as duas zonas
                ficam exatamente sobre as colunas 2 e 4, que é o que faz as
                setas Link de quem está nelas se lerem. */}
            {isTcg ? (
              <div
                data-row="extra-monster-zones"
                className="flex min-h-0 flex-1 items-center justify-center gap-1.5"
              >
                <div className={CARD_SHAPE} />
                <div className={CARD_SHAPE} />
                {extraZone("left")}
                <PhaseTrack
                  vertical
                  phase={snapshot.phase}
                  turn={snapshot.turnCount}
                  actions={plan?.global ?? []}
                  disabled={busy}
                  onRespond={respond}
                />
                {extraZone("right")}
                <div className={CARD_SHAPE} />
                <div className={CARD_SHAPE} />
              </div>
            ) : (
              <PhaseTrack
                phase={snapshot.phase}
                turn={snapshot.turnCount}
                actions={plan?.global ?? []}
                disabled={busy}
                onRespond={respond}
              />
            )}

            <FieldRow
              cards={you.monsters.slice(0, 5)}
              owner={me}
              zone="monster"
              left={<FieldSpellSlot player={you} owner={me} {...shared} />}
              right={
                <GraveCorner
                  grave={
                    <DuelPile
                      label="Cemit."
                      count={you.graveSize}
                      onOpen={openWith("Seu Cemitério", (p) => p.you.grave)}
                      topCard={you.graveTop}
                      registry={registry}
                    />
                  }
                  banished={
                    <DuelPile
                      label="Banidas"
                      count={you.banishedSize}
                      onOpen={openWith("Suas banidas", (p) => p.you.banished)}
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
                  count={you.extraSize}
                  badge={faceUpBadge(you.extraFaceUp)}
                  onOpen={openWith("Seu Extra Deck", (p) => p.you.extra)}
                />
              }
              right={
                <DuelPile
                  label="Deck"
                  count={you.deckSize}
                  dataPile={`deck-${me}`}
                  // O deck é a única pilha que não se abre para consulta — o
                  // conteúdo é secreto. Sobra como o lugar natural para o
                  // gesto que encerra a partida, como empurrar o deck na mesa.
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

          <Hand cards={you.hand} seat={me} {...shared} />

          {/* Barra flutuante da seleção múltipla: fica sobre o campo, centrada,
              porque o jogador precisa continuar vendo as cartas que marca. */}
          {selection && !needsPicker && (
            <SelectionBar
              instruction={plan?.instruction ?? ""}
              selection={selection}
              picked={picked}
              onConfirm={() => respond(selection.build(picked))}
              extras={plan?.global ?? []}
              onRespond={respond}
            />
          )}

          {/* Modal escondido: a decisão continua pendurada, e este é o caminho
              de volta. Sem ele "ver o tabuleiro" seria um beco sem saída. */}
          {showModal && !plan?.sorting && plan && !plan.announceCard && modalEspiado && (
            <PendingDecisionBar
              instruction={plan.instruction}
              chain={snapshot.chain}
              registry={registry}
              onBack={() => setModalEspiado(false)}
            />
          )}

          {/* SELECT_PLACE/SELECT_DISFIELD com mais de 1 zona: todo candidato é
              sempre uma zona do campo (nunca "fora do tabuleiro"), então só
              precisa da barra — nunca do modal de busca. */}
          {placeSelection && (
            <SelectionBar
              instruction={plan?.instruction ?? ""}
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
        </div>

        {/* -------- histórico, em coluna própria -------- */}
        <aside className="flex w-[var(--tf-rail-right)] shrink-0 flex-col overflow-hidden p-2">
          <DuelLog
            entries={snapshot.log}
            reveals={minhasRevelacoes}
            onOpenReveals={() => setRevelacoesAbertas(true)}
          />
        </aside>

        {/* Os modais nascem AQUI, dentro da linha central, e não na raiz da
            mesa: assim o escurecimento cobre só a coluna do campo. Os trilhos
            laterais continuam nítidos e clicáveis, que é o ponto — é com um
            modal aberto (conferindo o cemitério, escolhendo alvo) que mais se
            precisa ler o texto da carta. O fim de duelo é a exceção e segue
            cobrindo a tela toda. */}
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
            onHover={setPreview}
            onClose={() => setRevelacoesAbertas(false)}
          />
        )}

        {openPile && (
          <PileModal
            title={openPile.title}
            cards={pileShown}
            registry={registry}
            onHover={setPreview}
            onClose={() => setOpenPile(null)}
          />
        )}

        {needsPicker && selection && plan && (
          <CardPickerModal
            instruction={plan.instruction}
            selection={selection}
            picked={picked}
            registry={registry}
            onToggle={togglePick}
            onConfirm={() => respond(selection.build(picked))}
            extras={plan.global}
            onRespond={respond}
            onHover={setPreview}
          />
        )}

        {plan?.sorting && !busy && (
          <SortCardModal
            instruction={plan.instruction}
            sorting={plan.sorting}
            registry={registry}
            onRespond={(order) => respond(plan.sorting!.build(order))}
            keepLabel={plan.global[0]?.label ?? "Manter a ordem atual"}
            onKeep={() =>
              respond(plan.global[0]?.response ?? plan.sorting!.build(null))
            }
            onHover={setPreview}
          />
        )}

        {showModal && !plan?.sorting && plan?.announceCard && (
          <AnnounceCardModal
            instruction={plan.instruction}
            opcodes={plan.announceCard.opcodes}
            cards={announcePool}
            onRespond={(code) => respond(plan.announceCard!.build(code))}
            onHover={setPreview}
          />
        )}

        {showModal && !plan?.sorting && plan && !plan.announceCard && !modalEspiado && (
          <PromptModal
            plan={plan}
            onRespond={respond}
            registry={registry}
            promptCard={snapshot.promptCard}
            chain={snapshot.chain}
            picked={picked}
            onTogglePick={togglePick}
            onPeek={() => setModalEspiado(true)}
            onHover={setPreview}
          />
        )}
      </div>

      {snapshot.winner != null && (
        <ResultOverlay
          winner={snapshot.winner}
          reason={snapshot.winReason}
          me={me}
          playerName={playerName}
          opponentName={opponentName}
          ending={ending}
        />
      )}

      {snapshot.error && (
        <p className="shrink-0 border-t border-red-900/50 bg-red-950/80 px-4 py-2 text-sm text-red-200">
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
  selected: boolean;
  onClick?: () => void;
  menu: CardAction[] | null;
  onChoose: (action: CardAction) => void;
  onCloseMenu: () => void;
};

interface SharedSlotProps {
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
  slotProps: SlotPropsFn;
  /** Mesa de Master Rule 2020 (ver `isTcg` no `DuelBoard`). */
  isTcg: boolean;
  /** Zona → nomes dos Links que apontam para ela. */
  linkedBy: Map<string, string[]>;
  openMaterials: (card: BoardCard) => () => void;
  /** Marcas de uma carta, já resolvidas para quem olha. */
  marksOf: (card: BoardCard | null | undefined) => CardMark[];
  isDisabledZone: (owner: 0 | 1, location: number, sequence: number) => boolean;
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
  slotProps,
  isTcg,
  linkedBy,
  openMaterials,
  marksOf,
  isDisabledZone,
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
  const prefix = zone === "monster" ? "Mon" : "M/A";

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5">
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
            placeholder={
              pendulumZone ? `${prefix}${sequence + 1} · P` : `${prefix}${sequence + 1}`
            }
            rotated={zone === "monster" && Boolean(card?.defense)}
            upsideDown={mirrored}
            zoneKey={key}
            onHover={onHover}
            showLevel={isTcg && zone === "monster"}
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
            {...slotProps(card, { player: owner, location, sequence })}
          />
        );
      })}
      {right}
    </div>
  );
}

/**
 * Canto do cemitério com as **banidas** penduradas ao lado.
 *
 * As banidas já eram lidas do engine e listadas em `BoardPlayer`, mas não
 * tinham lugar na mesa: dava para tirar uma carta de jogo e nunca mais saber
 * quantas eram nem quais — e no Goat isso decide partida (Ninja Furtivo, Volta
 * da Dimensão Diferente, Espada da Luz, todos os "bane" do formato).
 *
 * A pilha é **posicionada fora do fluxo**, e isso é o ponto: as quatro fileiras
 * são centralizadas na mesa, então um elemento a mais numa delas empurra as
 * cinco zonas para o lado e desalinha a fileira de monstros da de magias. Fora
 * do fluxo, o canto continua com a largura de uma carta e o alinhamento das
 * quatro fileiras fica intacto — as banidas ficam como um aparte, na folga que
 * sobra na borda da mesa.
 *
 * `paraFora` diz de que lado é a folga: no campo de cima o cemitério fica na
 * borda esquerda, no de baixo na direita.
 */
function GraveCorner({
  grave,
  banished,
  paraFora = "right",
}: {
  grave: React.ReactNode;
  banished: React.ReactNode;
  paraFora?: "left" | "right";
}) {
  return (
    <div className="relative h-full shrink-0">
      {grave}
      <div
        title="Cartas fora de jogo"
        className={`absolute top-1/2 h-[62%] -translate-y-1/2 ${
          paraFora === "left" ? "right-full mr-1" : "left-full ml-1"
        }`}
      >
        {banished}
      </div>
    </div>
  );
}

/** Zona de campo — canto externo da fileira de magias, como na mesa oficial. */
function FieldSpellSlot({
  player,
  owner,
  registry,
  onHover,
  slotProps,
  marksOf,
}: Pick<SharedSlotProps, "registry" | "onHover" | "slotProps" | "marksOf"> & {
  player: BoardPlayer;
  owner: 0 | 1;
}) {
  return (
    <DuelCardSlot
      card={player.field}
      registry={registry}
      placeholder="Campo"
      upsideDown={owner === 1}
      onHover={onHover}
      marks={slotChips(marksOf(player.field))}
      {...slotProps(player.field, {
        player: owner,
        location: OcgLocation.SZONE,
        sequence: FIELD_ZONE_SEQUENCE,
      })}
    />
  );
}

function Hand({
  cards,
  seat,
  registry,
  onHover,
  slotProps,
}: Pick<SharedSlotProps, "registry" | "onHover" | "slotProps"> & {
  cards: BoardCard[];
  seat: 0 | 1;
}) {
  return (
    <div
      // Índice ABSOLUTO — ver o comentário no `dataPile` da fileira acima.
      data-hand={seat}
      className="tf-panel flex h-[15%] min-h-[104px] shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5"
    >
      {cards.length === 0 ? (
        <span className="text-[13px] text-zinc-500">Mão vazia</span>
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
 * Trilha de fases entre os campos. Cada pip que corresponde a uma transição
 * permitida pelo engine vira botão — é assim que se avança de fase, sem
 * botões soltos num canto.
 */
const PHASE_ACTION_MATCH: { short: string; test: RegExp }[] = [
  { short: "BP", test: /battle phase/i },
  { short: "M2", test: /main phase 2/i },
  { short: "EP", test: /encerrar turno/i },
];

function PhaseTrack({
  phase,
  turn,
  actions,
  disabled,
  onRespond,
  vertical = false,
}: {
  phase: number | null;
  /** Turnos já iniciados. 0 = o duelo ainda não começou. */
  turn: number;
  actions: GlobalAction[];
  disabled?: boolean;
  onRespond: (response: OcgResponse) => void;
  /**
   * Coluna em vez de trilha: no TCG a trilha mora entre as duas Zonas Extra,
   * na largura de uma carta.
   */
  vertical?: boolean;
}) {
  const actionFor = (short: string) => {
    const match = PHASE_ACTION_MATCH.find((entry) => entry.short === short);
    if (!match) return null;
    return actions.find((action) => match.test.test(action.label)) ?? null;
  };

  if (vertical) {
    return (
      <div
        // z-50 pelo mesmo motivo da trilha horizontal (ver abaixo). Grade de
        // duas colunas, lida como texto (DP SP / M1 BP / M2 EP): numa coluna
        // só, sete botões na altura de uma carta ficavam ilegíveis em telas
        // baixas.
        className={`relative z-50 grid ${CARD_SHAPE} grid-cols-2 grid-rows-4 gap-[4%] py-[4%]`}
      >
        <span
          title={`Turno ${turn}`}
          className="tf-phase-pip col-span-2 flex min-h-0 items-center justify-center rounded font-mono text-[11px] font-bold text-[color:var(--tf-gold-bright)]"
        >
          {turn > 0 ? `T${turn}` : "—"}
        </span>
        {PHASE_TRACK.map((entry) => {
          const action = actionFor(entry.short);
          const active = phase === entry.value;
          return (
            <button
              key={entry.value}
              type="button"
              disabled={!action || disabled}
              onClick={() => action && onRespond(action.response)}
              title={action ? action.label : phaseLabel(entry.value)}
              className={`min-h-0 rounded text-[11px] font-bold leading-none transition ${
                active
                  ? "tf-phase-pip tf-phase-pip-active"
                  : action
                    ? "tf-phase-pip cursor-pointer text-[color:var(--tf-gold-bright)] hover:bg-[color:var(--tf-gold)] hover:text-black"
                    : "tf-phase-pip cursor-default text-[color:var(--tf-gold-dim)]/50"
              }`}
            >
              {entry.short}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    // z-50: os avisos grandes do centro (SEU TURNO, dano) passam por cima do
    // tabuleiro em z-40 e cairiam justamente aqui. A fase atual é a informação
    // que o jogador consulta para decidir a jogada — ela nunca pode sumir.
    <div className="relative z-50 flex shrink-0 items-center justify-center gap-1 py-0.5">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[color:var(--tf-gold-dim)]" />
      {/* Contagem de turno colada na trilha de fases: as duas respondem "em que
          ponto do duelo estamos", e é o número que as cartas de contagem
          (Espada da Luz, Reckless Greed, Mensagem do Espírito) cobram. */}
      {turn > 0 && (
        <span
          title={`Turno ${turn}`}
          className="tf-phase-pip flex h-6 items-center rounded px-2 font-mono text-[12px] font-bold text-[color:var(--tf-gold-bright)]"
        >
          T{turn}
        </span>
      )}
      {PHASE_TRACK.map((entry) => {
        const action = actionFor(entry.short);
        const active = phase === entry.value;
        return (
          <button
            key={entry.value}
            type="button"
            disabled={!action || disabled}
            onClick={() => action && onRespond(action.response)}
            title={action ? action.label : phaseLabel(entry.value)}
            className={`h-6 w-14 rounded text-[12px] font-bold tracking-wide transition ${
              active
                ? "tf-phase-pip tf-phase-pip-active"
                : action
                  ? "tf-phase-pip cursor-pointer text-[color:var(--tf-gold-bright)] hover:bg-[color:var(--tf-gold)] hover:text-black"
                  : "tf-phase-pip cursor-default text-[color:var(--tf-gold-dim)]/50"
            }`}
          >
            {entry.short}
          </button>
        );
      })}
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[color:var(--tf-gold-dim)]" />
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
  onToggle,
  onConfirm,
  extras,
  onRespond,
  onHover,
}: {
  instruction: string;
  selection: NonNullable<PromptPlan["selection"]>;
  picked: number[];
  registry: CardRegistry | null;
  onToggle: (index: number) => void;
  onConfirm: () => void;
  extras: GlobalAction[];
  onRespond: (response: OcgResponse) => void;
  /** Passar o mouse num candidato manda a carta para a leitura da esquerda. */
  onHover: (card: PreviewCard | null) => void;
}) {
  const canConfirm =
    picked.length >= selection.min &&
    picked.length <= selection.max &&
    (selection.isValid?.(picked) ?? true);

  const progress = selection.progress
    ? `soma ${selection.progress(picked)}`
    : `${picked.length}/${
        selection.min === selection.max
          ? selection.min
          : `${selection.min}-${selection.max}`
      }`;

  return (
    <div className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6">
      <div className="tf-modal tf-anim-modal-in flex max-h-full w-[min(860px,95%)] flex-col overflow-hidden">
        <header className="tf-modal-head shrink-0 px-5 py-2.5">
          <p className="text-center text-base font-semibold text-[color:var(--tf-gold-bright)]">
            {instruction}
          </p>
          <p className="mt-0.5 text-center text-[11px] text-[color:var(--tf-gold-dim)]">
            {selection.candidates.some((candidate) => candidate.code === 0)
              ? "Cartas de verso são as que você ainda não pode ver — escolha e a face aparece."
              : "Apenas as cartas elegíveis são mostradas. O deck é reembaralhado depois da escolha."}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Obrigatórias (SELECT_SUM: `selects_must`) — já contam para o alvo
              sem o jogador marcar, então aparecem à parte e não são clicáveis. */}
          {selection.locked && selection.locked.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--tf-gold-dim)]">
                Já incluídas (obrigatórias)
              </p>
              <div className="flex flex-wrap gap-2">
                {selection.locked.map((candidate, index) => {
                  const definition = registry?.get(candidate.code);
                  const image = definition?.images[0]?.image_url_small;
                  return (
                    <div
                      key={`locked-${candidate.code}-${index}`}
                      onMouseEnter={() => onHover({ code: candidate.code })}
                      title={definition?.name}
                      className="relative w-[72px] shrink-0 overflow-hidden rounded border-2 border-emerald-400/80 brightness-90"
                    >
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt={definition?.name ?? "Carta"}
                          className="aspect-[59/86] w-full object-cover"
                        />
                      ) : (
                        <div className="tf-card-back aspect-[59/86] w-full" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
            {selection.candidates.map((candidate, index) => {
              // `code: 0` é o candidato que este assento não tem direito de ver
              // (`maskHiddenCards`) — carta na mão do adversário, virada para
              // baixo no campo dele. Escolhe-se pelo verso, e a face aparece
              // depois, quando o efeito revelar.
              const oculta = candidate.code === 0;
              const definition = oculta ? undefined : registry?.get(candidate.code);
              const image = definition?.images[0]?.image_url_small;
              const isPicked = picked.includes(index);
              return (
                <button
                  key={`${candidate.code}-${index}`}
                  type="button"
                  onClick={() => {
                    playSfx("click");
                    onToggle(index);
                  }}
                  onMouseEnter={() =>
                    onHover(oculta ? null : { code: candidate.code })
                  }
                  title={definition?.name ?? (oculta ? "Carta oculta" : undefined)}
                  className={`relative aspect-[59/86] overflow-hidden rounded border-2 transition ${
                    isPicked
                      ? "border-emerald-400 brightness-110"
                      : "border-[color:var(--tf-slot-border)] hover:border-[color:var(--tf-gold)]"
                  }`}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt={definition?.name ?? "Carta"}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : oculta ? (
                    <div className="tf-card-back h-full w-full" />
                  ) : (
                    <span className="flex h-full items-center justify-center bg-black/60 p-1 text-[9px] text-zinc-300">
                      {definition?.name ?? candidate.code}
                    </span>
                  )}

                  <span className="absolute inset-x-0 bottom-0 bg-black/80 px-1 py-0.5 text-[9px] font-semibold text-[color:var(--tf-gold-bright)]">
                    {locationLabel(candidate.location)}
                  </span>

                  {isPicked && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-black">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--tf-slot-border)] px-5 py-3">
          <span className="font-mono text-[13px] text-[color:var(--tf-gold-dim)]">
            {progress}
          </span>
          <div className="flex gap-2">
            {extras.map((action, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onRespond(action.response)}
                className="rounded border border-[color:var(--tf-slot-border)] px-4 py-2 text-[13px] text-[color:var(--tf-gold-bright)] hover:bg-black/50"
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                playSfx("click");
                onConfirm();
              }}
              className="rounded bg-[color:var(--tf-gold)] px-5 py-2 text-[13px] font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirmar
            </button>
          </div>
        </footer>
      </div>
    </div>
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
}: {
  cards: BoardCard[];
  seat: 0 | 1;
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
}) {
  const revelada = cards.some((card) => card.code !== null);

  return (
    <div
      data-hand={seat}
      className={`tf-panel flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1 ${
        revelada ? "h-[96px]" : "h-[56px]"
      }`}
    >
      <span
        className={`mr-2 text-[10px] uppercase tracking-wider ${
          revelada
            ? "text-[color:var(--tf-gold-bright)]"
            : "text-[color:var(--tf-gold-dim)]"
        }`}
      >
        Mão do oponente
        {revelada && (
          <>
            <br />
            <span className="text-[9px] tracking-normal normal-case">
              👁 revelada
            </span>
          </>
        )}
      </span>
      {cards.length === 0 ? (
        <span className="text-[12px] text-zinc-500">vazia</span>
      ) : (
        <>
          {cards.map((card) => (
            <DuelCardSlot
              key={card.sequence}
              card={card}
              registry={registry}
              inHand
              onHover={onHover}
            />
          ))}
          <span className="ml-2 font-mono text-[13px] font-bold text-[color:var(--tf-gold-bright)]">
            {cards.length}
          </span>
        </>
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
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] z-40 flex justify-center">
      <div className="tf-panel tf-anim-card-in flex flex-col items-center gap-2 rounded-lg px-5 py-3 shadow-2xl shadow-black/80">
        <span className="text-[12px] font-bold uppercase tracking-[0.15em] text-[color:var(--tf-gold)]">
          {reveal.title}
        </span>
        <div className="flex gap-2">
          {reveal.codes.map((code, index) => {
            const definition = registry?.get(code);
            const image = definition?.images[0]?.image_url_small;
            return (
              <div key={`${code}-${index}`} className="flex flex-col items-center gap-1">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={definition?.name ?? "Carta"}
                    className="h-32 w-auto rounded border border-[color:var(--tf-gold)] shadow-lg"
                  />
                ) : (
                  <div className="tf-card-back h-32 w-[88px] rounded" />
                )}
                <span className="max-w-[100px] truncate text-[10px] text-zinc-200">
                  {definition?.name ?? code}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Moeda ou dado rolando no centro da tela, com o resultado. */
function TossOverlay({
  toss,
}: {
  toss: { kind: "coin" | "dice"; results: (boolean | number)[] };
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center gap-4">
      {toss.results.map((result, index) => (
        <div
          key={index}
          style={{ animationDelay: `${index * 120}ms` }}
          // Classes estáticas: o Tailwind não enxerga nomes montados em runtime.
          className={`${toss.kind === "coin" ? "tf-coin rounded-full" : "tf-dice rounded-xl"} flex h-24 w-24 items-center justify-center border-4 border-[color:var(--tf-gold)] bg-gradient-to-br from-[color:var(--tf-gold-bright)] to-[color:var(--tf-gold-dim)] font-black text-black shadow-2xl shadow-black/70`}
        >
          <span className={toss.kind === "coin" ? "text-base" : "text-4xl"}>
            {toss.kind === "coin" ? (result ? "CARA" : "COROA") : String(result)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Avisos grandes no centro do campo — turno, dano, ataque direto. */
function FlashLayer({
  flashes,
  anchor,
}: {
  flashes: DuelFlash[];
  anchor: DuelFlash["anchor"];
}) {
  const visible = flashes.filter((flash) => flash.anchor === anchor);
  if (visible.length === 0) return null;

  // No centro o aviso é grande; junto ao LP ele fica logo abaixo da barra,
  // menor, para dizer com clareza de quem é o dano.
  const centered = anchor === "center";

  return (
    <div
      className={`pointer-events-none absolute z-40 flex justify-center ${
        // Fica no centro mesmo — é onde o olho está. Para não esconder o
        // indicador de fase, que passa exatamente ali, quem sobe de camada é
        // a trilha de fases (z-50), e não o aviso que sai de cena em 1 s.
        centered ? "inset-0 items-center" : "inset-x-0 top-full items-start pt-1"
      }`}
    >
      <div className="flex flex-col items-center gap-1">
        {visible.map((flash) => (
          <span
            key={flash.id}
            style={{ ["--tf-flash-duration" as string]: `${flash.duration}ms` }}
            className={`tf-flash-text tf-hud-text select-none font-mono font-black tracking-wider ${
              centered ? "text-5xl" : "text-3xl"
            } ${
              flash.tone === "good"
                ? "text-emerald-300"
                : flash.tone === "bad"
                  ? "text-red-400"
                  : "text-[color:var(--tf-gold-bright)]"
            }`}
          >
            {flash.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Lista o conteúdo de uma pilha (cemitério, banidas, extra) em grade. */
function PileModal({
  title,
  cards,
  registry,
  onHover,
  onClose,
}: {
  title: string;
  cards: BoardCard[];
  registry: CardRegistry | null;
  onHover: (card: BoardCard | null) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="tf-panel flex max-h-full w-[min(720px,92%)] flex-col overflow-hidden rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="tf-modal-head flex shrink-0 items-center justify-between px-4 py-2">
          <h3 className="text-base font-bold text-[color:var(--tf-gold-bright)]">
            {title}{" "}
            <span className="text-[color:var(--tf-gold-dim)]">({cards.length})</span>
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
          {cards.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-zinc-500">Vazio.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
              {cards.map((card, index) => {
                const definition = card.code ? registry?.get(card.code) : undefined;
                const image = definition?.images[0]?.image_url_small;
                return (
                  <div
                    key={`${card.sequence}-${index}`}
                    onMouseEnter={() => onHover(card)}
                    title={definition?.name}
                    className="aspect-[59/86] overflow-hidden rounded-[3px] border border-[color:var(--tf-slot-border)]"
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt={definition?.name ?? "Carta"}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="tf-card-back h-full w-full" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                          title={definition?.name}
                          className="w-[64px] shrink-0 overflow-hidden rounded-[3px] border border-[color:var(--tf-slot-border)]"
                        >
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={image}
                              alt={definition?.name ?? "Carta"}
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

  return (
    <div className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6">
      <div className="tf-modal tf-anim-modal-in flex max-h-full w-[min(520px,94%)] flex-col overflow-hidden">
        <p className="tf-modal-head shrink-0 px-5 py-2.5 text-center text-[15px] font-semibold text-[color:var(--tf-gold-bright)]">
          {plan.instruction}
        </p>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3.5">
          {announce ? (
            // ANNOUNCE_RACE / ANNOUNCE_ATTRIB: não são cartas, são valores
            // abstratos — cada botão alterna a marcação, e o core só recebe a
            // resposta quando `count` valores estiverem marcados.
            <div className="grid grid-cols-2 gap-2">
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
                    className={`rounded border px-3 py-2 text-[13px] font-semibold transition ${
                      isPicked
                        ? "border-[color:var(--tf-gold)] bg-[color:var(--tf-gold)]/20 text-[color:var(--tf-gold-bright)]"
                        : "border-[color:var(--tf-slot-border)] bg-black/40 text-zinc-200 hover:bg-black/70"
                    }`}
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
              {chain && (
                <ChainLinkPanel
                  chain={chain}
                  registry={registry}
                  onHover={onHover}
                />
              )}

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

        <div className="flex shrink-0 flex-col gap-2 border-t border-[color:var(--tf-slot-border)] p-4">
          {announce ? (
            <>
              <span className="text-center font-mono text-[12px] text-[color:var(--tf-gold-dim)]">
                {picked.length}/{announce.count} marcado(s)
              </span>
              <ModalButton
                tone="primary"
                label="Confirmar"
                disabled={picked.length !== announce.count}
                onClick={() =>
                  onRespond(
                    announce.build(picked.map((index) => announce.options[index].value)),
                  )
                }
              />
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
          )}
          <button
            type="button"
            onClick={onPeek}
            className="w-full rounded border border-[color:var(--tf-slot-border)] px-3 py-1.5 text-[12px] text-[color:var(--tf-gold-dim)] transition hover:bg-black/50 hover:text-[color:var(--tf-gold-bright)]"
          >
            👁 Ver o tabuleiro (a decisão continua esperando)
          </button>
        </div>
      </div>
    </div>
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
          alt={definition?.name ?? "Carta"}
          className="h-20 w-auto shrink-0 rounded-[3px] border border-[color:var(--tf-slot-border)]"
        />
      ) : (
        <div className="tf-card-back h-20 w-14 shrink-0 rounded-[3px]" />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-bold text-[color:var(--tf-gold-bright)]">
          {definition?.name ?? `Carta ${action.code}`}
        </span>
        <span className="text-[11px] font-semibold text-emerald-400">
          {action.label} · {locationLabel(action.location)}
        </span>
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
            alt={definition?.name ?? "Carta"}
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
    <div className="pointer-events-none absolute inset-x-0 bottom-[19%] z-40 flex justify-center">
      <div className="tf-panel pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 shadow-xl shadow-black/60">
        <span className="text-[13px] text-zinc-100">
          {chain ? "⛓ " : ""}
          {instruction}
        </span>
        {definition && (
          <span className="text-[12px] font-semibold text-[color:var(--tf-gold-bright)]">
            {texto.name(definition)}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            playSfx("click");
            onBack();
          }}
          className="rounded-full bg-[color:var(--tf-gold)] px-4 py-1.5 text-[13px] font-bold text-black transition hover:brightness-110"
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
      className={`w-full rounded px-3 py-2.5 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "primary"
          ? "bg-[color:var(--tf-gold)] text-black hover:brightness-110"
          : "border border-[color:var(--tf-slot-border)] bg-black/40 text-[color:var(--tf-gold-bright)] hover:bg-black/70"
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
  onConfirm: () => void;
  extras: GlobalAction[];
  onRespond: (response: OcgResponse) => void;
}) {
  const canConfirm =
    picked.length >= selection.min &&
    picked.length <= selection.max &&
    (selection.isValid?.(picked) ?? true);

  const progress = selection.progress
    ? `soma ${selection.progress(picked)}`
    : `${picked.length}/${
        selection.min === selection.max
          ? selection.min
          : `${selection.min}-${selection.max}`
      }`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[19%] z-40 flex justify-center">
      <div className="tf-panel pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 shadow-xl shadow-black/60">
        <span className="text-[13px] text-zinc-100">{instruction}</span>
        <span className="font-mono text-[13px] text-[color:var(--tf-gold-dim)]">
          {progress}
        </span>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
          className="rounded-full bg-[color:var(--tf-gold)] px-4 py-1.5 text-[13px] font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirmar
        </button>
        {extras.map((action, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onRespond(action.response)}
            className="rounded-full border border-[color:var(--tf-slot-border)] px-4 py-1.5 text-[13px] text-[color:var(--tf-gold-bright)] hover:bg-black/50"
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
function WaitingBanner({ name }: { name: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
      <span className="tf-panel rounded-full px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--tf-gold-dim)]">
        Aguardando {name}…
      </span>
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
}: {
  winner: number;
  /** Por que o duelo acabou, quando se sabe — ver `DuelSnapshot.winReason`. */
  reason: string | null;
  me: 0 | 1;
  playerName: string;
  opponentName: string;
  ending: NonNullable<DuelBoardProps["ending"]>;
}) {
  // `winner` é o assento absoluto que o core declarou; 2 é empate.
  const text =
    winner === 2
      ? "Empate"
      : winner === me
        ? `${playerName} venceu!`
        : `${opponentName} venceu!`;

  return (
    <div className="tf-modal-scrim absolute inset-0 z-50 flex items-center justify-center">
      <div className="tf-panel rounded-lg px-10 py-6 text-center">
        <p className="text-2xl font-bold text-[color:var(--tf-gold-bright)]">{text}</p>
        {/* O motivo embaixo do nome: nos finais que não passam por dano (deck
            vazio, rendição, Exodia) a tela não dizia nada sobre o que
            aconteceu, e a barra de LP não conta essa história. */}
        {reason && (
          <p className="mt-1 text-[13px] text-[color:var(--tf-gold-dim)]">{reason}</p>
        )}

        <div className="mt-4 flex flex-col items-center gap-2">
          {ending.onBackToRoom && (
            <>
              <button
                type="button"
                onClick={ending.onBackToRoom}
                className="rounded bg-[color:var(--tf-gold)] px-4 py-2 text-sm font-bold text-black hover:brightness-110"
              >
                Voltar à sala
              </button>
              <p className="max-w-[19rem] text-[12px] leading-snug text-[color:var(--tf-gold-dim)]">
                Na sala dá para trocar de deck e ficar pronto de novo — a
                próxima partida começa quando os dois estiverem prontos.
              </p>
            </>
          )}

          <a
            href={ending.backHref}
            className={`rounded px-4 py-2 text-sm font-bold ${
              ending.onBackToRoom
                ? "text-[color:var(--tf-gold-dim)] hover:text-[color:var(--tf-gold-bright)]"
                : "bg-[color:var(--tf-gold)] text-black hover:brightness-110"
            }`}
          >
            {ending.backLabel}
          </a>
        </div>
      </div>
    </div>
  );
}

function LifeBar({
  name,
  role,
  lp,
  active,
  align = "left",
}: {
  name: string;
  role: string;
  lp: number;
  active: boolean;
  align?: "left" | "right";
}) {
  const ratio = Math.max(0, Math.min(1, lp / 8000));
  const low = ratio <= 0.25;

  // Um "bump" curto sempre que o valor muda, para o dano não passar batido.
  const [bump, setBump] = useState(false);
  const [shownLp, setShownLp] = useState(lp);
  if (shownLp !== lp) {
    setShownLp(lp);
    setBump(true);
    setTimeout(() => setBump(false), 360);
  }

  return (
    <div
      className={`tf-panel flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-1 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      } ${active ? "ring-1 ring-[color:var(--tf-gold)]/70" : ""}`}
    >
      <p
        className={`tf-hud-text shrink-0 font-mono text-2xl font-bold tabular-nums transition-colors ${
          bump ? "tf-lp-bump" : ""
        } ${low ? "text-red-300" : "text-[color:var(--tf-gold-bright)]"}`}
      >
        {lp}
      </p>

      <div className={`min-w-0 flex-1 ${align === "right" ? "text-right" : ""}`}>
        <p className="truncate text-sm font-semibold text-zinc-100">{name}</p>
        <div className="tf-lp-track mt-0.5 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              low ? "tf-lp-fill-low" : "tf-lp-fill"
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-[color:var(--tf-gold-dim)]">
        {active ? "TURNO" : role}
      </span>
    </div>
  );
}

function DuelLog({
  entries,
  reveals,
  onOpenReveals,
}: {
  entries: DuelLogEntry[];
  /** Revelações desta ótica — o botão só existe quando houve alguma. */
  reveals: DuelReveal[];
  onOpenReveals: () => void;
}) {
  return (
    // Em coluna própria, à direita: não disputa mais altura com a leitura da
    // carta, então pode usar tudo o que tem — um duelo gera muita linha e
    // rolar para trás é como se confere o que o oponente fez.
    <div className="tf-panel flex min-h-0 flex-1 flex-col rounded-md p-2">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--tf-gold)]">
          Histórico
        </h3>
        {reveals.length > 0 && (
          <button
            type="button"
            onClick={onOpenReveals}
            title="Ver as cartas que foram reveladas"
            className="rounded border border-[color:var(--tf-slot-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--tf-gold-bright)] hover:bg-black/50"
          >
            👁 {reveals.length}
          </button>
        )}
      </div>
      {/* `flex-col-reverse` com a lista invertida gruda a rolagem embaixo: a
          linha mais nova fica sempre visível sem precisar de scroll manual,
          que é justamente a linha que importa. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto pr-1 text-[11px] leading-snug text-zinc-300">
        {entries
          .slice(-60)
          .map((entry, index) => ({ entry, index }))
          .reverse()
          .map(({ entry, index }) => (
            <p key={`${index}-${entry.text}`} className="border-b border-white/5 pb-0.5">
              {entry.text}
            </p>
          ))}
      </div>
    </div>
  );
}

/** Leitura da carta em foco — o painel grande do canto esquerdo do Tag Force. */
function CardPreview({
  card,
  registry,
  marksOf,
}: {
  card: PreviewCard | null;
  registry: CardRegistry | null;
  marksOf: (card: BoardCard | null | undefined) => CardMark[];
}) {
  const texto = useCardText();
  const definition = card?.code ? registry?.get(card.code) : undefined;

  if (!definition) {
    return (
      <div className="tf-panel flex min-h-0 flex-1 items-center justify-center rounded-md p-3 text-center text-[13px] text-zinc-500">
        Passe o mouse sobre uma carta
        <br />
        para ver os detalhes
      </div>
    );
  }

  const image =
    definition.images[0]?.image_url ?? definition.images[0]?.image_url_small;
  const isMonster = definition.type.includes("Monster");
  const isLink = Boolean(definition.linkval) || Boolean(card?.link);
  const isXyz = definition.frameType.includes("xyz");
  const isPendulum = definition.frameType.includes("pendulum");

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
  const leftScale = card?.scales?.left ?? definition.scale;
  const rightScale = card?.scales?.right ?? definition.scale;
  const materials = card?.overlays ?? [];
  // Só carta EM CAMPO tem marca (a da mão ou de um modal não tem zona).
  const marks =
    card && "counters" in card && card.counters !== undefined
      ? marksOf(card as BoardCard)
      : [];

  return (
    <div className="tf-panel flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-md p-2.5">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={texto.name(definition)}
          className="mx-auto max-h-[46%] w-auto shrink-0 rounded border border-[color:var(--tf-slot-border)] object-contain"
        />
      )}

      {isMonster && (
        <div className="flex shrink-0 items-baseline justify-center gap-4 font-mono text-base font-bold">
          <span className="text-[color:var(--tf-gold-dim)]">
            ATK/{" "}
            <StatValue
              value={card?.attack ?? definition.atk ?? null}
              base={card?.baseAttack ?? definition.atk ?? null}
            />
          </span>
          {isLink ? (
            <span className="text-sky-300">LINK-{rating}</span>
          ) : (
            <span className="text-[color:var(--tf-gold-dim)]">
              DEF/{" "}
              <StatValue
                value={card?.defenseValue ?? definition.def ?? null}
                base={card?.baseDefense ?? definition.def ?? null}
              />
            </span>
          )}
        </div>
      )}

      <div className="shrink-0">
        <h4 className="text-[15px] font-bold leading-tight text-[color:var(--tf-gold-bright)]">
          {texto.name(definition)}
        </h4>
        <p className="mt-1 text-[12px] font-semibold text-emerald-400">
          {typeLine}
        </p>
        {isMonster && (
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-amber-300">
            {isLink ? (
              <span className="flex items-center gap-1.5 text-sky-300">
                <LinkArrowsGlyph markers={markers} />
                Link {rating}
              </span>
            ) : rank ? (
              <span title={`Rank ${rank}`} className="text-zinc-100">
                Rank {rank} {"☆".repeat(Math.min(rank, 13))}
              </span>
            ) : level ? (
              <span title={`Nível ${level}`}>{"★".repeat(Math.min(level, 12))}</span>
            ) : null}
            <span>{attributeLabel(definition.attribute) ?? ""}</span>
          </p>
        )}
        {isPendulum && leftScale !== undefined && (
          <p className="text-[12px] font-semibold">
            <span className="text-sky-300">Escala ◂{leftScale}</span>
            <span className="text-[color:var(--tf-gold-dim)]"> · </span>
            <span className="text-rose-300">{rightScale}▸</span>
          </p>
        )}
        {marks.length > 0 && (
          <ul data-preview-marks className="mt-1.5 space-y-0.5">
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
          <div className="mt-1.5">
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

      <p className="min-h-0 flex-1 overflow-y-auto pr-1 text-[13px] leading-relaxed text-zinc-200">
        {texto.desc(definition)}
      </p>
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
 * Avisos que valem para um jogador ("não pode Invocar-Especial neste turno"),
 * pendurados embaixo da barra de LP dele — é para lá que se olha para saber o
 * que cada um ainda pode fazer.
 */
function PlayerHints({
  hints,
  align = "left",
}: {
  hints: string[];
  align?: "left" | "right";
}) {
  if (hints.length === 0) return null;
  return (
    <div
      data-player-hints={hints.length}
      className={`pointer-events-none absolute top-full z-40 mt-0.5 flex max-w-full flex-wrap gap-1 ${
        align === "right" ? "right-0 justify-end" : "left-0"
      }`}
    >
      {hints.map((hint) => (
        <span
          key={hint}
          className="rounded bg-zinc-900/95 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 ring-1 ring-amber-400/50"
        >
          ⓘ {hint}
        </span>
      ))}
    </div>
  );
}
