/** A pergunta do core no formato que as funções daqui entendem. */
export function sumRequestOf(message) {
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
export function sumValues(card) {
    const packed = card.amount >>> 0;
    return [packed & 0xffff, packed >>> 16];
}
/**
 * Soma exata alcançável com TODAS estas cartas, cada uma contribuindo um dos
 * seus dois valores? Espelho de `select_sum_check1` do core.
 */
function exactReachable(values, acc, index = 0) {
    if (acc === 0 || index === values.length)
        return false;
    const [o1, o2] = values[index];
    if (index === values.length - 1)
        return acc === o1 || acc === o2;
    return ((acc > o1 && exactReachable(values, acc - o1, index + 1)) ||
        (o2 > 0 && acc > o2 && exactReachable(values, acc - o2, index + 1)));
}
function chosen(request, indices) {
    return [
        ...request.selectsMust.map(sumValues),
        ...indices.map((index) => sumValues(request.selects[index])),
    ];
}
/** A seleção passa na checagem do core? */
export function isValidSum(request, indices) {
    if (request.mode === "exact") {
        if (indices.length < request.min || indices.length > Math.max(request.max, request.min)) {
            return false;
        }
        return exactReachable(chosen(request, indices), request.amount);
    }
    // Igual ou maior: com os maiores valores chega no alvo, e sem a menor carta
    // (pelos menores valores) já não chegaria — nenhuma carta sobrando.
    const values = chosen(request, indices);
    if (values.length === 0)
        return false;
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
export function sumProgress(request, indices) {
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
function exactWith(values, k, target, from = 0, memo = new Map()) {
    if (k === 0)
        return target === 0 ? [] : null;
    if (target <= 0 || values.length - from < k)
        return null;
    const key = `${from}:${k}:${target}`;
    if (memo.has(key))
        return memo.get(key);
    let found = null;
    const [o1, o2] = values[from];
    for (const value of o2 > 0 && o2 !== o1 ? [o1, o2] : [o1]) {
        if (value <= 0 || value > target)
            continue;
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
function mustSums(request) {
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
export function findSumSubset(request) {
    const n = request.selects.length;
    if (isValidSum(request, []))
        return [];
    if (n === 0)
        return [];
    if (n <= 16) {
        let best = null;
        for (let mask = 1; mask < 1 << n; mask += 1) {
            const picked = [];
            for (let i = 0; i < n; i += 1)
                if (mask & (1 << i))
                    picked.push(i);
            if (best && picked.length >= best.length)
                continue;
            if (isValidSum(request, picked))
                best = picked;
        }
        if (best)
            return best;
    }
    const values = request.selects.map(sumValues);
    if (request.mode === "exact") {
        const max = Math.max(request.max, request.min);
        for (let k = Math.max(request.min, 1); k <= Math.min(max, n); k += 1) {
            for (const must of mustSums(request)) {
                const picked = exactWith(values, k, request.amount - must);
                if (picked && isValidSum(request, picked))
                    return picked;
            }
        }
    }
    // Igual ou maior (e reserva do exato): os maiores primeiro até cobrir o
    // alvo. É a seleção com MENOS cartas que chega lá — e por isso sem carta
    // sobrando, que é a regra do modo.
    const order = values
        .map(([o1, o2], index) => ({ index, value: Math.max(o1, o2) }))
        .sort((a, b) => b.value - a.value);
    const picked = [];
    let total = Math.max(...mustSums(request));
    for (const entry of order) {
        if (total >= request.amount)
            break;
        picked.push(entry.index);
        total += entry.value;
    }
    return picked;
}
