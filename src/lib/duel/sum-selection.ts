import type { OcgCardLocSum, OcgMessageSelectSum } from "@n1xx1/ocgcore-wasm";

/**
 * SELECT_SUM não é "escolha N cartas": é "escolha cartas cujos valores somem
 * `amount`" — os tributos de uma Invocação-Ritual, os materiais de certos
 * efeitos, os Níveis que uma carta manda juntar.
 *
 * As regras são as do core (`field::process(SelectSum)` no ygopro-core), e há
 * DOIS modos, que a primeira versão desta tela tratava como um só:
 *
 * - **Soma exata** (`Duel.SelectWithSumEqual`): de `min` a `max` cartas, e a
 *   soma tem que dar EXATAMENTE o alvo. O byte que o binding chama de
 *   `select_max` vem 0 neste modo.
 * - **Soma igual ou maior** (`Duel.SelectWithSumGreater`, o do Ritual): passar
 *   do alvo pode, mas sem carta sobrando — se dá para tirar a menor e ainda
 *   chegar lá, a seleção é recusada. `select_max` vem 1.
 *
 * E cada carta pode valer **dois** números: o core empacota o valor como
 * `o1 | o2 << 16` (um monstro que conta como Nível 4 OU 8 para um Ritual, por
 * exemplo). Ler `amount` cru, como antes, somava 262148 no lugar de 4.
 *
 * As cartas de `selects_must` entram obrigatoriamente e já contam para a soma —
 * elas não fazem parte dos índices da resposta, que se referem só a `selects`.
 */
export interface SumRequest {
  amount: number;
  /** `exact` quando o core mandou `select_max` 0; `atLeast` quando 1. */
  mode: "exact" | "atLeast";
  /** Quantidade de cartas escolhidas (sem as obrigatórias) — só no modo exato. */
  min: number;
  max: number;
  selects: OcgCardLocSum[];
  selectsMust: OcgCardLocSum[];
}

/** A pergunta do core no formato que as funções daqui entendem. */
export function sumRequestOf(message: OcgMessageSelectSum): SumRequest {
  return {
    amount: message.amount,
    mode: message.select_max === 0 ? "exact" : "atLeast",
    min: message.min,
    max: message.max,
    selects: message.selects,
    selectsMust: message.selects_must,
  };
}

/** Os dois valores possíveis de uma carta (o segundo é 0 quando não há). */
export function sumValues(card: OcgCardLocSum): [number, number] {
  const packed = card.amount >>> 0;
  return [packed & 0xffff, packed >>> 16];
}

/**
 * Soma exata alcançável com TODAS estas cartas, cada uma contribuindo um dos
 * seus dois valores? Espelho de `select_sum_check1` do core.
 */
function exactReachable(values: [number, number][], acc: number, index = 0): boolean {
  if (acc === 0 || index === values.length) return false;
  const [o1, o2] = values[index];
  if (index === values.length - 1) return acc === o1 || acc === o2;
  return (
    (acc > o1 && exactReachable(values, acc - o1, index + 1)) ||
    (o2 > 0 && acc > o2 && exactReachable(values, acc - o2, index + 1))
  );
}

function chosen(request: SumRequest, indices: number[]): [number, number][] {
  return [
    ...request.selectsMust.map(sumValues),
    ...indices.map((index) => sumValues(request.selects[index])),
  ];
}

/** A seleção passa na checagem do core? */
export function isValidSum(request: SumRequest, indices: number[]): boolean {
  if (request.mode === "exact") {
    if (indices.length < request.min || indices.length > Math.max(request.max, request.min)) {
      return false;
    }
    return exactReachable(chosen(request, indices), request.amount);
  }

  // Igual ou maior: com os maiores valores chega no alvo, e sem a menor carta
  // (pelos menores valores) já não chegaria — nenhuma carta sobrando.
  const values = chosen(request, indices);
  if (values.length === 0) return false;
  let sumMin = 0;
  let sumMax = 0;
  let smallest = Infinity;
  for (const [o1, o2] of values) {
    const low = o2 && o2 < o1 ? o2 : o1;
    sumMin += low;
    sumMax += o2 > o1 ? o2 : o1;
    smallest = Math.min(smallest, low);
  }
  return sumMax >= request.amount && sumMin - smallest < request.amount;
}

/**
 * Texto de progresso ("soma 6/8"). Com carta de dois valores, mostra a faixa
 * possível ("6–10/8"), porque qual dos dois vale quem decide é a conta.
 */
export function sumProgress(request: SumRequest, indices: number[]): string {
  let low = 0;
  let high = 0;
  for (const [o1, o2] of chosen(request, indices)) {
    low += o2 && o2 < o1 ? o2 : o1;
    high += o2 > o1 ? o2 : o1;
  }
  const range = low === high ? `${low}` : `${low}–${high}`;
  return `${range}/${request.amount}`;
}

/**
 * Soma exata com `k` cartas de `selects` (a partir de `from`), cada uma
 * valendo um dos seus dois valores — índices da solução, ou `null`.
 *
 * Busca com memória em (carta, quantas faltam, quanto falta): os valores são
 * Níveis e afins, então a tabela é minúscula mesmo com o Deck inteiro como
 * candidato.
 */
function exactWith(
  values: [number, number][],
  k: number,
  target: number,
  from = 0,
  memo = new Map<string, number[] | null>(),
): number[] | null {
  if (k === 0) return target === 0 ? [] : null;
  if (target <= 0 || values.length - from < k) return null;
  const key = `${from}:${k}:${target}`;
  if (memo.has(key)) return memo.get(key)!;
  let found: number[] | null = null;
  const [o1, o2] = values[from];
  for (const value of o2 > 0 && o2 !== o1 ? [o1, o2] : [o1]) {
    if (value <= 0 || value > target) continue;
    const rest = exactWith(values, k - 1, target - value, from + 1, memo);
    if (rest) {
      found = [from, ...rest];
      break;
    }
  }
  found ??= exactWith(values, k, target, from + 1, memo);
  memo.set(key, found);
  return found;
}

/** Somas possíveis das cartas obrigatórias (cada uma vale um dos seus dois valores). */
function mustSums(request: SumRequest): number[] {
  let sums = [0];
  for (const card of request.selectsMust) {
    const [o1, o2] = sumValues(card);
    const options = o2 > 0 && o2 !== o1 ? [o1, o2] : [o1];
    sums = [...new Set(sums.flatMap((sum) => options.map((value) => sum + value)))];
  }
  return sums;
}

/**
 * Acha uma seleção válida para o core, com o menor número de cartas.
 *
 * Até 16 candidatos, busca exaustiva. Acima disso — um efeito que olha o Deck
 * inteiro, como o Speedroid Wheel ("1 ou 2 Speedroid cujos Níveis somem o
 * dado") —, uma busca pela regra de cada modo. A primeira versão caía aqui
 * numa gulosa "os maiores até cobrir o alvo", que ignora a soma EXATA: com o
 * dado em 1 ela mandava um Nível 5, o core recusava, e a mesma resposta
 * voltava até o duelo ser interrompido.
 */
export function findSumSubset(request: SumRequest): number[] {
  const n = request.selects.length;
  if (isValidSum(request, [])) return [];
  if (n === 0) return [];

  if (n <= 16) {
    let best: number[] | null = null;
    for (let mask = 1; mask < 1 << n; mask += 1) {
      const picked: number[] = [];
      for (let i = 0; i < n; i += 1) if (mask & (1 << i)) picked.push(i);
      if (best && picked.length >= best.length) continue;
      if (isValidSum(request, picked)) best = picked;
    }
    if (best) return best;
  }

  const values = request.selects.map(sumValues);
  if (request.mode === "exact") {
    const max = Math.max(request.max, request.min);
    for (let k = Math.max(request.min, 1); k <= Math.min(max, n); k += 1) {
      for (const must of mustSums(request)) {
        const picked = exactWith(values, k, request.amount - must);
        if (picked && isValidSum(request, picked)) return picked;
      }
    }
  }

  // Igual ou maior (e reserva do exato): os maiores primeiro até cobrir o
  // alvo. É a seleção com MENOS cartas que chega lá — e por isso sem carta
  // sobrando, que é a regra do modo.
  const order = values
    .map(([o1, o2], index) => ({ index, value: Math.max(o1, o2) }))
    .sort((a, b) => b.value - a.value);
  const picked: number[] = [];
  let total = Math.max(...mustSums(request));
  for (const entry of order) {
    if (total >= request.amount) break;
    picked.push(entry.index);
    total += entry.value;
  }
  return picked;
}
