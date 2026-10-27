/** Estatística por pares completos, estratificada por confronto. Sem dependências do bot. */
export function scoreGames(games) {
  const complete = games.filter(game => game.score !== null);
  const wins = complete.filter(game => game.score === 1).length;
  const losses = complete.filter(game => game.score === 0).length;
  const draws = complete.length - wins - losses;
  return { wins, losses, draws, inconclusive: games.length - complete.length,
    points: complete.reduce((sum, game) => sum + game.score, 0),
    score: complete.length ? complete.reduce((sum, game) => sum + game.score, 0) / complete.length : null,
    decidedWinRate: wins + losses ? wins / (wins + losses) : null };
}

export function pairedInterval(games, { samples = 4000, seed = 731 } = {}) {
  const strata = new Map();
  for (const game of games) {
    const key = `${game.decks[0]}:${game.decks[1]}`;
    if (!strata.has(key)) strata.set(key, new Map());
    const pairs = strata.get(key);
    if (!pairs.has(game.pair)) pairs.set(game.pair, []);
    pairs.get(game.pair).push(game);
  }
  const groups = [...strata.values()].map(pairs => [...pairs.values()]);
  // Não publicar intervalo degenerado como evidência quando há um único par por estrato.
  if (!groups.length || groups.some(pairs => pairs.length < 2)) return null;
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const estimates = [];
  for (let sample = 0; sample < samples; sample++) {
    let points = 0, n = 0;
    for (const pairs of groups) for (let i = 0; i < pairs.length; i++) {
      for (const game of pairs[Math.floor(random() * pairs.length)]) if (game.score !== null) { points += game.score; n++; }
    }
    if (n) estimates.push(points / n);
  }
  estimates.sort((a, b) => a - b);
  if (!estimates.length) return null;
  return [estimates[Math.floor((estimates.length - 1) * 0.025)], estimates[Math.ceil((estimates.length - 1) * 0.975)]];
}

/** Mesmo par/assento nos dois relatórios: mantém a correlação ao estimar a diferença. */
export function pairedDifference(games, control) {
  const reference = new Map(control.map(game => [`${game.pair}:${game.seat}`, game]));
  const matched = games.flatMap(game => {
    const other = reference.get(`${game.pair}:${game.seat}`);
    return game.score !== null && other?.score !== null && other?.score !== undefined
      ? [{ ...game, score: 0.5 + (game.score-other.score)/2 }] : [];
  });
  const ci = pairedInterval(matched);
  return { games: matched.length, delta: matched.length ? 2*scoreGames(matched).score-1 : null,
    ci95: ci ? ci.map(value => 2*value-1) : null };
}

export function approval(games, panel, control = []) {
  const pairs = new Set(games.map(game => game.pair)).size;
  const stats = scoreGames(games), interval = pairedInterval(games);
  const reasons = [];
  if (panel !== 'validation') reasons.push('Painel de desenvolvimento');
  if (pairs < 256) reasons.push('Menos de 256 pares');
  if (stats.inconclusive) reasons.push('Há partidas inconclusivas; investigar antes de aprovar');
  if (games.some(game => game.rejected || game.errors || game.limits)) reasons.push('Falha de legalidade ou continuidade');
  if (control.some(game => game.score === null || game.rejected || game.errors || game.limits)) reasons.push('Controle inconclusivo ou com falhas de continuidade');
  const deckResults = [...new Set(games.map(game => game.decks[game.seat]))].map(deck => {
    const selected = games.filter(game => game.decks[game.seat] === deck);
    const result = scoreGames(selected);
    const comparison = pairedDifference(selected, control);
    return { deck, ...result, ci95: pairedInterval(selected), control: comparison,
      reviewRequired: comparison.delta === null || comparison.games < result.wins+result.losses+result.draws
        ? null : comparison.delta < -0.05 };
  });
  if (deckResults.some(result => result.reviewRequired === null)) reasons.push('Falta controle pareado por deck para avaliar regressões');
  if (deckResults.some(result => result.reviewRequired)) reasons.push('Queda acima de 5 pontos em um deck contra o controle; investigar considerando a incerteza');
  if (stats.score === null || stats.score < 0.55 || !interval || interval[0] <= 0.5) reasons.push('Ganho de força não demonstrado');
  return { approved: reasons.length === 0, reasons, pairs, ...stats, ci95: interval, deckResults };
}
