/**
 * Monta `src/data/preset-decks-tcg.json` — os decks pré-montados do TCG
 * (Structure, Starter, Legendary, Egyptian God, sets de 2 jogadores e as
 * caixas especiais), com a quantidade certa de cada carta.
 *
 * Por que a Yugipedia: a API de sets da YGOPRODeck diz QUAIS cartas um produto
 * tem (pelo set code, `SDWD-EN017`), mas não QUANTAS cópias de cada nem a qual
 * dos 3 decks de uma caixa Legendary cada uma pertence. A Yugipedia guarda a
 * lista de cada produto como texto (`{{Set list}}`, uma carta por linha), com a
 * quantidade. O set code continua sendo a ponte até a carta: ele é resolvido
 * pelo `card_sets` da YGOPRODeck que o catálogo já baixou.
 *
 * Educação com a fonte:
 * - as páginas ficam em `.cache/yugipedia/` e só o que falta é baixado (em
 *   lotes de 50 títulos por requisição, ~1,2 s entre elas — o build inteiro
 *   são ~10 requisições na primeira vez e zero depois);
 * - o User-Agent diz o que somos;
 * - o texto da Yugipedia é CC BY-SA 4.0: a origem vai em cada deck
 *   (`sourceUrl`) e no seletor.
 *
 * Validação (o build falha se algum deck incluído não passar):
 * - Main 40–60 e Extra ≤ 15;
 * - toda carta existe no catálogo, tem dados oficiais e tem script (ou é
 *   Normal, que não precisa);
 * - a conta fecha com o tamanho do produto na Yugipedia: as cartas dos
 *   decks não passam dele, e todas as linhas da lista (com brindes e
 *   fichas) não ficam abaixo.
 *
 * Um deck com carta lançada depois do snapshot dos dados oficiais (sem linha
 * no `card-db.json`) não entra: ele não jogaria. O relatório diz quais ficaram
 * de fora e por quê.
 *
 * Uso:
 *   npm run build:presets               # usa o cache; baixa só o que falta
 *   npm run build:presets -- --refresh  # baixa tudo de novo
 *   npm run build:presets -- --verbose  # mostra cada resolução por nome
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeCatalogRow } from "@/lib/catalog/catalog-format";
import { CardRegistry } from "@/lib/domain/card-registry";
import { isExtraDeckCard } from "@/lib/domain/deck-rules";

const REPO = join(import.meta.dirname, "..");
const CACHE = join(REPO, ".cache/yugipedia/pages");
const RAW = join(REPO, ".cache/catalog/raw");
const OUT = join(REPO, "src/data/preset-decks-tcg.json");

const API = "https://yugipedia.com/api.php";
const WIKI = "https://yugipedia.com/wiki/";
const UA = "yugioh-goat-preset-builder/1.0 (projeto pessoal; listas de decks pré-montados)";
const INTERVALO_MS = 1200;

const refresh = process.argv.includes("--refresh");
const verbose = process.argv.includes("--verbose");

/* ------------------------------------------------------------------ */
/* Produtos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fora da galeria de Structure/Starter Decks: as caixas com vários decks e as
 * edições especiais que são um deck jogável inteiro. Lista fechada de
 * propósito — a categoria "Preconstructed Decks" mistura caixas de Speed
 * Duel (outro jogo), produtos só do OCG e itens que não são deck.
 */
const OUTROS_PRODUTOS = [
  { title: "Yugi's Legendary Decks", kind: "legendary" },
  { title: "Legendary Decks II", kind: "legendary" },
  { title: "Legendary Dragon Decks", kind: "legendary" },
  { title: "Legendary Hero Decks", kind: "legendary" },
  { title: "Legendary 5D's Decks", kind: "legendary" },
  { title: "Legendary Arc-V Decks", kind: "legendary" },
  { title: "Legendary Modern Decks 2026", kind: "legendary" },
  { title: "THE CHRONICLES DECK: The Fallen & The Virtuous (All-Foil Edition)", kind: "box" },
  { title: "THE CHRONICLES DECK: Spirit Charmers (All-Foil Edition)", kind: "box" },
  { title: "Noble Knights of the Round Table Box Set", kind: "box" },
];

/**
 * Produtos da galeria que NÃO entram. O "2-Player Starter Deck: Yuya &
 * Declan" (lista só europeia, 21 cartas por deck) é a versão reduzida dos
 * mesmos dois decks que o Saber Force e o Dark Legion trazem completos (41) —
 * ficam esses dois.
 */
const PULAR = new Set(["2-Player Starter Deck: Yuya & Declan"]);

/**
 * Cartas que a lista põe dentro de um deck, mas que são brinde da caixa.
 *
 * LDK2: os três Deuses Egípcios (LDK2-ENS01–03) aparecem na seção do Yugi,
 * mas a página do produto descreve o deck do Yugi com 40 cartas — os Deuses
 * vêm à parte, um de cada, para qualquer um dos três.
 */
const REMOVER = new Map([
  ["LDK2", { codes: ["LDK2-ENS01", "LDK2-ENS02", "LDK2-ENS03"], motivo: "Deuses Egípcios são brinde da caixa" }],
]);

const ORDEM_KIND = ["starter", "structure", "egyptian-god", "two-player", "legendary", "box"];

/* ------------------------------------------------------------------ */
/* Yugipedia: cache + API                                              */
/* ------------------------------------------------------------------ */

const arquivoDe = (title) => join(CACHE, `${title.replace(/[/:]/g, "_")}.wiki`);
const ausenteDe = (title) => join(CACHE, `${title.replace(/[/:]/g, "_")}.missing`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let requisicoes = 0;
let ultima = 0;

/**
 * Wikitexto de cada título — do cache, ou baixado em lotes de 50.
 *
 * @returns Map título → wikitexto (`null` se a página não existe).
 */
async function paginas(titles) {
  const out = new Map();
  const faltando = [];
  for (const title of titles) {
    if (!refresh && existsSync(arquivoDe(title))) out.set(title, readFileSync(arquivoDe(title), "utf8"));
    else if (!refresh && existsSync(ausenteDe(title))) out.set(title, null);
    else faltando.push(title);
  }
  mkdirSync(CACHE, { recursive: true });
  for (let i = 0; i < faltando.length; i += 50) {
    const lote = faltando.slice(i, i + 50);
    const espera = ultima + INTERVALO_MS - Date.now();
    if (espera > 0) await sleep(espera);
    const params = new URLSearchParams({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      format: "json",
      formatversion: "2",
      redirects: "1",
      titles: lote.join("|"),
    });
    const response = await fetch(`${API}?${params}`, { headers: { "User-Agent": UA } });
    ultima = Date.now();
    requisicoes += 1;
    if (!response.ok) throw new Error(`Yugipedia respondeu ${response.status}`);
    const { query } = await response.json();
    // O título que volta pode não ser o pedido: a API normaliza ("_" → " ")
    // e segue redirecionamentos. Volta-se o caminho até o título pedido.
    const origem = new Map(lote.map((title) => [title, title]));
    for (const step of [...(query.normalized ?? []), ...(query.redirects ?? [])]) {
      if (origem.has(step.from)) origem.set(step.to, origem.get(step.from));
    }
    for (const page of query.pages ?? []) {
      const pedido = origem.get(page.title) ?? page.title;
      const content = page.revisions?.[0]?.content ?? null;
      if (content === null) writeFileSync(ausenteDe(pedido), "");
      else writeFileSync(arquivoDe(pedido), content);
      out.set(pedido, content);
    }
    for (const title of lote) if (!out.has(title)) out.set(title, null);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Wikitexto                                                           */
/* ------------------------------------------------------------------ */

const slugify = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function maisFrequente(valores) {
  const contagem = new Map();
  for (const valor of valores) contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
  return [...contagem].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
}

const semComentarios = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

/** Os títulos linkados na galeria logo abaixo de um cabeçalho. */
function galeria(wikitext, heading) {
  const text = semComentarios(wikitext);
  const start = text.search(new RegExp(`^==\\s*${heading}\\s*==\\s*$`, "m"));
  if (start < 0) throw new Error(`galeria "${heading}" não encontrada`);
  const end = text.indexOf("</gallery>", start);
  return [...text.slice(start, end).matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

/** Um campo de `{{Infobox set}}` (`| na_release_date = …`). */
function campo(wikitext, key) {
  const match = new RegExp(`^\\|\\s*${key}\\s*=\\s*(.*)$`, "m").exec(semComentarios(wikitext));
  return match ? match[1].trim() : "";
}

/** Regiões com lista, na ordem de preferência: EN, depois NA, depois EU. */
function regiaoDaLista(wikitext) {
  const lists = /\|\s*lists\s*=\s*([^\n|}]*)/.exec(semComentarios(wikitext))?.[1] ?? "";
  const regioes = lists.split(",").map((s) => s.trim());
  return ["EN", "NA", "EU"].find((r) => regioes.includes(r)) ?? null;
}

/**
 * Os blocos `{{Set list}}` de uma página de lista.
 *
 * Cada linha é `código; nome; raridades; impressão; quantidade // opções`, mas
 * as colunas andam conforme o cabeçalho: a de impressão só existe se o
 * cabeçalho declara `print=`, e a de quantidade só se declara `qty=`. Sem
 * `qty=`, cada linha é UMA cópia — três cópias aparecem como três linhas
 * (iguais ou com set codes diferentes). Por isso nada aqui deduplica por
 * código: o SDWD lista o Blue-Eyes como EN001, EN002 e EN003.
 */
function blocosDaLista(wikitext) {
  const text = semComentarios(wikitext);
  const blocos = [];
  const re = /\{\{\s*Set list\s*\|/gi;
  let m;
  while ((m = re.exec(text))) {
    const antes = text.slice(0, m.index);
    const headings = [...antes.matchAll(/^(=+)\s*(.+?)\s*\1\s*$/gm)];
    const section = headings.length ? headings.at(-1)[2] : null;
    const nl = text.indexOf("\n", m.index);
    const header = text.slice(m.index + m[0].length, nl);
    const end = text.indexOf("\n}}", nl);
    const params = {};
    for (const part of header.split("|")) {
      const i = part.indexOf("=");
      if (i > 0) params[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    const temPrint = "print" in params;
    const temQty = "qty" in params;
    const semCodigo = (params.options ?? "").split(";").map((s) => s.trim()).includes("noabbr");
    const linhas = [];
    for (let line of text.slice(nl + 1, end).split("\n")) {
      if (!line.trim()) continue;
      const opts = line.indexOf("//");
      if (opts >= 0) line = line.slice(0, opts);
      const f = line.split(";").map((s) => s.trim());
      let i = 0;
      const code = semCodigo ? "" : (f[i++] ?? "");
      const name = f[i++] ?? "";
      i++; // raridades
      if (temPrint) i++;
      const qtyField = temQty ? (f[i] ?? "") : "";
      const qty = qtyField !== "" ? Number(qtyField) : temQty && params.qty ? Number(params.qty) : 1;
      linhas.push({ code: code.toUpperCase(), name, qty: Number.isFinite(qty) ? qty : 1 });
    }
    blocos.push({ section, linhas });
  }
  return blocos;
}

/**
 * Um produto → seus decks.
 *
 * O que é deck numa página de lista: os blocos sob um cabeçalho "… Deck"
 * ("Preconstructed Deck", "Yugi Deck") ou, quando a página não tem nenhum,
 * os blocos sem cabeçalho. O resto — "Bonus cards", "Promotional cards",
 * "Tokens", "Variant art cards" — é brinde: repete códigos dos decks (o SDCH
 * lista os quatro Familiar-Possessed de novo, com arte variante, e a caixa
 * traz só um deles) e contaria cópias que o deck não tem.
 *
 * Caixas Legendary e sets de 2 jogadores têm uma seção "X Deck" por deck; o
 * resto é um deck só, mesmo quando a lista vem em vários blocos.
 */
function decksDoProduto(blocos) {
  const deDeck = blocos.filter((b) => b.section && /\bDeck$/i.test(b.section));
  const base = deDeck.length ? deDeck : blocos.filter((b) => !b.section);
  const nomeadas = [
    ...new Set(base.map((b) => b.section).filter((s) => s && !/^Preconstructed Deck$/i.test(s))),
  ];
  if (nomeadas.length >= 2) {
    return nomeadas.map((section) => ({
      section,
      linhas: base.filter((b) => b.section === section).flatMap((b) => b.linhas),
    }));
  }
  return [{ section: null, linhas: base.flatMap((b) => b.linhas) }];
}

/* ------------------------------------------------------------------ */
/* Set code → carta                                                    */
/* ------------------------------------------------------------------ */

const cartasYgopro = [
  ...JSON.parse(readFileSync(join(RAW, "tcgEn.json"), "utf8")).data,
  // As ~100 cartas que a YGOPRODeck não marca como TCG (ver catalog-build):
  // algumas só existem aqui (Angel O1, do EGO1).
  ...(existsSync(join(RAW, "tcgExtra.json"))
    ? JSON.parse(readFileSync(join(RAW, "tcgExtra.json"), "utf8")).en
    : []),
];
const porCodigo = new Map();
const porNome = new Map();
for (const card of cartasYgopro) {
  porNome.set(card.name.toLowerCase(), card);
  for (const set of card.card_sets ?? []) {
    const code = set.set_code.toUpperCase();
    const lista = porCodigo.get(code) ?? [];
    if (!lista.some((c) => c.id === card.id)) lista.push(card);
    porCodigo.set(code, lista);
  }
}

/** "Dark Magician (original)" → "dark magician"; `{{=}}` é o "=" escapado. */
const limparNome = (name) =>
  name.replace(/\{\{=\}\}/g, "=").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();

/**
 * A carta de uma linha: pelo set code; sem ele (a YGOPRODeck não conhece
 * todos os códigos — YGLD-ENA03, SR14-EN023…), pelo nome.
 */
function cartaDaLinha(linha) {
  const hits = porCodigo.get(linha.code) ?? [];
  if (hits.length === 1) return { card: hits[0], via: "código" };
  if (hits.length > 1) {
    const exato = hits.find((c) => c.name.toLowerCase() === limparNome(linha.name));
    if (exato) return { card: exato, via: "código+nome" };
  }
  const card = porNome.get(limparNome(linha.name)) ?? porNome.get(linha.name.toLowerCase());
  return card ? { card, via: "nome" } : { card: null, via: null };
}

/* ------------------------------------------------------------------ */
/* Catálogo e scripts                                                  */
/* ------------------------------------------------------------------ */

const catalogo = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
const registry = CardRegistry.fromCatalog(catalogo);

/**
 * Arte → passcode original. O deck guarda sempre a arte original: é a que tem
 * linha própria nos dados oficiais e script com o próprio número. A YGOPRODeck
 * às vezes lista a carta pela arte alternativa (o Monster Reborn vem como
 * 83764719), e o `registry.get` devolveria aquela arte.
 */
const original = new Map();
for (const row of catalogo.cards) {
  const card = decodeCatalogRow(row);
  original.set(card.id, card.id);
  for (const art of card.arts) if (!original.has(art)) original.set(art, card.id);
}

const scripts = new Set();
// Os mesmos lugares onde o app procura (`script-source.ts`).
for (const dir of ["official", "", "pre-errata"]) {
  const path = join(REPO, ".cache/CardScripts", dir);
  if (!existsSync(path)) continue;
  for (const file of readdirSync(path)) {
    const match = /^c(\d+)\.lua$/.exec(file);
    if (match) scripts.add(Number(match[1]));
  }
}
if (scripts.size === 0) throw new Error("sem CardScripts em .cache/ — rode `npm run fixtures`");

/** Monstro Normal sem efeito nenhum não tem (nem precisa de) script. */
const semScriptOk = (def) => /Normal/.test(def.type) && !/Pendulum/.test(def.type);

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

const visao = await paginas(["Structure Deck", "Starter Deck"]);
const produtos = [
  ...galeria(visao.get("Structure Deck"), "TCG Structure Decks").map((title) => ({ title, kind: "structure" })),
  ...galeria(visao.get("Starter Deck"), "TCG Starter Decks").map((title) => ({
    title,
    kind: title.startsWith("Egyptian God Deck")
      ? "egyptian-god"
      : title === "2-Player Starter Set"
        ? "two-player"
        : "starter",
  })),
  ...OUTROS_PRODUTOS,
].filter((p) => !PULAR.has(p.title));

const infos = await paginas(produtos.map((p) => p.title));
for (const produto of produtos) {
  const wikitext = infos.get(produto.title);
  if (!wikitext) throw new Error(`página do produto não existe: ${produto.title}`);
  // Só para mensagens e para `REMOVER`; o set code de cada deck sai das linhas.
  produto.prefix =
    campo(wikitext, "prefix") || campo(wikitext, "en_prefix") || campo(wikitext, "na_prefix") ||
    campo(wikitext, "tcg_prefix") || produto.title;
  produto.size = Number(/\d+/.exec(campo(wikitext, "size"))?.[0] ?? NaN);
  produto.namePt = campo(wikitext, "pt_name").replace(/''/g, "") || null;
  const data = campo(wikitext, "na_release_date") || campo(wikitext, "en_release_date") || campo(wikitext, "eu_release_date");
  produto.year = /\b(19|20)\d{2}\b/.exec(data)?.[0] ?? "?";
  produto.region = regiaoDaLista(wikitext);
  produto.listTitle = produto.region
    ? `Set Card Lists:${produto.title.replace(/ \(TCG\)$/, "")} (TCG-${produto.region})`
    : null;
}

const listas = await paginas(produtos.map((p) => p.listTitle).filter(Boolean));

const decks = [];
const rejeitados = [];
const avisos = [];
const porNomeUsado = [];

for (const produto of produtos) {
  const wikitext = produto.listTitle ? listas.get(produto.listTitle) : null;
  if (!wikitext) {
    rejeitados.push(`${produto.title}: sem lista em inglês`);
    continue;
  }
  const blocos = blocosDaLista(wikitext);
  const remover = REMOVER.get(produto.prefix);

  const totalLinhas = blocos.flatMap((b) => b.linhas).reduce((n, l) => n + l.qty, 0);

  const doProduto = decksDoProduto(blocos);
  let cartasNosDecks = 0;
  for (const { section, linhas } of doProduto) {
    const main = [];
    const extra = [];
    const problemas = [];
    for (const linha of linhas) {
      if (!linha.code) continue; // tapete, guia: item sem código
      if (remover?.codes.includes(linha.code)) continue;
      const { card, via } = cartaDaLinha(linha);
      // Sem carta nem por código nem por nome: item que não é de jogo
      // ("Everyone's King", do SDCK) ou ficha sem cadastro.
      if (!card) {
        if (verbose) console.log(`  · ${produto.prefix} ${linha.code} "${linha.name}": não é carta de jogo`);
        continue;
      }
      if (/Token/.test(card.type)) continue;
      if (via === "nome") porNomeUsado.push(`${linha.code} "${linha.name}" → ${card.id} ${card.name}`);
      const passcode = [card.id, ...card.card_images.map((image) => image.id)]
        .map((art) => original.get(art))
        .find(Boolean);
      const def = passcode ? registry.get(passcode) : undefined;
      if (!def) {
        problemas.push(`${linha.code} ${card.name}: fora do catálogo`);
        continue;
      }
      if (def.playable === false) problemas.push(`${linha.code} ${def.name}: sem dados oficiais (lançamento recente)`);
      else if (!scripts.has(def.passcode) && !semScriptOk(def)) problemas.push(`${linha.code} ${def.name}: sem script`);
      cartasNosDecks += linha.qty;
      const destino = isExtraDeckCard(def) ? extra : main;
      for (let i = 0; i < linha.qty; i++) destino.push(def.passcode);
    }

    const rotulo = section ? section.replace(/\s+Deck$/i, "") : null;
    // "Structure Deck: Marik (TCG)": o "(TCG)" só desambigua a página.
    const titulo = produto.title.replace(/ \(TCG\)$/, "");
    const name = rotulo ? `${titulo} — ${rotulo}` : titulo;
    if (main.length < 40 || main.length > 60) problemas.push(`Main com ${main.length}`);
    if (extra.length > 15) problemas.push(`Extra com ${extra.length}`);
    if (problemas.length) {
      rejeitados.push(`${produto.prefix} ${name}: ${[...new Set(problemas)].join("; ")}`);
      continue;
    }

    // O set code sai das próprias linhas, não do infobox: os Starters de
    // 2002–03 só têm `na_prefix`, o 2-Player Starter Set tem dois (STAS e
    // STAX, um por deck) e o Soulburner só `tcg_prefix`.
    const setCode = maisFrequente(linhas.map((l) => l.code.split("-")[0]).filter(Boolean));
    decks.push({
      id: `tcg-${slugify(setCode)}${rotulo ? `-${slugify(rotulo)}` : ""}`,
      name,
      namePt: rotulo ? `${produto.namePt ?? titulo} — ${rotulo}` : (produto.namePt ?? titulo),
      kind: produto.kind,
      year: produto.year,
      sourceUrl: WIKI + encodeURIComponent(produto.listTitle.replace(/ /g, "_")).replace(/%3A/g, ":"),
      product: produto.title,
      setCode,
      main,
      extra,
      side: [],
      format: "tcg",
    });
  }

  // A conta do produto contra o `size` da página — a guarda contra ler a
  // coluna errada. Não dá para exigir igualdade: a lista mostra TODOS os
  // brindes possíveis ("1 de 6 cartas bônus") e fichas, e a caixa traz um.
  // Mas as cartas dos decks não podem passar do tamanho do produto (leu
  // cópia demais) e todas as linhas juntas não podem ficar abaixo dele (leu
  // cópia de menos — a quantidade caiu numa coluna que não era a dela).
  // Conta só o que foi resolvido como carta; deck rejeitado conta igual.
  if (cartasNosDecks > produto.size || totalLinhas < produto.size) {
    avisos.push(
      `${produto.prefix} ${produto.title}: decks ${cartasNosDecks}, linhas ${totalLinhas}, produto ${produto.size}`,
    );
  } else if (verbose && totalLinhas !== produto.size) {
    console.log(`  · ${produto.prefix}: decks ${cartasNosDecks} ≤ produto ${produto.size} ≤ linhas ${totalLinhas}`);
  }
}

decks.sort(
  (a, b) =>
    ORDEM_KIND.indexOf(a.kind) - ORDEM_KIND.indexOf(b.kind) ||
    a.year.localeCompare(b.year) ||
    a.name.localeCompare(b.name),
);

// Saber Force e Dark Legion dividem o set code YS15: o título desempata.
const porId = Map.groupBy(decks, (deck) => deck.id);
for (const [, iguais] of porId) {
  if (iguais.length > 1) for (const deck of iguais) deck.id += `-${slugify(deck.product)}`;
}
const ids = new Set();
for (const deck of decks) {
  if (ids.has(deck.id)) throw new Error(`id repetido: ${deck.id}`);
  ids.add(deck.id);
}

console.log(`produtos: ${produtos.length} | decks: ${decks.length} | requisições à Yugipedia: ${requisicoes}`);
for (const kind of ORDEM_KIND) {
  console.log(`  ${kind}: ${decks.filter((d) => d.kind === kind).length}`);
}
if (porNomeUsado.length) {
  console.log(`\nresolvidas pelo nome (${porNomeUsado.length}):`);
  for (const linha of porNomeUsado) console.log(`  ${linha}`);
}
if (rejeitados.length) {
  console.log(`\nfora (${rejeitados.length}):`);
  for (const linha of rejeitados) console.log(`  ${linha}`);
}
if (avisos.length) {
  console.log(`\ntamanho não confere (${avisos.length}):`);
  for (const linha of avisos) console.log(`  ${linha}`);
}

if (process.argv.includes("--dry-run")) process.exit(0);
// Um deck por bloco e cada lista de passcodes numa linha só: o arquivo fica
// legível num diff (uma carta trocada = uma linha mudada) sem 5 mil linhas.
const json = JSON.stringify(decks, null, 2).replace(
  /\[\s*(\d[\d,\s]*?)\s*\]/g,
  (_, nums) => `[${nums.split(/\s*,\s*/).join(", ")}]`,
);
writeFileSync(OUT, `${json}\n`);
console.log(`\ngravado em ${OUT}`);
if (avisos.length) process.exitCode = 1;
