/**
 * Monta o catálogo de cartas a partir da YGOPRODeck e grava em disco.
 *
 * Antes o servidor buscava o pool Goat na YGOPRODeck a cada hora, em memória.
 * Com o TCG inteiro isso não serve: são ~24 MB por idioma, e a própria
 * YGOPRODeck pede "Please download and store all data pulled from this API
 * locally". Agora a busca acontece **uma vez** (ou quando alguém pede para
 * atualizar, `npm run build:catalog -- --refresh`), e o resultado enxuto fica
 * em `.cache/catalog/catalog.json`.
 *
 * Quatro fontes, todas da YGOPRODeck:
 *
 * - `format=tcg&misc=yes` — o pool TCG em inglês (nome, texto, tipo, banlist);
 * - `format=tcg&language=pt` — o mesmo pool em português (onde houver);
 * - `format=goat` — quem pertence ao pool Goat, e a banlist de abril/2005;
 * - `type=token` — fichas, que não entram em deck mas que o duelo desenha.
 *
 * O passcode de cada carta vem do banco OFICIAL (`card-db.json`), não da
 * YGOPRODeck: ela às vezes usa uma arte alternativa como id principal (o Mago
 * Negro aparece como 46986420, uma das artes do 46986414). Deck salvo,
 * deck pré-montado e engine falam o passcode oficial, e é por ele que o
 * catálogo é indexado — com as outras artes listadas para a busca achar a
 * carta por qualquer uma delas.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  CATALOG_FIELDS,
  LINK_MARKER_BITS,
  encodeCatalogCard,
  type BanStatus,
  type CatalogCard,
  type CatalogFile,
} from "@/lib/catalog/catalog-format";
import { ocgAttributeName, ocgRaceName } from "@/lib/card-labels";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Onde o catálogo (e as respostas cruas que o geraram) ficam. */
export const CATALOG_DIR = process.env.CATALOG_DIR ?? join(REPO, ".cache/catalog");
export const CATALOG_PATH = join(CATALOG_DIR, "catalog.json");

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

const SOURCES = {
  tcgEn: `${API}?format=tcg&misc=yes`,
  tcgPt: `${API}?format=tcg&language=pt`,
  goat: `${API}?format=goat`,
  tokens: `${API}?type=token`,
} as const;

type SourceKey = keyof typeof SOURCES;

/** O que a YGOPRODeck devolve por carta — só o que o catálogo usa. */
interface RawCard {
  id: number;
  name: string;
  name_en?: string;
  type: string;
  humanReadableCardType?: string;
  frameType: string;
  desc: string;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  race?: string;
  attribute?: string;
  archetype?: string;
  linkval?: number;
  linkmarkers?: string[];
  scale?: number;
  card_images: { id: number }[];
  banlist_info?: { ban_tcg?: BanStatus; ban_goat?: BanStatus };
}

/** Linha do `card-db.json`: `[type, alias, level, ...]`. */
type CardDbRows = Record<string, number[]>;

/** Mesma janela de artes alternativas do core (`CARD_ARTWORK_VERSIONS_OFFSET`). */
const ARTWORK_OFFSET = 20;

/**
 * Baixa uma fonte, ou lê a cópia em disco.
 *
 * As requisições saem uma de cada vez e com folga entre elas: a YGOPRODeck
 * bloqueia por uma hora quem passa de 20 por segundo, e um bloqueio derrubaria
 * também as imagens.
 */
async function rawSource(key: SourceKey, refresh: boolean): Promise<RawCard[]> {
  const path = join(CATALOG_DIR, "raw", `${key}.json`);
  if (!refresh && existsSync(path)) {
    return (JSON.parse(readFileSync(path, "utf8")) as { data: RawCard[] }).data;
  }
  const response = await fetch(SOURCES[key], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`YGOPRODeck respondeu ${response.status} para ${key}`);
  }
  const body = await response.text();
  const payload = JSON.parse(body) as { data?: RawCard[]; error?: string };
  if (!payload.data) throw new Error(payload.error ?? `resposta sem dados para ${key}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return payload.data;
}

function loadCardDb(): CardDbRows {
  return JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8")) as CardDbRows;
}

/**
 * Passcode oficial de uma carta da YGOPRODeck: a arte cuja linha no banco
 * oficial NÃO é arte alternativa de outra (alias 0, ou alias distante — caso de
 * Harpie Lady 1, carta própria "tratada como" Harpie Lady). Quando a
 * YGOPRODeck só lista uma arte alternativa (o feed do Goat traz o Winged
 * Kuriboh só como 57116034), segue o alias até a original.
 */
function officialPasscode(raw: RawCard, db: CardDbRows): number | null {
  const arts = [raw.id, ...raw.card_images.map((image) => image.id)];
  let viaAlias: number | null = null;
  for (const art of arts) {
    const row = db[String(art)];
    if (!row) continue;
    const alias = row[1] ?? 0;
    if (alias === 0 || Math.abs(alias - art) >= ARTWORK_OFFSET) return art;
    viaAlias ??= db[String(alias)] ? alias : null;
  }
  return viaAlias;
}

function linkMask(markers: string[] | undefined): number | null {
  if (!markers?.length) return null;
  return markers.reduce((mask, marker) => mask | (LINK_MARKER_BITS[marker] ?? 0), 0);
}

/** Valor numérico da YGOPRODeck, ou `null` quando ela não publica. */
const numberOrNull = (value: number | null | undefined) =>
  typeof value === "number" ? value : null;

/** Monta as linhas do catálogo a partir das fontes cruas. */
export function composeCatalog(
  sources: Record<SourceKey, RawCard[]>,
  db: CardDbRows,
): CatalogCard[] {
  const portugues = new Map(sources.tcgPt.map((card) => [card.id, card]));

  const goatIds = new Set<number>();
  const goatBan = new Map<number, BanStatus>();
  for (const card of sources.goat) {
    for (const art of [card.id, ...card.card_images.map((image) => image.id)]) {
      goatIds.add(art);
      if (card.banlist_info?.ban_goat) goatBan.set(art, card.banlist_info.ban_goat);
    }
  }

  const byId = new Map<number, CatalogCard>();
  /** Toda arte já catalogada — a mesma carta pode vir em duas fontes. */
  const knownArts = new Set<number>();
  const add = (raw: RawCard) => {
    // Speed Duel: outro formato, outras regras — fora do app.
    if (raw.type === "Skill Card") return;

    const official = officialPasscode(raw, db);
    const id = official ?? raw.id;
    const listed = [raw.id, ...raw.card_images.map((image) => image.id)];
    if (byId.has(id) || listed.some((art) => knownArts.has(art))) return;

    const arts = listed.filter(
      (art, index, all) => art !== id && all.indexOf(art) === index,
    );
    knownArts.add(id);
    for (const art of arts) knownArts.add(art);
    const pt = portugues.get(raw.id);
    const isLink = raw.type.includes("Link");
    const allArts = [id, ...arts];

    byId.set(id, {
      id,
      arts,
      name: raw.name,
      // A resposta em português traz o nome traduzido em `name`; quando ele é
      // igual ao inglês, não há tradução de verdade a guardar.
      namePt: pt && pt.name !== raw.name ? pt.name : null,
      type: raw.type,
      humanType: raw.humanReadableCardType ?? null,
      frameType: raw.frameType,
      race: raw.race ?? null,
      attribute: raw.attribute ?? null,
      atk: numberOrNull(raw.atk),
      def: isLink ? null : numberOrNull(raw.def),
      level: isLink ? null : numberOrNull(raw.level),
      linkval: isLink ? numberOrNull(raw.linkval) : null,
      linkMarkers: isLink ? linkMask(raw.linkmarkers) : null,
      scale: numberOrNull(raw.scale),
      archetype: raw.archetype ?? null,
      banTcg: raw.banlist_info?.ban_tcg ?? null,
      banGoat: allArts.map((art) => goatBan.get(art)).find(Boolean) ?? null,
      goat: allArts.some((art) => goatIds.has(art)),
      playable: official !== null,
      desc: raw.desc,
      descPt: pt && pt.desc !== raw.desc ? pt.desc : null,
    });
  };

  for (const raw of sources.tcgEn) add(raw);
  // O pool Goat é TCG; o que sobrar aqui é carta que a YGOPRODeck lista com
  // outro id principal e que a indexação por arte já cobre — ou carta antiga
  // fora do filtro `format=tcg`, que continua precisando existir no Goat.
  for (const raw of sources.goat) add(raw);
  for (const raw of sources.tokens) add(raw);

  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Os `.cdb` que `npm run build:card-db` baixa — de onde sai o `ot` (TCG/OCG).
 * O `cards.cdb` e os `release-*.cdb` listados no manifesto (ver
 * `scripts/cdb-manifest.mjs`, mesma regra; repetida aqui porque este módulo
 * entra no grafo do Next e não importa script de linha de comando).
 */
function cdbPaths(): string[] {
  const cache = join(REPO, ".cache");
  const manifest = join(cache, "cdb-manifest.json");
  const names = existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, "utf8")) as { files: string[] }).files
    : ["cards.cdb"];
  return names.map((name) => join(cache, name)).filter((path) => existsSync(path));
}
const OT_TCG = 0x2;
const TYPE_TOKEN = 0x4000;

/**
 * Cartas TCG do banco oficial que a lista `format=tcg` da YGOPRODeck não traz.
 *
 * A YGOPRODeck classifica algumas cartas TCG como se não fossem (medido: 97
 * com script, entre elas Chaos Ruler, Bystial Druiswurm e Mudora — três que
 * estão até na banlist TCG). O banco oficial diz quem é TCG (`ot & 2`); o que
 * faltar é buscado na YGOPRODeck por id. Sem o `cards.cdb` em disco (máquina
 * que nunca rodou `build:card-db`), fica só a lista da YGOPRODeck.
 */
function tcgIdsMissing(listed: RawCard[], db: CardDbRows): number[] {
  const paths = cdbPaths();
  if (paths.length === 0) return [];
  const known = new Set<number>();
  for (const card of listed) {
    known.add(card.id);
    for (const image of card.card_images) known.add(image.id);
  }
  const rows: { id: number | bigint; alias: number | bigint }[] = [];
  for (const path of paths) {
    const cdb = new DatabaseSync(path, { readOnly: true });
    rows.push(
      ...(cdb
        .prepare("select id, alias from datas where (ot & ?) != 0 and (type & ?) = 0")
        .all(OT_TCG, TYPE_TOKEN) as { id: number | bigint; alias: number | bigint }[]),
    );
    cdb.close();
  }
  return [...new Map(rows.map((row) => [Number(row.id), row])).values()]
    .map((row) => ({ id: Number(row.id), alias: Number(row.alias) }))
    .filter(({ id, alias }) => {
      if (known.has(id) || !db[String(id)]) return false;
      // Arte alternativa de carta já listada: a indexação por arte cobre.
      return !(alias && Math.abs(alias - id) < ARTWORK_OFFSET && known.has(alias));
    })
    .map(({ id }) => id);
}

/** Busca cartas por id (em lotes), em inglês e em português. */
async function rawByIds(
  ids: number[],
  refresh: boolean,
): Promise<{ en: RawCard[]; pt: RawCard[] }> {
  const path = join(CATALOG_DIR, "raw", "tcgExtra.json");
  if (!refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as { ids: number[]; en: RawCard[]; pt: RawCard[] };
    if (cached.ids.join() === ids.join()) return cached;
  }
  const en: RawCard[] = [];
  const pt: RawCard[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const lote = ids.slice(start, start + 50).join(",");
    for (const [lista, extra] of [
      [en, "&misc=yes"],
      [pt, "&language=pt"],
    ] as const) {
      const response = await fetch(`${API}?id=${lote}${extra}`, { cache: "no-store" });
      // 400 = nenhum daqueles ids existe NAQUELE idioma; não é falha.
      if (response.ok) {
        const payload = (await response.json()) as { data?: RawCard[] };
        lista.push(...(payload.data ?? []));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ids, en, pt }));
  return { en, pt };
}

/**
 * Baixa (se preciso), monta e grava o catálogo.
 *
 * @param refresh baixa as fontes de novo mesmo havendo cópia em disco.
 */
/**
 * Fichas que o engine pode criar e o catálogo não tem.
 *
 * A lista de fichas da YGOPRODeck (`type=token`) tem ~110 das ~240 que existem
 * no banco oficial. Ficha fora do catálogo entrava na mesa sem definição
 * nenhuma: imagem quebrada e o nome "Carta". Aqui elas vêm do próprio `.cdb`
 * (nome, texto, ATK/DEF, Nível, Tipo, Atributo). A imagem é a do passcode,
 * como em qualquer carta; quando a YGOPRODeck não tem arte para ela (~30
 * fichas modernas), a rota de imagem desenha uma face genérica
 * (`card-images.ts`).
 */
function tokensFromCdb(): CatalogCard[] {
  const fichas = new Map<number, CatalogCard>();
  for (const path of cdbPaths()) {
    const cdb = new DatabaseSync(path, { readOnly: true });
    const rows = cdb
      .prepare(
        "select d.id, d.atk, d.def, d.level, d.race, d.attribute, t.name, t.desc " +
          "from datas d join texts t on t.id = d.id where (d.type & ?) != 0",
      )
      .all(TYPE_TOKEN) as {
      id: number | bigint;
      atk: number | bigint;
      def: number | bigint;
      level: number | bigint;
      race: number | bigint;
      attribute: number | bigint;
      name: string;
      desc: string;
    }[];
    cdb.close();
    for (const row of rows) {
      const id = Number(row.id);
      // O primeiro arquivo (cards.cdb) vence num id repetido.
      if (fichas.has(id)) continue;
      fichas.set(id, {
        id,
        arts: [],
        name: row.name,
        namePt: null,
        type: "Token",
        humanType: "Token",
        frameType: "token",
        race: ocgRaceName(Number(row.race)),
        attribute: ocgAttributeName(Number(row.attribute)),
        atk: Number(row.atk),
        def: Number(row.def),
        // Os bytes altos do `level` guardam escalas de Pêndulo (ver build-card-db).
        level: Number(row.level) & 0xff,
        linkval: null,
        linkMarkers: null,
        scale: null,
        archetype: null,
        banTcg: null,
        banGoat: null,
        goat: false,
        playable: true,
        desc: row.desc,
        descPt: null,
      });
    }
  }
  return [...fichas.values()];
}

export async function buildCatalog({ refresh = false } = {}): Promise<CatalogFile> {
  const sources = {} as Record<SourceKey, RawCard[]>;
  for (const key of Object.keys(SOURCES) as SourceKey[]) {
    sources[key] = await rawSource(key, refresh);
  }

  const db = loadCardDb();
  const faltando = tcgIdsMissing(sources.tcgEn, db);
  if (faltando.length > 0) {
    const extra = await rawByIds(faltando, refresh);
    sources.tcgEn = [...sources.tcgEn, ...extra.en];
    sources.tcgPt = [...sources.tcgPt, ...extra.pt];
  }
  const composed = composeCatalog(sources, db);
  // Por arte também: a YGOPRODeck às vezes lista a ficha por uma arte
  // alternativa, e a do banco oficial seria a mesma ficha duas vezes.
  const conhecidas = new Set(composed.flatMap((card) => [card.id, ...card.arts]));
  const cards = [
    ...composed,
    ...tokensFromCdb().filter((token) => !conhecidas.has(token.id) && db[String(token.id)]),
  ].sort((a, b) => a.id - b.id);
  const rows = cards.map(encodeCatalogCard);
  const body = JSON.stringify(rows);
  const file: CatalogFile = {
    version: createHash("sha1").update(body).digest("hex").slice(0, 16),
    builtAt: new Date().toISOString(),
    fields: CATALOG_FIELDS,
    cards: rows,
  };

  mkdirSync(CATALOG_DIR, { recursive: true });
  writeFileSync(CATALOG_PATH, JSON.stringify(file));
  return file;
}
