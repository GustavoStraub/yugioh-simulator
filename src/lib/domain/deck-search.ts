/**
 * A busca dos seletores de deck: "contém", sem acento e sem caixa.
 *
 * Pedido do Gustavo ("tipo um search includes"): o que se digita tem de
 * APARECER no nome do deck, em qualquer ponto — e não só no começo, como no
 * `<select>` nativo, que pula para a primeira opção que COMEÇA com a letra.
 * Com ~100 decks TCG, era a diferença entre achar o "Blue-Eyes" digitando
 * "eyes" e rolar a lista inteira.
 *
 * Duas folgas a mais, porque é assim que se procura:
 *
 * - sem acento e sem maiúscula: "dragao" acha "Dragão", "KAIBA" acha "Kaiba";
 * - cada palavra digitada vale sozinha, em qualquer ordem: "kaiba inicial"
 *   acha "Baralho Inicial: Kaiba" (as duas palavras estão lá, só que em outra
 *   ordem). Uma palavra só é o "contém" puro.
 *
 * O nome do GRUPO também conta ("tcg", "estrutural", "meus"): é o jeito de
 * filtrar pela linha do deck sem saber o nome dele.
 *
 * Funções puras — a tela e o `test:deck-search` usam as mesmas.
 */

/** Tira acento e caixa: "Dragão Branco" → "dragao branco". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** As palavras da busca, já normalizadas; vazia = mostra tudo. */
export function termosDaBusca(busca: string): string[] {
  return normalizar(busca).split(/\s+/).filter(Boolean);
}

/** O texto (nome + grupo) contém todas as palavras da busca? */
export function casaComBusca(texto: string, termos: string[]): boolean {
  if (termos.length === 0) return true;
  const alvo = normalizar(texto);
  return termos.every((termo) => alvo.includes(termo));
}

export interface OpcaoBuscavel {
  value: string;
  label: string;
}

export interface GrupoBuscavel<T extends OpcaoBuscavel = OpcaoBuscavel> {
  label: string;
  opcoes: T[];
}

/**
 * Os grupos com só as opções que casam — grupo que ficou vazio sai. Uma busca
 * que casa com o NOME do grupo traz o grupo inteiro.
 */
export function filtrarGrupos<T extends OpcaoBuscavel>(
  grupos: GrupoBuscavel<T>[],
  busca: string,
): GrupoBuscavel<T>[] {
  const termos = termosDaBusca(busca);
  if (termos.length === 0) return grupos;
  return grupos
    .map((grupo) => ({
      label: grupo.label,
      opcoes: grupo.opcoes.filter((opcao) => casaComBusca(`${opcao.label} ${grupo.label}`, termos)),
    }))
    .filter((grupo) => grupo.opcoes.length > 0);
}

/**
 * O rótulo em pedaços, marcando onde cada palavra da busca aparece — para a
 * lista destacar o trecho achado. As posições vêm do texto normalizado, que
 * tem o mesmo comprimento do original letra a letra (o NFD só separa o acento
 * da letra; a remoção do acento é refeita aqui contando por letra de base).
 */
export function trechosDestacados(
  texto: string,
  busca: string,
): { texto: string; achado: boolean }[] {
  const termos = termosDaBusca(busca);
  if (termos.length === 0) return [{ texto, achado: false }];

  // Uma letra normalizada por letra do original (letras com acento viram a
  // letra sem acento; o resto fica igual em minúscula).
  const letras = [...texto];
  const base = letras.map((letra) => normalizar(letra) || letra);
  const plano = base.join("");
  // Mapa: posição no texto plano → índice da letra original.
  const dono: number[] = [];
  base.forEach((pedaco, indice) => {
    for (let i = 0; i < pedaco.length; i += 1) dono.push(indice);
  });

  const marcado = new Array<boolean>(letras.length).fill(false);
  for (const termo of termos) {
    let desde = 0;
    for (;;) {
      const achou = plano.indexOf(termo, desde);
      if (achou < 0) break;
      for (let i = achou; i < achou + termo.length; i += 1) marcado[dono[i]] = true;
      desde = achou + Math.max(1, termo.length);
    }
  }

  const trechos: { texto: string; achado: boolean }[] = [];
  letras.forEach((letra, indice) => {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.achado === marcado[indice]) ultimo.texto += letra;
    else trechos.push({ texto: letra, achado: marcado[indice] });
  });
  return trechos;
}
