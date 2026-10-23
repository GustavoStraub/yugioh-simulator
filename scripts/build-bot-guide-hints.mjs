/** Índice pequeno para o bot; o texto editorial completo fica na página Aprender. */
import { readFileSync, writeFileSync } from 'node:fs';

const base = JSON.parse(readFileSync('src/data/deck-learning-base.json', 'utf8'));
const decisions = JSON.parse(readFileSync('src/data/guide-decisions.json', 'utf8'));
const cardDb = JSON.parse(readFileSync('src/data/card-db.json', 'utf8'));
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const genericWords = new Set(['ritual', 'fusion', 'synchro', 'xyz', 'link', 'dragon', 'monster', 'spell', 'trap', 'hero', 'warrior', 'beast', 'machine', 'dark', 'light', 'earth', 'water', 'fire', 'wind']);

/** Recolhe apenas nomes explícitos no primeiro comando; não adivinha efeitos pelo texto. */
function openingCard(guide, action) {
  const names = guide.coreCards.map((card) => {
    const aliases = new Set([card.name, card.namePt].filter(Boolean).map(normalize));
    for (const name of [...aliases]) {
      const words = name.split(' ');
      if (words.length > 1) {
        aliases.add(words.at(-1));
        aliases.add(words.slice(-2).join(' '));
      }
    }
    return [...aliases].filter((alias) => alias.length >= 4 && !genericWords.has(alias));
  });
  const frequencies = new Map();
  for (const aliases of names) for (const alias of aliases) frequencies.set(alias, (frequencies.get(alias) ?? 0) + 1);
  const words = normalize(action);
  const boundary = words.match(/\bpara\b|\be\b/);
  const cutoff = boundary?.index ?? words.length;
  const candidates = [];
  for (let i = 0; i < guide.coreCards.length; i++) {
    const code = guide.coreCards[i].code;
    if (!guide.deckSnapshot.main.includes(code)) continue;
    const [type = 0, , level = 0] = cardDb[code] ?? [];
    if ((type & 1) !== 0 && level > 4) continue;
    for (const alias of names[i]) {
      if (frequencies.get(alias) !== 1) continue;
      const index = (` ${words} `).indexOf(` ${alias} `) - 1;
      if (index < 0 || index > cutoff) continue;
      candidates.push({ code, index, length: alias.length });
    }
  }
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  return candidates[0]?.code ?? null;
}

const signature = (deck) => {
  const bag = (cards) => [...cards].sort((a, b) => a - b).join(',');
  return `tcg:${bag(deck.main)}|${bag(deck.extra)}|${bag(deck.side)}`;
};

const hints = base.decks.map((guide) => {
  const main = new Set(guide.deckSnapshot.main);
  const extraDeck = new Set(guide.deckSnapshot.extra);
  const core = [...new Set(guide.coreCards.map((card) => card.code).filter((code) => main.has(code)))];
  const extra = [...new Set(guide.coreCards.map((card) => card.code).filter((code) => extraDeck.has(code)))];
  const firstSteps = guide.lessons.slice(0, 2).map((lesson) => lesson.steps[0]).filter(Boolean);
  const startingCodes = firstSteps.map((first) => first.cardCodes.length ? first.cardCodes : [openingCard(guide, first.action)].filter(Boolean));
  const opening = [...new Set(startingCodes.flat()
    .filter((code) => {
      if (!main.has(code)) return false;
      const [type = 0, , level = 0] = cardDb[code] ?? [];
      return (type & 1) === 0 || level <= 4;
    }))];
  const plays = firstSteps.flatMap((first) => {
    if (!first) return [];
    // Só a marcação estruturada autoriza bônus de execução. Um nome extraído
    // da frase pode indicar a carta de abertura, mas não seus pré-requisitos.
    const code = first.cardCodes.find((candidate) => {
      if (!main.has(candidate)) return false;
      const [type = 0, , level = 0] = cardDb[candidate] ?? [];
      return (type & 1) === 0 || level <= 4;
    });
    if (!code) return [];
    const support = first.cardCodes.filter((candidate) => candidate !== code);
    const action = first.action.toLocaleLowerCase('pt-BR');
    const zone = /reviv|cemitério|recuper/.test(action) ? 'grave'
      : /busc|deck/.test(action) ? 'deck' : 'visible';
    return [{ code, support, zone }];
  });
  return { id: guide.id, signature: signature(guide.deckSnapshot), core, extra, opening, plays, decisions: decisions[guide.id] ?? [] };
});

writeFileSync('src/data/bot-guide-hints.json', `${JSON.stringify(hints, null, 2)}\n`);
console.log(`Índice do bot: ${hints.length} guias`);
