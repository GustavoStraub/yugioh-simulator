/**
 * Commit do ProjectIgnis/CardScripts que o app e o harness usam.
 *
 * Os scripts Lua andam mais rápido que o ocgcore compilado no binding: o
 * `master` do CardScripts passa a usar constantes e funções que o core daqui
 * ainda não conhece, e a carta quebra sem que nada mude do nosso lado — foi o
 * que criou a emenda do `chain.lua` (`script-patches.ts`). Ler sempre o
 * `master` fazia o jogo mudar sozinho de um dia para o outro, e um teste que
 * passou ontem deixava de valer hoje.
 *
 * Com o commit fixo, a rota `/api/scripts` (navegador), o servidor online e o
 * clone de `npm run fixtures` (harness) leem **o mesmo** conjunto de scripts.
 * Subir este commit é uma decisão, tomada junto com a versão do binding e
 * seguida da bateria inteira do harness — nunca uma consequência do calendário.
 *
 * Importado por caminho relativo pelo harness (Node puro, sem o atalho `@/`),
 * então só pode conter constantes.
 */
export const CARDSCRIPTS_COMMIT = "f1522e75cc41eda09727678433f9cbbbca2255dc";

/** Repositório de onde o clone do harness é feito. */
export const CARDSCRIPTS_REPO = "https://github.com/ProjectIgnis/CardScripts.git";

/** Base dos arquivos crus, já no commit fixo. */
export const CARDSCRIPTS_RAW_BASE = `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/${CARDSCRIPTS_COMMIT}`;
