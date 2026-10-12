import {
  OcgLocation,
  OcgPosition,
  OcgQueryFlags,
  type OcgCoreSync,
  type OcgDuelHandle,
} from "@n1xx1/ocgcore-wasm";

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
}

export interface BoardPlayer {
  /** 5 zonas de monstro (Goat não usa as extra monster zones). */
  monsters: (BoardCard | null)[];
  /** 5 zonas de magia/armadilha + a zona de campo. */
  spells: (BoardCard | null)[];
  field: BoardCard | null;
  hand: BoardCard[];
  /** Conteúdo das pilhas — para o jogador poder abrir e conferir. */
  grave: BoardCard[];
  banished: BoardCard[];
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
): BoardCard | null {
  if (!raw) return null;

  const code = typeof raw.code === "number" ? raw.code : null;
  if (code === null || code === 0) return null;

  const position = (typeof raw.position === "number" ? raw.position : 0) as OcgPosition;
  const faceDown = (position & OcgPosition.FACEDOWN) !== 0;
  const defense = (position & OcgPosition.DEFENSE) !== 0;

  return {
    code: faceDown && !canSeeHidden ? null : code,
    position,
    sequence,
    controller,
    location,
    faceDown,
    defense,
    attack: num(raw, "attack"),
    defenseValue: num(raw, "defense"),
    // camelCase: é assim que o wrapper do ocgcore nomeia estes dois campos
    // (`baseAttack`/`baseDefense`). Em snake_case a leitura vinha sempre null
    // e o ATK/DEF impresso caía no catálogo, mascarando o erro.
    baseAttack: num(raw, "baseAttack"),
    baseDefense: num(raw, "baseDefense"),
  };
}

function queryZone(
  core: OcgCoreSync,
  handle: OcgDuelHandle,
  controller: 0 | 1,
  location: OcgLocation,
): (Record<string, unknown> | null)[] {
  try {
    return core.duelQueryLocation(handle, {
      flags: ZONE_FLAGS,
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
): BoardPlayer {
  const isViewer = controller === viewer;

  const monsterRaw = queryZone(core, handle, controller, OcgLocation.MZONE);
  const spellRaw = queryZone(core, handle, controller, OcgLocation.SZONE);
  const handRaw = queryZone(core, handle, controller, OcgLocation.HAND);

  const monsters = Array.from({ length: 5 }, (_, index) =>
    toBoardCard(
      monsterRaw[index] ?? null,
      index,
      controller,
      OcgLocation.MZONE,
      isViewer,
    ),
  );

  const spells = Array.from({ length: SPELL_ZONE_COUNT }, (_, index) =>
    toBoardCard(
      spellRaw[index] ?? null,
      index,
      controller,
      OcgLocation.SZONE,
      isViewer,
    ),
  );

  const field = toBoardCard(
    spellRaw[FIELD_ZONE_SEQUENCE] ?? null,
    FIELD_ZONE_SEQUENCE,
    controller,
    OcgLocation.SZONE,
    isViewer,
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

  return {
    monsters,
    spells,
    field,
    hand,
    grave,
    banished: light ? [] : pile(OcgLocation.REMOVED),
    extra: light || !isViewer ? [] : pile(OcgLocation.EXTRA),
    graveTop: graveTopCard(),
    deckSize: core.duelQueryCount(handle, controller, OcgLocation.DECK),
    graveSize,
    banishedSize: core.duelQueryCount(handle, controller, OcgLocation.REMOVED),
    extraSize: core.duelQueryCount(handle, controller, OcgLocation.EXTRA),
  };
}

/** Lê o estado completo do tabuleiro a partir do core, na ótica do jogador 0. */
export function readBoardState(
  core: OcgCoreSync,
  handle: OcgDuelHandle,
  viewer: 0 | 1 = 0,
  /** Leitura leve: pula o conteúdo das pilhas (mantém os contadores). */
  light = false,
): BoardState {
  return {
    players: [
      readPlayer(core, handle, 0, viewer, light),
      readPlayer(core, handle, 1, viewer, light),
    ],
  };
}
