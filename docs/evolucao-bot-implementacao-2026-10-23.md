# Evolução do bot — entrega e limites

Data: 23/10/2026. Referência: commit `3ab76a5`, congelada **antes** das alterações.

A infraestrutura de comparação está implementada. As novas decisões estão disponíveis como **experimento**, desativado por padrão: a bateria de desenvolvimento encontrou regressão. O plano completo ainda não está concluído e suas condições de avanço continuam valendo.

## O que foi entregue

- Referência independente com 36 módulos/dados de execução, inclusive imports dinâmicos, perfis, guias, listas e banco de cartas. O carregador verifica todos os SHA-256. Os imports congelados não usam `@/` nem os módulos atuais do bot.
- Origem de toda resposta atual, incluindo automáticas, heurísticas, guias, rotas, falta de modelo, exceção e recuperação de rejeição. O trace registra resposta final, candidato selecionado, efeito/instância, parcelas da nota, alternativas e substituição pela rede de segurança. Atribuição e candidatos detalhados cobrem Main, corrente, batalha e seleção de cartas; seletores especializados ainda têm diagnóstico mais simples.
- Replays privados com todas as respostas, hash de cada prompt e referência ao índice exato do trace. O replay confere ambiente, sequência de prompts, resultado, rejeições e erros. A comparação aponta a primeira resposta divergente.
- Relatórios por partida com seed, par, assento, primeiro jogador, políticas, listas, hashes do código/dados/core/scripts/emendas, resultado, limites, turnos, passos e tempo total incluindo observação.
- Matriz completa de confrontos, incluindo as orientações reversas; pontuação de empate de 0,5, inconclusivas separadas, bootstrap por pares estratificado e comparação por deck contra controle nos mesmos pares/assentos. Um deck naturalmente mais fraco não é classificado como regressão apenas por vencer menos de 50%.
- Painéis de desenvolvimento e validação separados. O painel reservado exige pelo menos 256 pares e cria um recibo que impede reutilização silenciosa. **Ele não foi utilizado nesta entrega.**

## Estratégia experimental

Ativação explícita: `new BotBrain({ difficulty: "hard", candidateComparison: true, ... })`, ou política `hard-experimental` no avaliador. A UI continua usando a política estável.

O experimento compara ações genéricas, rotas, guias e guardar/passar no mesmo prompt; avalia defesa, risco, acesso ao motor, continuação, custo da Normal, duplicatas e extensão para letal. A preferência do guia recebe parcelas por contexto, acesso ausente e continuação visível. A legalidade continua sob responsabilidade do core.

Há descritores de efeito para um repertório inicial de Albaz/Phantom Knights e respostas associadas. A identidade do efeito distingue, por exemplo, aumentar atributos de buscar com Manto Antigo. Memória pública diferencia resposta conhecida numa localização, carta vista sem associação atual e possibilidade genérica. Movimento/embaralhamento invalidam a associação. As chaves de ativação experimentais também incluem a descrição do efeito.

Objetivos e reservas sobrevivem à mudança de turno apenas quando o recurso continua acessível; prefixos só avançam com confirmação do campo. Rotas são ordenadas antes de limitar alternativas. Isso reutiliza os roteiros atuais; **não é uma busca geral de transições nem cobre todas as restrições por turno**.

O combate experimental cobre proteção incondicional de Ceifador/Marshmallon, ataques adicionais de Hayabusa e perfuração de Airknight. A análise para na fronteira de efeitos de saída desconhecidos; diferencia letal coberto de tentativa incerta e recalcula após o core. O orçamento é cooperativo e mantém uma alternativa examinada mesmo quando já expirou. A implementação estável de combate foi conservada para evitar promover a regressão encontrada.

As políticas `hard-no-sequence`, `hard-no-state`, `hard-no-memory` e `hard-no-recovery` permitem testes de atribuição. As três últimas usam o restante da estratégia experimental; `hard-no-recovery` desliga conservação entre turnos e retomada de prefixos, preservando análise de respostas.

## Evidência

Passaram `test:bot` (incluindo 60 partidas Goat), `test:bot-decisions`, os 44 cenários de `test:bot-strategy`, `test:hidden`, `test:bot-evolution`, TypeScript e lint dos arquivos alterados.

A suíte nova contém [30 observações dirigidas](bot-evolution-decisions-2026-10-23.json), com objetivos e alternativas aceitáveis; nove divergem da baseline e passam no experimento. Isso **não** é um catálogo de 30 erros encontrados em partidas, nem demonstra cumprimento da meta de eliminar 80% dos erros prioritários reais. Quatro confrontos adicionais verificam previsões contra resultados no core: as duas proteções, ataque duplo e dano perfurante.

Um caso real de divergência foi extraído do replay: o experimento parava após Jadespelho mesmo sem continuação útil. A observação permitida foi salva em `tools/harness/fixtures/bot-over-preservation.json` e virou regressão. A correção exige defesa **e** acesso/recuperação utilizável para valorizar parar; não se atribui toda a derrota àquela primeira divergência.

Os resultados completos e identidades do ambiente estão em [bot-evolution-evaluation-2026-10-23.json](bot-evolution-evaluation-2026-10-23.json). Cada comparação principal tem 256 pares, 512 partidas, matriz TCG completa e seeds de desenvolvimento:

| Comparação | Vitórias / derrotas | Inconclusivas | Pontuação | IC 95% por pares |
| --- | --- | --- | --- | --- |
| Estável atual × Difícil congelado | 256 / 256 | 0 | 50,0% | 50,0–50,0% |
| Estável atual × Médio atual | 275 / 237 | 0 | 53,7% | 51,0–56,4% |
| Experimental × Difícil congelado | 243 / 268 | 1 | 47,6% | 45,6–49,5% |

Todas tiveram zero respostas rejeitadas e zero erros de core. A inconclusiva experimental atingiu 4.000 passos; permanece fora da pontuação e impede aprovação. O controle congelado contra si próprio teve 256/256 e nenhuma inconclusiva. As diferenças por deck da política estável contra o controle foram zero. No experimental, Destiny HERO perdeu cerca de 5,5 pontos contra o controle e exige investigação; o relatório inclui a incerteza dessa diferença.

A bateria Goat de continuidade também rodou os quatro decks previstos. É desenvolvimento, não certificação competitiva nem amostra representativa do formato. Tempos medidos no Node/macOS deste ambiente não certificam p95/p99 em celular. Não foram introduzidos Worker ou clonagem do core.

## Como reproduzir

```sh
npm run test:bot-evolution
npm run test:bot-decisions
npm run test:bot-strategy

# Primeiro, controle de força dos próprios decks.
BOT_ROUNDS=16 BOT_MATRIX=full \
BOT_BASELINE=tools/harness/baselines/2026-10-23 \
BOT_COMPARISONS=baseline-hard:baseline-hard \
BOT_REPORT=.cache/bot-evaluation/control.json npm run eval:bot

BOT_ROUNDS=16 BOT_MATRIX=full \
BOT_BASELINE=tools/harness/baselines/2026-10-23 \
BOT_CONTROL_REPORT=.cache/bot-evaluation/control.json \
BOT_COMPARISONS=hard-experimental:baseline-hard \
BOT_REPORT=.cache/bot-evaluation/experiment.json npm run eval:bot

# Replays são opt-in e só podem ser escritos em um diretório novo em .cache/.
BOT_ROUNDS=1 BOT_DECKS=tcg-sdaz \
BOT_COMPARISONS=hard:medium \
BOT_REPLAY_DIR=.cache/bot-evaluation/replays-novos npm run eval:bot
npm run replay:bot -- .cache/bot-evaluation/replays-novos/hard-medium-0-0-0.json
npm run compare:bot-replays -- /caminho/replay-anterior.json /caminho/replay-novo.json
```

`BOT_GAME_ID` seleciona uma partida para investigação, mantendo a matriz e a fórmula de seed. `baseline` equivale ao Médio congelado; use `baseline-hard` para comparar dificuldades iguais. `BOT_FORMAT=goat` seleciona automaticamente os quatro decks Goat previstos no plano. `BOT_MATRIX=adjacent` conserva a matriz curta anterior; `full` executa todos os pares orientados.

Para uma futura certificação, fixe configuração e amostra previamente, use `BOT_PANEL=validation`, a matriz e o número de rodadas planejados, controle pareado compatível e caminho de relatório novo. O avaliador bloqueia aprovação sem evidência, controle por deck, mínimo de pares e continuidade; não elimina a necessidade de revisão humana das partidas.

## Condições ainda abertas

1. Completar o catálogo de 30 **erros reais**, atribuindo causa e consequência observada; ampliar alternativas dos seletores especializados.
2. Corrigir a regressão experimental e demonstrar a meta de força antes de promover a comparação conjunta. O trace e as ablações permitem investigar isso sem enfraquecer o Médio.
3. Expandir transições, efeitos usados, custos/restrições, recuperação após interrupção e testes de divergência previsão/core; o estado atual conserva objetivos, mas ainda depende de roteiros.
4. Medir em dispositivos móveis definidos e isolar a análise em Worker quando necessário.
5. Generalizar compatibilidade por motor e ampliar perfis apenas depois de cumprir a condição de ganho das etapas anteriores. A assinatura exata continua sendo exigida.
6. Executar a validação reservada e revisão com jogadores. Não há afirmação de nível competitivo nesta entrega.
