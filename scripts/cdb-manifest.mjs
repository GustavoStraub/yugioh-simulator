/**
 * Quais `.cdb` do BabelCDB formam os dados oficiais deste checkout.
 *
 * O BabelCDB guarda as cartas lançadas em `cards.cdb`, mas um set recém-
 * lançado (ou exclusivo de uma região) fica num `release-<set>.cdb` próprio
 * até ser fundido — e só olhar o `cards.cdb` deixava essas cartas sem dados
 * no engine ("sem dados oficiais", fora do construtor), como as do Legendary
 * Arc-V Decks. `npm run build:card-db -- --refresh` baixa o `cards.cdb` e
 * todos os `release-*.cdb` de UM commit do BabelCDB e grava a lista aqui; quem
 * lê o banco direto (strings do engine, catálogo, bateria do pool TCG) usa a
 * mesma lista, na mesma ordem — o `cards.cdb` primeiro, que vence num id
 * repetido.
 *
 * Os `prerelease-*.cdb` ficam de fora de propósito: são cartas ainda não
 * lançadas, com passcode provisório que não bate com o catálogo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CDB_MANIFEST_NAME = "cdb-manifest.json";

/**
 * Caminhos absolutos dos `.cdb`, na ordem de precedência.
 *
 * Sem manifesto (checkout anterior a ele), cai no `cards.cdb` sozinho — o
 * comportamento antigo.
 */
export function cdbFiles(repoRoot) {
  const cache = join(repoRoot, ".cache");
  const manifest = join(cache, CDB_MANIFEST_NAME);
  if (existsSync(manifest)) {
    const { files } = JSON.parse(readFileSync(manifest, "utf8"));
    return files.map((name) => join(cache, name)).filter((path) => existsSync(path));
  }
  const legacy = join(cache, "cards.cdb");
  return existsSync(legacy) ? [legacy] : [];
}
