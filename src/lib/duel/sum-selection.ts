import type { OcgCardLocSum } from "@n1xx1/ocgcore-wasm";

/**
 * SELECT_SUM não é "escolha N cartas": é "escolha cartas cujos valores somem
 * `amount`". É o prompt usado, por exemplo, pelos tributos de uma
 * Invocação-Ritual, onde o valor de cada carta é o nível dela.
 *
 * As cartas de `selects_must` entram obrigatoriamente e já contam para a soma —
 * elas não fazem parte dos índices da resposta, que se referem só a `selects`.
 */
export interface SumRequest {
  amount: number;
  selects: OcgCardLocSum[];
  selectsMust: OcgCardLocSum[];
}

/** O quanto ainda falta somar depois das cartas obrigatórias. */
export function remainingTarget(request: SumRequest): number {
  const mandatory = request.selectsMust.reduce(
    (total, card) => total + card.amount,
    0,
  );
  return request.amount - mandatory;
}

/** Soma dos valores dos índices escolhidos dentro de `selects`. */
export function sumOf(selects: OcgCardLocSum[], indices: number[]): number {
  return indices.reduce((total, index) => total + (selects[index]?.amount ?? 0), 0);
}

/**
 * Uma seleção é válida quando atinge o alvo restante. Rituais aceitam soma
 * maior ou igual (tributo excedente é permitido), então é isso que exigimos —
 * a checagem final continua sendo do core.
 */
export function isValidSum(request: SumRequest, indices: number[]): boolean {
  const target = remainingTarget(request);
  if (target <= 0) return true;
  return sumOf(request.selects, indices) >= target;
}

/**
 * Acha um conjunto de índices que atinja o alvo, preferindo:
 * 1. soma exata com o menor número de cartas;
 * 2. na falta de combinação exata, a menor soma que passe do alvo.
 *
 * Busca exaustiva sobre subconjuntos, limitada porque `selects` num duelo real
 * é uma lista curta (as cartas elegíveis em campo/mão).
 */
export function findSumSubset(request: SumRequest): number[] {
  const target = remainingTarget(request);
  if (target <= 0) return [];

  const values = request.selects.map((card) => card.amount);
  const n = values.length;
  if (n === 0) return [];

  // Acima de 20 cartas o espaço de busca fica grande demais; nesse caso cai
  // direto para a heurística gulosa.
  if (n > 20) return greedy(values, target);

  let exact: number[] | null = null;
  let over: number[] | null = null;

  for (let mask = 1; mask < 1 << n; mask += 1) {
    let total = 0;
    const picked: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        total += values[i];
        picked.push(i);
      }
    }

    if (total === target) {
      if (!exact || picked.length < exact.length) exact = picked;
    } else if (total > target) {
      const overTotal = over ? sumOf(request.selects, over) : Infinity;
      if (total < overTotal || (total === overTotal && picked.length < (over?.length ?? 0))) {
        over = picked;
      }
    }
  }

  return exact ?? over ?? greedy(values, target);
}

/** Pega as maiores primeiro até cobrir o alvo. */
function greedy(values: number[], target: number): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);

  const picked: number[] = [];
  let total = 0;
  for (const entry of order) {
    if (total >= target) break;
    picked.push(entry.index);
    total += entry.value;
  }
  return picked;
}
