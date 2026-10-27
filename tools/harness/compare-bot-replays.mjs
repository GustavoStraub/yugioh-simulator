import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, stringify } from './bot-evaluation-artifacts.mjs';
const [a,b] = process.argv.slice(2).map(path=>parse(readFileSync(path,'utf8')));
assert.equal(a.game.pair,b.game.pair,'Compare o mesmo par de seed e listas');
assert.equal(a.game.seat,b.game.seat,'Compare o mesmo assento da política avaliada');
let first = 0;
while (first<Math.min(a.responses.length,b.responses.length)
  && stringify(a.responses[first])===stringify(b.responses[first])) first++;
const traceFor = (replay,index) => {
  const response=replay.responses[index];
  return { response, decisions:replay.traces.filter(trace=>trace.promptIndex===index).map(trace=>({turn:trace.turn,prompt:trace.prompt,
      source:trace.source,reason:trace.reason,candidates:trace.candidates})) };
};
console.log(stringify({identical:first===a.responses.length&&first===b.responses.length,firstChangedResponse:first,
  before:traceFor(a,first),after:traceFor(b,first)}));
