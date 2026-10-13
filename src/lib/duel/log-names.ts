/**
 * Nomes de carta do histórico no idioma escolhido.
 *
 * O texto de cada linha é montado na sessão — no duelo online, no servidor —
 * com o nome do catálogo (o português, quando existe). O seletor PT/EN mudava
 * a leitura da carta, a pilha da corrente e o destaque, mas o histórico ficava
 * em português: a mesma carta com dois nomes na mesma tela.
 *
 * Cada linha leva os códigos das cartas que cita (`DuelLogEntry.codes`, só as
 * públicas); aqui o nome com que a sessão escreveu é trocado pelo do idioma de
 * quem lê. Troca de texto, e não um modelo com marcadores, para que a linha
 * continue legível em qualquer lugar que a leia crua (testes, servidor).
 *
 * @param nomeOriginal o nome com que a sessão escreveu (`registry.get(code).name`).
 * @param nomeNoIdioma o nome no idioma escolhido.
 */
export function localizeLogText(
  text: string,
  codes: readonly number[] | undefined,
  nomeOriginal: (code: number) => string | undefined,
  nomeNoIdioma: (code: number) => string | undefined,
): string {
  if (!codes?.length) return text;
  let out = text;
  // Os nomes mais longos primeiro: "Dark Magician Girl" antes de "Dark
  // Magician", senão a troca do menor corromperia o maior.
  const pares = [...new Set(codes)]
    .map((code) => ({ de: nomeOriginal(code), para: nomeNoIdioma(code) }))
    .filter((par): par is { de: string; para: string } => Boolean(par.de && par.para && par.de !== par.para))
    .sort((a, b) => b.de.length - a.de.length);
  for (const { de, para } of pares) out = out.split(de).join(para);
  return out;
}
