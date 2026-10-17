/** Mesmo filtro e contexto da sessão; nenhum cérebro recebe mensagens privadas. */
import { readBoardState } from '@/lib/duel/board-state';
import { BotKnowledge } from '@/lib/duel/bot/knowledge';
export function createBotObserver(duel, format = 'goat') {
  const knowledge = [new BotKnowledge(0), new BotKnowledge(1)];
  let cursor = 0;
  return (prompt) => {
    for (; cursor < duel.messages.length; cursor += 1) {
      for (const k of knowledge) k.observe(duel.messages[cursor]);
    }
    const seat = prompt.player === 1 ? 1 : 0;
    return { ...knowledge[seat].context(), prompt: knowledge[seat].mask(prompt, () => readBoardState(duel.core,duel.handle,seat,true)), format, retryCount: duel.retries };
  };
}
