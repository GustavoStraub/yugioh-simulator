/**
 * Gera `src/data/engine-strings.json` — as strings que o ocgcore referencia
 * por ID em vez de mandar por extenso.
 *
 * Por que isso existe: quando uma carta oferece uma escolha de efeitos
 * (`Duel.SelectOption` no script Lua), o core não manda o texto da opção —
 * manda um inteiro. Esse inteiro é produzido por `Auxiliary.Stringid(code,id)`
 * em utility.lua:
 *
 *   function Auxiliary.Stringid(code,id)
 *       return (id&0xfffff)|code<<20
 *   end
 *
 * ou seja, os 20 bits baixos são o índice da string (`id`, 0-based) e o resto
 * é o passcode da carta (`code`) — NÃO é "passcode>>4 / valor&0xf" como uma
 * primeira leitura da documentação do protocolo sugere. Isso foi verificado
 * batendo `aux.Stringid` contra os scripts reais (`c8842266.lua` etc.) e
 * conferindo os operandos na tabela `texts`, e não deve ser alterado sem
 * reverificar contra o utility.lua da versão do ocgcore em uso.
 *
 * Quando o valor não tem um passcode embutido (é pequeno — bem abaixo de
 * `code<<20` de qualquer carta real, cujo passcode mínimo no cards.cdb é 483),
 * é uma "system string": um índice fixo em `strings.conf`, o mesmo arquivo que
 * o ygopro/ProjectIgnis usa pra Yes/No, Monster/Spell/Trap Cards etc.
 *
 * As strings específicas de carta vêm de `cards.cdb` (`texts.str1..str16`,
 * 1-based: `Stringid(id,0)` é `str1`). Reaproveita o mesmo cache de
 * `build-card-db.mjs` — é o mesmo arquivo.
 *
 * Uso: node scripts/build-engine-strings.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src/data/engine-strings.json");
const CACHE_DIR = join(root, ".cache");
const CDB_CACHE = join(CACHE_DIR, "cards.cdb");
const STRINGS_CACHE = join(CACHE_DIR, "strings.conf");

/** Mesma fonte de `build-card-db.mjs` — reaproveita o cache se ele já rodou. */
const CDB_URL = "https://github.com/ProjectIgnis/BabelCDB/raw/master/cards.cdb";

/**
 * `ProjectIgnis/LFLists` (o repo citado originalmente para strings.conf) não
 * tem esse arquivo — 404. O locale inglês "oficial" do ProjectIgnis vive em
 * `Distribution`, no caminho abaixo (verificado com `curl -I`).
 */
const STRINGS_CONF_URL =
  "https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf";

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function ensureCached(url, target, label) {
  if (existsSync(target)) return;
  process.stdout.write(`Baixando ${label}...\n`);
  await download(url, target);
}

/**
 * `strings.conf` é linha-a-linha: `!system <id> <texto>`, `!counter`,
 * `!setname`, `!victory`. Interessam `!system` (o que `Duel.SelectOption`,
 * `Duel.Hint` e os avisos de carta referenciam) e `!counter` — o nome de cada
 * tipo de contador, que a mesa mostra no selo ("Spell Counter ×2"). Nomes de
 * arquétipo e razões de vitória são tratados em outro lugar.
 * Comentários (`#`) e linhas em branco são ignorados.
 */
function parseStringsConf(text) {
  const system = {};
  const counters = {};
  for (const line of text.split("\n")) {
    const sys = /^!system\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (sys) {
      system[sys[1]] = sys[2];
      continue;
    }
    // Tipo em hexadecimal; guardado em decimal, que é como o core manda.
    const counter = /^!counter\s+0x([0-9a-fA-F]+)\s+(.+?)\s*$/.exec(line);
    if (counter) counters[String(parseInt(counter[1], 16))] = counter[2];
  }
  return { system, counters };
}

/**
 * `texts.str1..str16` são as strings específicas de cada carta — as opções de
 * `Duel.SelectOption`, descrições de sub-efeitos, etc. Corta as `str` vazias
 * do final de cada carta (a maioria usa só 2 ou 3) para não desperdiçar
 * espaço com ~13 strings vazias por carta.
 */
function readCardStrings(path, manter) {
  const db = new DatabaseSync(path, { readOnly: true });
  const statement = db.prepare(
    "select id, str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 from texts",
  );
  const rows = statement.all();
  db.close();

  const cards = {};
  for (const row of rows) {
    if (manter && !manter.has(Number(row.id))) continue;
    const strs = [];
    for (let i = 1; i <= 16; i += 1) {
      strs.push(row[`str${i}`] ?? "");
    }
    while (strs.length > 0 && strs[strs.length - 1] === "") strs.pop();
    if (strs.length === 0) continue;
    cards[String(row.id)] = strs;
  }
  return cards;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  await ensureCached(STRINGS_CONF_URL, STRINGS_CACHE, "strings.conf");
  await ensureCached(CDB_URL, CDB_CACHE, "cards.cdb");

  const { system, counters } = parseStringsConf(readFileSync(STRINGS_CACHE, "utf8"));
  // Todas as cartas, não só o pool Goat: com o TCG no app qualquer carta pode
  // estar em jogo, e os avisos que ficam na carta ("não pode atacar neste
  // turno") são strings de carta. O arquivo vai comprimido ao navegador.
  const cards = readCardStrings(CDB_CACHE, null);

  const payload = { system, cards, counters };
  writeFileSync(OUT, JSON.stringify(payload));

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  process.stdout.write(
    `engine-strings.json: ${Object.keys(system).length} strings de sistema, ` +
      `${Object.keys(cards).length} cartas com strings próprias, ` +
      `${Object.keys(counters).length} tipos de contador ` +
      `(${(bytes / 1024).toFixed(1)} KB)\n`,
  );
}

await main();
