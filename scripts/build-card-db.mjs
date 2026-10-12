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
 * Uso: node scripts/build-card-db.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/data/card-db.json");
const CACHE_DIR = join(root, ".cache");
const CDB_CACHE = join(CACHE_DIR, "cards.cdb");

/**
 * BabelCDB divide o banco em vários .cdb; `cards.cdb` cobre todo o pool
 * oficial, que é o que o formato Goat usa.
 */
const CDB_SOURCES = [
  "https://github.com/ProjectIgnis/BabelCDB/raw/master/cards.cdb",
];

async function downloadCdb(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
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

  const entries = new Map();

  for (const [index, url] of CDB_SOURCES.entries()) {
    const target = index === 0 ? CDB_CACHE : join(CACHE_DIR, `cdb-${index}.cdb`);
    if (!existsSync(target)) {
      process.stdout.write(`Baixando ${url}...\n`);
      try {
        await downloadCdb(url, target);
      } catch (error) {
        process.stdout.write(`  ignorado: ${error.message}\n`);
        continue;
      }
    }

    for (const row of readCdb(target)) {
      const id = Number(row.id);
      // A primeira fonte (cards.cdb) vence: é a oficial.
      if (entries.has(id)) continue;
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
    `card-db.json: ${sorted.length} cartas (${withSetcode} com setcode, ${withAlias} com alias)\n`,
  );
}

await main();
