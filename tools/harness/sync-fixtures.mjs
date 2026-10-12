/**
 * Baixa o que o harness precisa para rodar offline:
 *  - `.cache/CardScripts` — clone raso do ProjectIgnis/CardScripts;
 *  - `.cache/goat-pool.json` — o pool do formato Goat da YGOPRODeck.
 *
 * Sem isso cada teste de carta faria requisições de rede, e testar mil e
 * seiscentas cartas viraria mil e seiscentas idas ao GitHub.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO, SCRIPTS_DIR } from "./env.mjs";

const CACHE = join(REPO, ".cache");
mkdirSync(CACHE, { recursive: true });

if (existsSync(SCRIPTS_DIR)) {
  process.stdout.write("CardScripts já em cache — atualizando...\n");
  execFileSync("git", ["-C", SCRIPTS_DIR, "pull", "--quiet", "--ff-only"], {
    stdio: "inherit",
  });
} else {
  process.stdout.write("Clonando ProjectIgnis/CardScripts...\n");
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--quiet", "https://github.com/ProjectIgnis/CardScripts.git", SCRIPTS_DIR],
    { stdio: "inherit" },
  );
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

process.stdout.write("Fixtures prontas.\n");
