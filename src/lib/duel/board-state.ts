import {
  OcgLocation,
  OcgPosition,
  OcgQueryFlags,
  type OcgCoreSync,
  type OcgDuelHandle,
} from "@n1xx1/ocgcore-wasm";

/** Uma zona do campo, sem a carta. */
export interface ZoneRef {
  controller: 0 | 1;
  location: OcgLocation;
  sequence: number;
}

/**
 * Marca que o engine anuncia por mensagem (`CARD_HINT`) e que não dá para
 * consultar depois — a sessão acompanha e entrega aqui.
 *
 * - `turn` — contagem de turnos (Espadas da Luz Reveladora: "falta 1 turno");
 * - `card`/`race`/`attribute`/`number` — o que foi DECLARADO para esta carta
 *   (Proibição, Transplante de DNA, um número de Nível);
 * - `desc` — aviso que o efeito escreve na carta enquanto vale ("não pode
 *   atacar", "efeito já usado neste turno"), já em texto.
 */
export type CardHint =
  | { kind: "turn"; value: number }
  | { kind: "card"; code: number }
  | { kind: "race"; mask: number }
  | { kind: "attribute"; mask: number }
  | { kind: "number"; value: number }
  | { kind: "desc"; text: string };

/** Uma carta como o tabuleiro precisa exibi-la. */
export interface BoardCard {
  /** Passcode, ou null quando a carta é oculta para o observador. */
  code: number | null;
  position: OcgPosition;
  /** Índice dentro da zona/localização — usado como chave e para seleção. */
  sequence: number;
  /** Dono da zona — junto com location/sequence identifica a carta no engine. */
  controller: 0 | 1;
  location: OcgLocation;
  faceDown: boolean;
  defense: boolean;
  /**
   * ATK/DEF **atuais** no duelo, já com equipamentos e efeitos aplicados, e os
   * valores impressos na carta para comparação. Ler do catálogo não serve:
   * uma Espada Mágica não mudaria nada na tela.
   */
  attack: number | null;
  defenseValue: number | null;
  baseAttack: number | null;
  baseDefense: number | null;
  /**
   * Nível **atual** (com efeitos aplicados) — 0 num Xyz ou Link, que não têm
   * nível. `null` fora do campo ou numa carta que o observador não vê.
   */
  level: number | null;
  /** Rank atual de um Xyz; 0 nos outros. */
  rank: number | null;
  /** Rating e setas de um Link (`OcgLinkMarker`); `null` nos outros. */
  link: { rating: number; markers: number } | null;
  /**
   * Escalas de Pêndulo atuais. Vêm para toda carta em campo (0/0 em quem não é
   * Pêndulo): é a tela que decide, pelo tipo da carta, se elas valem algo ali.
   */
  scales: { left: number; right: number } | null;
  /**
   * Materiais Xyz encaixados, por passcode. Informação pública: material fica
   * com a face para cima embaixo do monstro.
   */
  overlays: number[];
  /** Contadores na carta (tipo do core → quantidade). */
  counters: { type: number; count: number }[];
  /** A quem esta carta está equipada (Equipamento, Monstro União…). */
  equippedTo: ZoneRef | null;
  /** Alvos contínuos (Chamado do Assombrado → o monstro que ela trouxe). */
  targets: ZoneRef[];
  /** Os efeitos desta carta estão negados agora. */
  negated: boolean;
  /** Marcas anunciadas por mensagem — ver `CardHint`. */
  hints: CardHint[];
}

export interface BoardPlayer {
  /**
   * Zonas de monstro deste jogador, pelo índice do core: 0–4 são as principais
   * e 5–6 as **Zonas de Monstro Extra** (Master Rule 4/5). No Goat as duas
   * últimas ficam sempre vazias — a regra de 2005 não as tem.
   *
   * As Zonas Extra são compartilhadas: a zona 5 de um jogador é a zona 6 do
   * outro. Quem desenha a mesa resolve qual ocupante mostrar (ver `DuelBoard`).
   */
  monsters: (BoardCard | null)[];
  /** 5 zonas de magia/armadilha + a zona de campo. */
  spells: (BoardCard | null)[];
  field: BoardCard | null;
  hand: BoardCard[];
  /** Conteúdo das pilhas — para o jogador poder abrir e conferir. */
  grave: BoardCard[];
  banished: BoardCard[];
  /**
   * Extra Deck. O do observador vem inteiro; o do oponente só com as cartas
   * **viradas para cima** — os Pêndulos que voltaram para lá são públicos pela
   * regra, o resto do Extra Deck dele continua secreto.
   */
  extra: BoardCard[];
  /**
   * Carta do topo do cemitério, à parte da lista.
   *
   * A mesa mostra a arte da última carta que caiu — numa mesa real o cemitério
   * fica com a face para cima. Vem separada porque o modo `light` não lê a
   * lista, e sem isso a pilha virava um verso genérico durante todo o turno do
   * oponente, que é justamente quando ela mais muda.
   */
  graveTop: BoardCard | null;
  deckSize: number;
  graveSize: number;
  banishedSize: number;
  extraSize: number;
  /** Quantas cartas do Extra Deck estão viradas para cima (Pêndulos). */
  extraFaceUp: number;
}

export interface BoardState {
  players: [BoardPlayer, BoardPlayer];
}

const ZONE_FLAGS = (OcgQueryFlags.CODE |
  OcgQueryFlags.POSITION |
  OcgQueryFlags.IS_HIDDEN |
  OcgQueryFlags.IS_PUBLIC |
  OcgQueryFlags.ATTACK |
  OcgQueryFlags.DEFENSE |
  OcgQueryFlags.BASE_ATTACK |
  OcgQueryFlags.BASE_DEFENSE) as OcgQueryFlags;

/**
 * O que só faz sentido para carta em campo: nível/rank atuais, Link, escalas e
 * materiais Xyz.
 *
 * ⚠️ `OcgQueryFlags.TYPE` fica de fora de propósito: o binding (0.1.4) não sabe
 * desserializar esse campo — sozinho ele lança `eof`, e junto de outros
 * desalinha a resposta inteira (zonas trocadas, `code` indefinido). O tipo da
 * carta vem do banco oficial/catálogo, que é estático e serve à tela.
 */
const FIELD_FLAGS = (ZONE_FLAGS |
  OcgQueryFlags.LEVEL |
  OcgQueryFlags.RANK |
  OcgQueryFlags.LINK |
  OcgQueryFlags.LSCALE |
  OcgQueryFlags.RSCALE |
  OcgQueryFlags.OVERLAY_CARD |
  OcgQueryFlags.COUNTERS |
  OcgQueryFlags.EQUIP_CARD |
  OcgQueryFlags.TARGET_CARD |
  OcgQueryFlags.STATUS) as OcgQueryFlags;

/**
 * `STATUS_DISABLED` do core: os efeitos da carta estão negados agora (Skill
 * Drain, Véu de Efeito, Contínua negada). É o que o EDOPro usa para pintar a
 * carta de cinza.
 */
const STATUS_DISABLED = 0x0001;

/** Marcas por zona, que a sessão acompanha (chave `controller:location:sequence`). */
export type HintsByZone = ReadonlyMap<string, readonly CardHint[]>;

function zoneRef(raw: unknown): ZoneRef | null {
  if (!raw || typeof raw !== "object") return null;
  const zone = raw as { controller?: number; location?: number; sequence?: number };
  if (typeof zone.location !== "number" || zone.location === 0) return null;
  return {
    controller: zone.controller === 1 ? 1 : 0,
    location: zone.location as OcgLocation,
    sequence: zone.sequence ?? 0,
  };
}

/** Zonas de monstro: 5 principais + 2 Zonas Extra. */
const MONSTER_ZONE_COUNT = 7;

/** Lê um número de um campo da query, ou null quando ausente. */
function num(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  return typeof value === "number" ? value : null;
}

/** Zonas de magia/armadilha visíveis no Goat: 5 + zona de campo (índice 5). */
const SPELL_ZONE_COUNT = 5;
const FIELD_ZONE_SEQUENCE = 5;

function toBoardCard(
  raw: Record<string, unknown> | null,
  sequence: number,
  controller: 0 | 1,
  location: OcgLocation,
  /** Se o observador pode ver cartas viradas para baixo desse jogador. */
  canSeeHidden: boolean,
  /** Marcas acompanhadas pela sessão, por zona. */
  hints?: HintsByZone,
): BoardCard | null {
  if (!raw) return null;

  const code = typeof raw.code === "number" ? raw.code : null;
  if (code === null || code === 0) return null;

  const position = (typeof raw.position === "number" ? raw.position : 0) as OcgPosition;
  const faceDown = (position & OcgPosition.FACEDOWN) !== 0;
  const defense = (position & OcgPosition.DEFENSE) !== 0;

  const visible = !faceDown || canSeeHidden;
  const link = raw.link as { rating?: number; marker?: number } | undefined;
  const left = num(raw, "leftScale");
  const right = num(raw, "rightScale");
  // Na zona de Magias/Armadilhas nada é monstro (nem o Pêndulo, que ali é
  // escala, nem a União equipada) e o core responde ATK/DEF 0 para Magia e
  // Armadilha — que a mesa pintava como "0/0" em toda carta virada para cima
  // ali, Magia de Campo inclusive. Sem número do engine, a casa cai no
  // catálogo, que não tem ATK/DEF para Magia/Armadilha.
  const inSpellZone = location === OcgLocation.SZONE;

  return {
    code: visible ? code : null,
    position,
    sequence,
    controller,
    location,
    faceDown,
    defense,
    attack: inSpellZone ? null : num(raw, "attack"),
    defenseValue: inSpellZone ? null : num(raw, "defense"),
    // camelCase: é assim que o wrapper do ocgcore nomeia estes dois campos
    // (`baseAttack`/`baseDefense`). Em snake_case a leitura vinha sempre null
    // e o ATK/DEF impresso caía no catálogo, mascarando o erro.
    baseAttack: inSpellZone ? null : num(raw, "baseAttack"),
    baseDefense: inSpellZone ? null : num(raw, "baseDefense"),
    // Nada disto vaza de carta oculta: o nível ou as setas de um monstro
    // baixado já dizem que carta ele é.
    level: visible ? num(raw, "level") : null,
    rank: visible ? num(raw, "rank") : null,
    link: visible && link?.rating ? { rating: link.rating, markers: link.marker ?? 0 } : null,
    scales: visible && left !== null && right !== null ? { left, right } : null,
    overlays: visible && Array.isArray(raw.overlayCards) ? (raw.overlayCards as number[]) : [],
    // Marcas seguem a carta: carta oculta para quem olha não mostra nenhuma —
    // um contador num monstro baixado já diria que monstro ele é.
    counters: visible ? countersOf(raw.counters) : [],
    equippedTo: visible ? zoneRef(raw.equipCard) : null,
    targets:
      visible && Array.isArray(raw.targetCards)
        ? (raw.targetCards as unknown[]).map(zoneRef).filter((z): z is ZoneRef => z !== null)
        : [],
    negated: visible && !faceDown && ((num(raw, "status") ?? 0) & STATUS_DISABLED) !== 0,
    hints: visible ? [...(hints?.get(`${controller}:${location}:${sequence}`) ?? [])] : [],
  };
}

function countersOf(raw: unknown): { type: number; count: number }[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, number>)
    .map(([type, count]) => ({ type: Number(type), count: Number(count) }))
    .filter((counter) => counter.count > 0);
}

function queryZone(
  core: OcgCoreSync,
  handle: OcgDuelHandle,
  controller: 0 | 1,
  location: OcgLocation,
  flags: OcgQueryFlags = ZONE_FLAGS,
): (Record<string, unknown> | null)[] {
  try {
    return core.duelQueryLocation(handle, {
      flags,
      controller,
      location,
    }) as (Record<string, unknown> | null)[];
  } catch {
    return [];
  }
}

function readPlayer(
  core: OcgCoreSync,
  handle: OcgDuelHandle,
  controller: 0 | 1,
  /** O jogador local — só ele vê a própria mão e as próprias cartas viradas. */
  viewer: 0 | 1,
  /**
   * Quando `true`, não lê o CONTEÚDO das pilhas — só os contadores.
   * Listar cemitério/banidas/extra dos dois lados são dezenas de chamadas ao
   * WASM, e durante uma jogada em andamento ninguém está com a lista aberta.
   */
  light: boolean,
  hints?: HintsByZone,
): BoardPlayer {
  const isViewer = controller === viewer;

  const monsterRaw = queryZone(core, handle, controller, OcgLocation.MZONE, FIELD_FLAGS);
  const spellRaw = queryZone(core, handle, controller, OcgLocation.SZONE, FIELD_FLAGS);
  const handRaw = queryZone(core, handle, controller, OcgLocation.HAND);

  const monsters = Array.from({ length: MONSTER_ZONE_COUNT }, (_, index) =>
    toBoardCard(
      monsterRaw[index] ?? null,
      index,
      controller,
      OcgLocation.MZONE,
      isViewer,
      hints,
    ),
  );

  const spells = Array.from({ length: SPELL_ZONE_COUNT }, (_, index) =>
    toBoardCard(
      spellRaw[index] ?? null,
      index,
      controller,
      OcgLocation.SZONE,
      isViewer,
      hints,
    ),
  );

  const field = toBoardCard(
    spellRaw[FIELD_ZONE_SEQUENCE] ?? null,
    FIELD_ZONE_SEQUENCE,
    controller,
    OcgLocation.SZONE,
    isViewer,
    hints,
  );

  /**
   * A nossa mão é sempre visível; a do oponente só quando o CORE diz que a
   * carta é pública.
   *
   * "Pública" não é invenção da tela: o ocgcore responde `isPublic` na query
   * (`QUERY_IS_PUBLIC`) e é ele quem sabe se alguma coisa mandou a mão ficar
   * aberta — `EFFECT_PUBLIC`, que é como o Olho Mágico da Verdade funciona
   * ("enquanto esta carta estiver virada para cima, seu oponente joga com a
   * mão revelada"). Esconder a mão do oponente incondicionalmente, como se
   * fazia aqui, simplesmente apagava esse efeito da tela: o duelo respeitava
   * a carta e o jogador nunca via nada.
   *
   * O mesmo campo cobre de graça a carta que está sendo ativada DA mão (o
   * core a marca como pública enquanto ela está na corrente) e qualquer
   * outra que já esteja virada para cima ali.
   */
  const hand: BoardCard[] = [];
  handRaw.forEach((raw, index) => {
    if (!raw) return;
    const code = typeof raw.code === "number" ? raw.code : null;
    const publica = raw.isPublic === true;
    const visivel = isViewer || publica;
    hand.push({
      code: visivel ? code : null,
      position: OcgPosition.FACEDOWN_ATTACK,
      sequence: index,
      controller,
      location: OcgLocation.HAND,
      faceDown: !visivel,
      defense: false,
      // Na mão não há modificadores em jogo: os valores vêm do catálogo.
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
    });
  });

  /**
   * Lista simples de uma pilha, na ordem em que o core devolve.
   *
   * O cemitério é público e não tem carta virada; as banidas têm — Espada da
   * Luz bane da mão **virada para baixo**, e essa continua secreta para quem
   * não é o dono. Por isso a máscara de carta oculta vale aqui também, em vez
   * de um `true` fixo (o Extra Deck só é listado para o dono, ver abaixo).
   */
  function pile(location: OcgLocation): BoardCard[] {
    const cards: BoardCard[] = [];
    queryZone(core, handle, controller, location).forEach((raw, index) => {
      const card = toBoardCard(raw, index, controller, location, isViewer);
      if (card) cards.push(card);
    });
    return cards;
  }

  const graveSize = core.duelQueryCount(handle, controller, OcgLocation.GRAVE);
  const grave = light ? [] : pile(OcgLocation.GRAVE);

  /**
   * Só a carta do topo do cemitério.
   *
   * Uma consulta a UMA carta, não à pilha inteira: é o que permite manter o
   * cemitério com a face para cima mesmo no modo `light`, sem trazer de volta
   * o custo que criou o modo.
   */
  function graveTopCard(): BoardCard | null {
    if (graveSize === 0) return null;
    const sequence = graveSize - 1;
    if (!light) return grave.at(-1) ?? null;
    try {
      const raw = core.duelQuery(handle, {
        flags: ZONE_FLAGS,
        controller,
        location: OcgLocation.GRAVE,
        sequence,
        overlaySequence: 0,
      }) as Record<string, unknown> | null;
      return toBoardCard(raw, sequence, controller, OcgLocation.GRAVE, true);
    } catch {
      return null;
    }
  }

  // O Extra Deck é lido mesmo no modo leve: é uma consulta só, e é dela que
  // sai a contagem de Pêndulos virados para cima, que muda justamente no meio
  // das jogadas (Pêndulo destruído volta para lá com a face para cima).
  const extraAll = pile(OcgLocation.EXTRA);
  const extraFaceUp = extraAll.filter((card) => !card.faceDown);

  return {
    monsters,
    spells,
    field,
    hand,
    grave,
    banished: light ? [] : pile(OcgLocation.REMOVED),
    // Do oponente, só o que é público. `pile` já zera o código das viradas
    // para baixo; tirá-las da lista é o que impede a CONTAGEM e a POSIÇÃO de
    // cada uma de virar pista. (Vem até no modo leve: a consulta já foi feita.)
    extra: isViewer ? extraAll : extraFaceUp,
    graveTop: graveTopCard(),
    deckSize: core.duelQueryCount(handle, controller, OcgLocation.DECK),
    graveSize,
    banishedSize: core.duelQueryCount(handle, controller, OcgLocation.REMOVED),
    extraSize: core.duelQueryCount(handle, controller, OcgLocation.EXTRA),
    extraFaceUp: extraFaceUp.length,
  };
}

/** Lê o estado completo do tabuleiro a partir do core, na ótica do jogador 0. */
export function readBoardState(
  core: OcgCoreSync,
  handle: OcgDuelHandle,
  viewer: 0 | 1 = 0,
  /** Leitura leve: pula o conteúdo das pilhas (mantém os contadores). */
  light = false,
  /** Marcas anunciadas por mensagem, que a sessão acompanha (`CARD_HINT`). */
  hints?: HintsByZone,
): BoardState {
  return {
    players: [
      readPlayer(core, handle, 0, viewer, light, hints),
      readPlayer(core, handle, 1, viewer, light, hints),
    ],
  };
}
