/**
 * Gera `src/data/card-db.json` — os dados OFICIAIS de cada carta (o mesmo
 * `cards.cdb` contra o qual os scripts Lua do ProjectIgnis foram escritos).
 *
 * Por que isso existe: a YGOPRODeck publica a carta para humanos ("Quick-Play
 * Spell", "Winged Beast"), não os bitfields que o ocgcore usa. Derivar `type`,
 * `race` e sobretudo `setcode` a partir daquelas strings é impossível —
 * setcode (o "arquétipo" para o engine) simplesmente não existe na YGOPRODeck.
 * Sem ele, TODO efeito que checa `IsSetCard(...)` falha silenciosamente:
 * Gravekeeper's, Harpie, Amazoness, Toon, Ojama, Archfiend...
 *
 * `alias` é igualmente crítico: "Harpie Lady 1" É "Harpie Lady" pelas regras,
 * e sem o alias o engine trata como cartas diferentes.
 *
 * Fontes: o `cards.cdb` e todos os `release-*.cdb` de um mesmo commit do
 * BabelCDB (ver `cdb-manifest.mjs`); os `prerelease-*` ficam de fora.
 *
 * Uso:
 *   npm run build:card-db               # usa os .cdb já baixados
 *   npm run build:card-db -- --refresh  # baixa tudo do commit mais novo do BabelCDB
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CDB_MANIFEST_NAME, cdbFiles } from "./cdb-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/data/card-db.json");
const CACHE_DIR = join(root, ".cache");
const MANIFEST = join(CACHE_DIR, CDB_MANIFEST_NAME);
const REFRESH = process.argv.includes("--refresh");

const BABEL_API = "https://api.github.com/repos/ProjectIgnis/BabelCDB";
const rawUrl = (sha, name) =>
  `https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${sha}/${name}`;

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function downloadCdb(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

/**
 * Baixa o `cards.cdb` e os `release-*.cdb` do commit mais novo do BabelCDB —
 * todos do MESMO commit, para não misturar um `cards.cdb` novo com um
 * `release` que já foi fundido nele — e grava o manifesto.
 */
async function refreshFromBabel() {
  const { sha, commit } = await getJson(`${BABEL_API}/commits/master`);
  const contents = await getJson(`${BABEL_API}/contents?ref=${sha}`);
  const releases = contents
    .map((entry) => entry.name)
    .filter((name) => /^release-.+\.cdb$/.test(name))
    .sort();
  const files = ["cards.cdb", ...releases];
  for (const name of files) {
    process.stdout.write(`Baixando ${name} (BabelCDB ${sha.slice(0, 8)})...\n`);
    await downloadCdb(rawUrl(sha, name), join(CACHE_DIR, name));
  }
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ commit: sha, date: commit.committer.date, files }, null, 1)}\n`,
  );
  return { sha, date: commit.committer.date };
}

/** Lê uma .cdb e devolve as linhas de `datas` com os 64 bits preservados. */
function readCdb(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const statement = db.prepare(
    "select id, alias, setcode, type, level, race, attribute, atk, def from datas",
  );
  // setcode empacota até 4 setcodes de 16 bits num inteiro de 64 — não cabe
  // em Number sem perder bits.
  statement.setReadBigInts(true);
  const rows = statement.all();
  db.close();
  return rows;
}

/** Desempacota o setcode de 64 bits em até 4 setcodes de 16 bits. */
function unpackSetcodes(packed) {
  const setcodes = [];
  for (let shift = 0n; shift < 64n; shift += 16n) {
    const value = Number((packed >> shift) & 0xffffn);
    if (value !== 0) setcodes.push(value);
  }
  return setcodes;
}

/**
 * O campo `level` da .cdb empacota as escalas de Pendulum nos bytes altos
 * (`lscale << 24 | rscale << 16 | level`). Passar o valor cru como nível faria
 * um Pendulum entrar em campo com nível na casa dos milhões.
 */
function unpackLevel(raw) {
  const value = Number(raw);
  return {
    level: value & 0xff,
    lscale: (value >> 24) & 0xff,
    rscale: (value >> 16) & 0xff,
  };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (REFRESH || cdbFiles(root).length === 0) await refreshFromBabel();
  const origem = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, "utf8"))
    : { commit: "(desconhecido — .cdb anterior ao manifesto)", files: ["cards.cdb"] };

  const entries = new Map();
  const porArquivo = [];

  for (const target of cdbFiles(root)) {
    let novas = 0;
    for (const row of readCdb(target)) {
      const id = Number(row.id);
      // A primeira fonte (cards.cdb) vence: é a oficial.
      if (entries.has(id)) continue;
      novas += 1;
      const { level, lscale, rscale } = unpackLevel(row.level);
      entries.set(id, {
        type: Number(row.type),
        alias: Number(row.alias),
        setcodes: unpackSetcodes(row.setcode),
        level,
        lscale,
        rscale,
        race: Number(row.race),
        attribute: Number(row.attribute),
        atk: Number(row.atk),
        def: Number(row.def),
      });
    }
    porArquivo.push(`${target.split("/").pop()}: ${novas}`);
  }

  const sorted = [...entries.entries()].sort((a, b) => a[0] - b[0]);

  // Formato compacto (array posicional, ver CARD_DB_FIELDS no card-adapter):
  // o formato "um objeto por carta" custa 1,9 MB para as ~14 mil cartas e esse
  // arquivo é servido ao navegador a cada duelo. Posicional dá 630 KB.
  const payload = Object.fromEntries(
    sorted.map(([id, d]) => [
      id,
      [d.type, d.alias, d.level, d.race, d.attribute, d.atk, d.def, d.lscale, d.rscale, ...d.setcodes],
    ]),
  );

  writeFileSync(OUT, JSON.stringify(payload));
  const withSetcode = sorted.filter(([, d]) => d.setcodes.length > 0).length;
  const withAlias = sorted.filter(([, d]) => d.alias !== 0).length;
  process.stdout.write(
    `card-db.json: ${sorted.length} cartas (${withSetcode} com setcode, ${withAlias} com alias)\n` +
      `  BabelCDB ${String(origem.commit).slice(0, 12)}${origem.date ? ` (${origem.date})` : ""} — ${porArquivo.join(", ")}\n`,
  );
}

await main();
