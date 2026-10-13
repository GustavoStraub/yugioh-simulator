/**
 * O pool TCG inteiro contra o engine, nas regras de hoje (Master Rule 2020).
 *
 * É a medição da §3.1 de `docs/tcg-completo.md` promovida a teste: cada carta
 * TCG com script entra no mesmo cenário farto do `test-cards` (ver
 * `card-scan.mjs`), o duelo roda até a Main Phase 1, a carta é ativada ou
 * invocada e o piloto automático resolve o resto. Responde, para as ~13 mil
 * cartas, as duas perguntas que só se respondiam jogando: o script carrega? o
 * efeito resolve sem estourar?
 *
 * O que ele NÃO prova: combos de várias etapas, prompts raros entre duas cartas
 * modernas, timing de Damage Step. "Não oferecida" também não é falha — quase
 * sempre o cenário não cumpre a condição da carta (uma Armadilha que espera um
 * ataque, um Xyz sem os materiais certos).
 *
 * O pool vem do `cards.cdb` do BabelCDB (o mesmo que gera `card-db.json`):
 * `ot & 2` (TCG), sem fichas, sem arte alternativa e só cartas com script —
 * um monstro Normal sem efeito não tem o que testar.
 *
 * Uso:
 *   npm run test:tcg-pool                     # tudo, em 4 processos
 *   npm run test:tcg-pool -- --jobs 8         # mais processos
 *   npm run test:tcg-pool -- 12345 67890      # só esses passcodes
 *   npm run test:tcg-pool -- --json out.json  # relatório completo
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { OcgDuelMode } from "@n1xx1/ocgcore-wasm";

import {
  OCG_TYPE,
  applySlice,
  parseScanArgs,
  printScanSummary,
  runScan,
} from "./card-scan.mjs";
import { CARD_ARTWORK_VERSIONS_OFFSET, REPO, SCRIPTS_DIR, loadCardDb } from "./env.mjs";
import { cdbFiles } from "../../scripts/cdb-manifest.mjs";

const OT_TCG = 0x2;

/**
 * Falhas já conhecidas e registradas em `docs/tcg-completo.md` (§3.1).
 *
 * Ficam na lista para o teste continuar servindo de alarme: uma falha NOVA
 * reprova; uma destas só é relatada. Quando uma delas for resolvida, sai
 * daqui — e o teste passa a vigiar que ela não volte.
 */
const KNOWN_FAILURES = new Map([
  // Vazio desde a Fase 4: os dois laços de RETRY que sobravam (Ancient Gear
  // Gadget e Crossout Designator) eram o piloto declarando um nome fixo; ele
  // agora avalia o filtro do core (`announce-filter.ts`).
]);

/**
 * O pool TCG com script, lido dos mesmos `.cdb` do `card-db.json` — o
 * `cards.cdb` e os `release-*.cdb` do manifesto (`scripts/cdb-manifest.mjs`).
 */
function loadTcgPool() {
  const fontes = cdbFiles(REPO);
  if (fontes.length === 0) {
    throw new Error("Falta .cache/cards.cdb — rode `npm run build:card-db -- --refresh`.");
  }
  const porId = new Map();
  for (const fonte of fontes) {
    const db = new DatabaseSync(fonte, { readOnly: true });
    const linhas = db
      .prepare(
        "select d.id, d.alias, d.type, t.name from datas d join texts t on t.id = d.id " +
          "where (d.ot & ?) != 0 and (d.type & ?) = 0 order by d.id",
      )
      .all(OT_TCG, OCG_TYPE.TOKEN);
    db.close();
    // O primeiro arquivo (cards.cdb) vence num id repetido.
    for (const linha of linhas) if (!porId.has(Number(linha.id))) porId.set(Number(linha.id), linha);
  }
  const rows = [...porId.values()].sort((a, b) => Number(a.id) - Number(b.id));

  return rows
    .filter((row) => {
      const alias = Number(row.alias);
      const id = Number(row.id);
      // Arte alternativa usa o script da original — testar as duas é testar a
      // mesma carta duas vezes.
      return alias === 0 || Math.abs(alias - id) >= CARD_ARTWORK_VERSIONS_OFFSET;
    })
    .filter((row) => existsSync(join(SCRIPTS_DIR, "official", `c${row.id}.lua`)))
    .map((row) => ({ id: Number(row.id), name: row.name, type: Number(row.type) }));
}

/** Categoria da tabela da §3.1 — uma carta pode cair em mais de uma. */
function categoriesOf(type) {
  const out = [];
  if (type & OCG_TYPE.SPELL) out.push("Magia");
  if (type & OCG_TYPE.TRAP) out.push("Armadilha");
  if (type & OCG_TYPE.MONSTER) {
    const extra = type & (OCG_TYPE.FUSION | OCG_TYPE.SYNCHRO | OCG_TYPE.XYZ | OCG_TYPE.LINK);
    if (!extra) out.push("Monstro do Main Deck");
    if (type & OCG_TYPE.FUSION) out.push("Fusão");
    if (type & OCG_TYPE.SYNCHRO) out.push("Sincro");
    if (type & OCG_TYPE.XYZ) out.push("Xyz");
    if (type & OCG_TYPE.LINK) out.push("Link");
    if (type & OCG_TYPE.PENDULUM) out.push("Pêndulo");
    if (type & OCG_TYPE.RITUAL) out.push("Ritual");
  }
  return out;
}

/** Roda as fatias em processos filhos e junta os relatórios. */
async function runInJobs(jobs, extraArgs) {
  const dir = mkdtempSync(join(tmpdir(), "ygo-tcg-pool-"));
  const self = fileURLToPath(import.meta.url);
  try {
    await Promise.all(
      Array.from({ length: jobs }, (_, index) => {
        const out = join(dir, `slice-${index}.json`);
        return new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [self, "--slice", `${index}/${jobs}`, "--json", out, "--quiet", ...extraArgs],
            { stdio: ["ignore", "ignore", "inherit"] },
          );
          child.on("exit", (code) =>
            code === 0 || code === 1 ? resolve() : reject(new Error(`fatia ${index} saiu com ${code}`)),
          );
        });
      }),
    );
    return Array.from({ length: jobs }, (_, index) =>
      JSON.parse(readFileSync(join(dir, `slice-${index}.json`), "utf8")),
    ).flat();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printTable(report) {
  const stats = new Map();
  for (const card of report) {
    const acted = card.results.some((r) => r.verdict === "ACTIVATED");
    const notOffered = card.results.every((r) => r.verdict === "NOT_OFFERED");
    for (const category of categoriesOf(card.type)) {
      const row = stats.get(category) ?? { total: 0, acted: 0, notOffered: 0 };
      row.total += 1;
      if (acted) row.acted += 1;
      if (notOffered) row.notOffered += 1;
      stats.set(category, row);
    }
  }

  const scenarios = report.reduce((total, card) => total + card.results.length, 0);
  const errors = report.filter((card) => card.results.some((r) => r.verdict === "LUA_ERROR"));
  const acted = report.filter((card) => card.results.some((r) => r.verdict === "ACTIVATED"));

  process.stdout.write("\n=== pool TCG (Master Rule 2020) ===\n");
  process.stdout.write(`cartas: ${report.length}\n`);
  process.stdout.write(`cenários: ${scenarios}\n`);
  process.stdout.write(`erros de Lua: ${errors.length}\n`);
  process.stdout.write(`ativadas/invocadas em ≥ 1 cenário: ${acted.length}\n`);
  process.stdout.write("\n| Tipo | Cartas | Ativou/invocou | Não oferecida |\n|---|---:|---:|---:|\n");
  for (const category of ["Magia", "Monstro do Main Deck", "Armadilha", "Fusão", "Sincro", "Xyz", "Link", "Pêndulo", "Ritual"]) {
    const row = stats.get(category);
    if (!row) continue;
    process.stdout.write(`| ${category} | ${row.total} | ${row.acted} | ${row.notOffered} |\n`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseScanArgs(argv);
  const quiet = argv.includes("--quiet");
  const jobsAt = argv.indexOf("--jobs");
  const jobs = jobsAt >= 0 ? Number(argv[jobsAt + 1]) : 4;

  const all = loadTcgPool();
  let cards = all;
  if (args.explicit.length) {
    const known = new Map(all.map((c) => [c.id, c]));
    const db = loadCardDb();
    cards = args.explicit.map(
      (id) => known.get(id) ?? { id, name: `#${id}`, type: db.get(id)?.type ?? 0 },
    );
  }

  let report;
  if (!args.slice && !args.explicit.length && jobs > 1) {
    // Processo coordenador: divide o pool e só junta os resultados.
    process.stderr.write(`pool TCG: ${cards.length} cartas em ${jobs} processos...\n`);
    report = await runInJobs(jobs, argv.includes("--verbose") ? ["--verbose"] : []);
  } else {
    cards = applySlice(cards, args.slice);
    report = await runScan(cards, loadCardDb(), {
      mode: OcgDuelMode.MODE_MR5,
      extraDeck: true,
    });
  }

  if (args.jsonOut) writeFileSync(args.jsonOut, JSON.stringify(report));
  if (quiet) return;

  const byVerdict = printScanSummary(report, { verbose: args.verbose });
  printTable(report);

  const failing = ["CRASH", "BINDING_ERROR", "LUA_ERROR", "STUCK", "RETRY_LOOP"].flatMap(
    (verdict) => byVerdict[verdict] ?? [],
  );
  const novas = failing.filter((row) => !KNOWN_FAILURES.has(row.id));
  const conhecidas = failing.filter((row) => KNOWN_FAILURES.has(row.id));
  if (conhecidas.length) {
    process.stdout.write(`\nfalhas conhecidas (${conhecidas.length}):\n`);
    for (const row of conhecidas) {
      process.stdout.write(`  ${row.id} [${row.placement}] ${row.verdict} — ${KNOWN_FAILURES.get(row.id)}\n`);
    }
  }
  if (novas.length) {
    process.stdout.write(`\n✗ ${novas.length} falha(s) nova(s) — ver acima.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("\n✓ nenhuma falha nova.\n");
  }
}

await main();
