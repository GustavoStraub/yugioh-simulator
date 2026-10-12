/**
 * Deixa o Node importar os módulos TypeScript do app direto do `src/`.
 *
 * O Node 26 já remove os tipos sozinho; o que falta é a **resolução** que só o
 * bundler do Next faz. Sem isto, os testes de UI e o servidor de duelo online
 * teriam que duplicar a lógica em JS — e código que reimplementa o que deveria
 * usar não verifica nada.
 *
 * Três diferenças entre o resolvedor do TypeScript e o do Node, e todas
 * quebram o carregamento se ficarem de fora:
 *
 * 1. o atalho `@/...` do `tsconfig.json`;
 * 2. imports sem extensão (`"./duel"` para `duel.ts`, `"@/lib/types"` para
 *    `lib/types/index.ts`) — o Node exige o caminho completo;
 * 3. módulos JSON, que o Node só aceita com `with { type: "json" }`.
 */
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
/**
 * Nada fora de `src/` passa por aqui.
 *
 * O hook vale para TODA resolução do processo, inclusive a CommonJS que o Next
 * usa internamente — e o carregador CJS espera um CAMINHO, não uma URL
 * `file://`. Sem este limite, um `require("./cjs/react.development.js")` lá
 * dentro do `node_modules/react` recebia uma URL de volta e o servidor nem
 * subia.
 */
const SRC_URL = pathToFileURL(SRC).href;

export function resolve(specifier, context, next) {
  const alvo = arquivoDe(specifier, context.parentURL);
  const resolved = next(alvo ?? specifier, context);

  if (resolved.url.endsWith(".json") && ehNosso(resolved.url)) {
    return {
      ...resolved,
      importAttributes: { ...resolved.importAttributes, type: "json" },
    };
  }

  return resolved;
}

/**
 * Traduz um especificador do app no arquivo real, ou `null` quando não é
 * problema nosso (pacote do `node_modules`, builtin do Node, URL absoluta).
 */
function arquivoDe(specifier, parentURL) {
  if (specifier.startsWith("@/")) {
    return primeiroArquivo(join(SRC, specifier.slice(2)));
  }

  // Relativos só interessam quando partem de um módulo NOSSO — é onde moram
  // os `export * from "./duel"` sem extensão. Fora de `src/` a resolução é do
  // Node e mexer nela quebra o próprio Next.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && ehNosso(parentURL)) {
    return primeiroArquivo(join(dirname(fileURLToPath(parentURL)), specifier));
  }

  return null;
}

function ehNosso(url) {
  return typeof url === "string" && url.startsWith(SRC_URL);
}

/**
 * Primeiro candidato que é um ARQUIVO.
 *
 * A checagem precisa ser por arquivo e não por existência: `@/lib/types` é um
 * diretório com `index.ts` dentro, e aceitá-lo fazia o Node recusar com
 * ERR_UNSUPPORTED_DIR_IMPORT em vez de cair no `index.ts`.
 */
function primeiroArquivo(base) {
  const candidatos = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidato of candidatos) {
    if (ehArquivo(candidato)) return pathToFileURL(candidato).href;
  }
  return null;
}

function ehArquivo(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
