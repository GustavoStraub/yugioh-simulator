/**
 * Baixa o que o harness precisa para rodar offline:
 *  - `.cache/CardScripts` — o ProjectIgnis/CardScripts no commit FIXO de
 *    `src/lib/duel/cardscripts-pin.ts` (o mesmo que o app lê);
 *  - `.cache/goat-pool.json` — o pool do formato Goat da YGOPRODeck;
 *  - `.cache/catalog/catalog.json` — o catálogo de cartas do app (ver
 *    `src/server/catalog/catalog-build.ts`).
 *
 * Sem isso cada teste de carta faria requisições de rede, e testar mil e
 * seiscentas cartas viraria mil e seiscentas idas ao GitHub.
 *
 * O clone é raso e só do commit fixo: o `master` anda mais rápido que o core
 * compilado, e um harness lendo scripts diferentes dos do app testaria outro
 * jogo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CARDSCRIPTS_COMMIT, CARDSCRIPTS_REPO } from "../../src/lib/duel/cardscripts-pin.ts";
import { REPO, SCRIPTS_DIR } from "./env.mjs";

const CACHE = join(REPO, ".cache");
mkdirSync(CACHE, { recursive: true });

const git = (...args) =>
  execFileSync("git", ["-C", SCRIPTS_DIR, ...args], { stdio: ["ignore", "pipe", "inherit"] })
    .toString()
    .trim();

if (!existsSync(join(SCRIPTS_DIR, ".git"))) {
  process.stdout.write(`Clonando ProjectIgnis/CardScripts em ${CARDSCRIPTS_COMMIT.slice(0, 8)}...\n`);
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  git("init", "--quiet");
  git("remote", "add", "origin", CARDSCRIPTS_REPO);
}

/** Commit em que o clone está — `null` num clone recém-criado, sem nada. */
function currentHead() {
  try {
    return execFileSync("git", ["-C", SCRIPTS_DIR, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

if (currentHead() === CARDSCRIPTS_COMMIT) {
  process.stdout.write(`CardScripts já no commit fixo (${CARDSCRIPTS_COMMIT.slice(0, 8)}).\n`);
} else {
  process.stdout.write(`Levando CardScripts para ${CARDSCRIPTS_COMMIT.slice(0, 8)}...\n`);
  // Busca só aquele commit: o GitHub aceita pedir um SHA direto, e o clone
  // continua raso.
  git("fetch", "--quiet", "--depth", "1", "origin", CARDSCRIPTS_COMMIT);
  git("checkout", "--quiet", "--detach", CARDSCRIPTS_COMMIT);
}

const poolPath = join(CACHE, "goat-pool.json");
if (!existsSync(poolPath) || process.argv.includes("--refresh")) {
  process.stdout.write("Baixando o pool Goat da YGOPRODeck...\n");
  const response = await fetch(
    "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat",
  );
  if (!response.ok) throw new Error(`YGOPRODeck respondeu ${response.status}`);
  writeFileSync(poolPath, await response.text());
}

// O catálogo de cartas (TCG + Goat + fichas) que o app e os testes de sessão
// leem. Precisa do carregador de TypeScript, então roda num processo à parte.
if (!existsSync(join(CACHE, "catalog/catalog.json")) || process.argv.includes("--refresh")) {
  process.stdout.write("Montando o catálogo de cartas...\n");
  execFileSync(
    process.execPath,
    [
      "--import",
      "./tools/harness/ts-loader-register.mjs",
      "scripts/build-catalog.mjs",
      ...(process.argv.includes("--refresh") ? ["--refresh"] : []),
    ],
    { cwd: REPO, stdio: "inherit" },
  );
}

process.stdout.write("Fixtures prontas.\n");
