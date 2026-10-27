# Plano para melhorar a força real do bot

Data: 23 de outubro de 2026. Base analisada: commit `3ab76a5`.

Status: **implementação parcial**. A infraestrutura e a estratégia experimental estão registradas em [evolucao-bot-implementacao-2026-10-23.md](evolucao-bot-implementacao-2026-10-23.md). A comparação experimental não passou no critério de força e permanece desativada por padrão; as condições de avanço abaixo continuam pendentes.

## 1. Direção recomendada

O próximo salto deve ser fazer o bot escolher melhor entre jogar, guardar recurso e mudar de plano. A infraestrutura para executar combos já existe. O gargalo está em avaliar o resultado das jogadas, reconhecer o momento certo de interagir e continuar jogando depois de uma interrupção.

A recomendação é concentrar a primeira entrega nos quatro perfis completos existentes, melhorar também as decisões genéricas usadas no Goat e medir cada mudança contra a versão atual congelada. Expandir para dezenas de novos perfis antes disso aumentaria a manutenção sem demonstrar aumento de força.

Este plano complementa [a proposta original](inteligencia-bot.md) e [o registro de implementação](inteligencia-bot-implementacao.md). Esses documentos são históricos: o código já ganhou decisões guiadas e planejamento curto depois do registro de 17/10.

## 2. Diagnóstico confirmado no repositório

### O que deve ser aproveitado

| Capacidade existente | Evidência | Implicação |
| --- | --- | --- |
| Execução de rotas, reservas e intenção entre prompts | [planner.ts](../src/lib/duel/bot/planner.ts), [intent.ts](../src/lib/duel/bot/intent.ts), [effect-handlers.ts](../src/lib/duel/bot/effect-handlers.ts) | Evoluir o planejador existente, mantendo confirmação pelo estado real. |
| Quatro perfis completos TCG | [bot-profiles](../src/data/bot-profiles/) | Albaz Strike, Aesir, Destiny HERO e Phantom Knights são o primeiro grupo de validação. |
| Prioridades ligadas a 92 guias, com 28 decisões editoriais, 26 elegíveis para o bot | [bot-guide-hints.json](../src/data/bot-guide-hints.json), [decision-policy.ts](../src/lib/duel/bot/decision-policy.ts) | Há cobertura parcial além dos quatro perfis; isso não equivale a 92 pilotos completos. |
| Projeção de uma invocação para encontrar uma segunda ação guiada | `sequenceFollowUp` em [decision-policy.ts](../src/lib/duel/bot/decision-policy.ts) | Já existe antecipação curta; falta comparar consequências mais amplas e ramificações. |
| Busca de ordem de ataques | [battle-planner.ts](../src/lib/duel/bot/battle-planner.ts) | Melhorar o modelo de combate antes de aumentar a profundidade. |
| Memória pública, filtragem de informação e validação de respostas | [knowledge.ts](../src/lib/duel/bot/knowledge.ts), [response-validator.ts](../src/lib/duel/bot/response-validator.ts) | Preservar essas garantias em todas as etapas. |
| Rastros privados e avaliador com sementes e assentos pareados | [decision-trace.ts](../src/lib/duel/bot/decision-trace.ts), [evaluate-bot.mjs](../tools/harness/evaluate-bot.mjs) | A base para medir melhorias existe, mas precisa de mais atribuição por decisão. |

### Limitações que explicam a próxima prioridade

1. **A nota da rota depende principalmente de valores declarados no JSON.** `evaluateRoute` combina pressão, interação, continuação, custo e exposição. Ainda não compara de forma abrangente o estado concreto que cada linha produziria contra a mesa atual. Uma rota boa na abertura pode receber prioridade inadequada num turno de recuperação.
2. **As camadas decidem em sequência, com pouca comparação conjunta.** `profileResponse` pode responder antes das heurísticas e dos guias. As decisões guiadas recebem pisos de nota como 125 e 121. A opção `hold` não gera um candidato em `decisionMoves`. Preservar recursos existe, mas não participa de uma comparação uniforme entre todas as alternativas.
3. **O plano é sobretudo uma receita.** Há requisitos, passos, substituição de custos e retomada de prefixos no Difícil. Porém, o conjunto de rotas e sua ordem limitam as alternativas; o planejador considera um recorte inicial por `policy.alternatives`. O estado de rota e continuação é reiniciado a cada novo turno. Falta representar objetivos persistentes e rotas de recuperação como parte central da decisão.
4. **As hipóteses adversárias são muito amplas.** `responseHypotheses` considera uma carta baixada e a existência de mão no TCG. A memória fornece `observedFacts`, mas a análise inspecionada não os usa para construir essas hipóteses. Isso pode penalizar uma linha sem distinguir ameaça conhecida de possibilidade remota.
5. **O timing de respostas ainda é genérico em muitos casos.** `scoreChain` dá prioridade semelhante a diferentes efeitos de monstro da mão quando há contexto adversário. Existem exceções úteis, mas falta comparar deixar resolver, responder agora e guardar a interação para outro ponto.
6. **O combate simula uma fatia pequena das regras.** A busca remove defensores por comparação de atributos e retira cada atacante usado da lista. Não representa de forma geral múltiplos ataques, proteção, efeitos após destruição ou mudanças durante a batalha. Mais busca sobre esse modelo pode ampliar o erro da previsão.
7. **A estratégia depende da lista exata.** Perfis e dicas usam assinatura de Main/Extra/Side. Uma alteração no deck pode retirar o suporte estratégico mesmo quando o motor principal permanece. A restrição atual é segura; flexibilizá-la exige validar requisitos, não apenas reconhecer o arquétipo.
8. **Os diagnósticos não explicam toda decisão final.** As alternativas do trace vêm do planejador de rotas, enquanto outras escolhas acontecem no cérebro genérico. Há chamadas diretas ao respondedor genérico e substituições em `safeResponse`; o contador de fallback não basta para medir ausência de entendimento estratégico.

Os limites atuais são 10/20/40 ms para Fácil/Médio/Difícil em [difficulty.ts](../src/lib/duel/bot/difficulty.ts). O corte antigo de 12 ms citado na documentação histórica já foi removido. Aumentar o tempo não resolve sozinho as limitações acima.

## 3. Evidência de força e verificações desta análise

O [relatório de 17/10](bot-evaluation-2026-10-17.json) registrou:

| Comparação histórica | Resultado | Leitura correta |
| --- | --- | --- |
| Médio × referência anterior | 286 vitórias em 512 partidas decididas, 55,9% | Indício de melhora sobre aquela referência. |
| Médio × Fácil | 270/510, 52,9%, mais 2 inconclusivas | Separação de força ainda não demonstrada. |
| Difícil × Médio | 251/512, 49,0% | Superioridade do Difícil não demonstrada. |

Os intervalos históricos são Wilson por partida e não corrigem a dependência entre pares. Além disso, esse relatório antecede as decisões guiadas recentes; não deve ser apresentado como medição da versão atual.

Para fundamentar este plano, foram executados na base atual, com Node `v26.0.0`:

- `npm run test:bot-decisions`: passou, incluindo aberturas guiadas no core, custos alternativos, informação oculta e negação de efeito.
- `npm run test:bot-strategy`: passou nos 44 cenários de rotas.
- Avaliação curta Difícil × Médio: 15 vitórias e 17 derrotas em 32 partidas; nenhum empate, inconclusiva, erro, limite ou resposta rejeitada. O avaliador registrou 52 fallbacks e 5 decisões guiadas em 2.111 decisões do lado avaliado.

Comando da avaliação curta:

```sh
BOT_ROUNDS=2 BOT_COMPARISONS=hard:medium \
BOT_REPORT=.cache/bot-evaluation/planning-smoke-2026-10-23.json \
npm run eval:bot
```

O JSON é um artefato local em `.cache`; os resultados essenciais estão registrados acima. São apenas quatro listas e sementes do conjunto padrão. Essa execução verifica continuidade e reprodução, **não certifica força, não é uma amostra reservada e não prova regressão**. Passar testes de execução também não prova que a jogada escolhida é a melhor.

## 4. Como a decisão deve evoluir

Fluxo proposto:

```text
Observação permitida + memória pública + recursos próprios
    → candidatos legais: perfil, guia, heurística, guardar/passar
    → consequências modeladas e grau de confiança
    → comparação: sobrevivência, vitória, interação e continuação
    → resposta validada ao prompt atual
    → confirmação pelo core e revisão do plano
```

Os guias devem sugerir candidatos e explicar objetivos. O motor continua determinando legalidade. O avaliador compara o benefício das alternativas. Uma intenção já iniciada mantém coerência entre custo, alvo e resolução, mas admite abandono quando seus requisitos deixam de existir.

A unidade estratégica deve ser **carta + efeito + contexto + instância**, quando necessário, e não apenas o código da carta. Isso permite distinguir dois efeitos diferentes, duas cópias com usos diferentes e recursos que já foram consumidos.

## 5. Etapas de implementação

### Etapa 0 — Medir onde o bot perde decisões

**Prioridade P0. Dependências: nenhuma. Esforço relativo: médio.**

- Congelar a versão atual como adversário reproduzível, incluindo código, guias, perfis e demais dados que ela importa. Guardar somente `bot-brain.ts` não garante isolamento da referência.
- Ampliar o trace com origem da decisão final, candidatos realmente comparados, parcelas da nota, efeito/instância, recursos gastos, resultado esperado e motivo de troca em `safeResponse`.
- Separar resposta automática sem escolha, heurística estratégica, guia, rota, fallback por falta de modelo, fallback por erro e recuperação de resposta rejeitada.
- Registrar por partida: seed, par, assento, primeiro jogador, listas, hashes de dados/core/scripts, revisão e resultado. Acrescentar replay de respostas para investigação, mantendo os dados privados fora do snapshot público.
- Catalogar inicialmente 30 decisões ruins reproduzíveis: busca, descarte, uso da Normal, material, timing, combate, extensão excessiva e recuperação. Atribuir causa à primeira decisão evitável, não apenas ao último ataque da derrota.

**Entrega:** relatório da versão atual e catálogo de cenários com alternativas aceitáveis, justificativa e consequência observável.

**Aceite:** cada cenário reproduz o problema; toda resposta do bot identifica sua origem; é possível localizar quais decisões mudaram entre duas versões. Não exigir uma única jogada quando várias preservam o objetivo.

### Etapa 1 — Comparar valor real e corrigir erros de maior impacto

**Prioridade P0. Dependência: etapa 0. Esforço relativo: grande.**

- Introduzir uma representação comum de candidatos, reaproveitando `Plan`, rotas e decisões de guia. Transformar a preferência editorial em evidência de valor, reduzindo dependência de bônus fixos.
- Criar avaliação de estado compartilhada: vitória imediata, risco de derrota, interações utilizáveis, acesso ao motor, recursos de recuperação, restrições e valor da mão restante. ATK e quantidade de cartas são componentes, não o objetivo inteiro.
- Distinguir remoção que abre dano, remoção que interrompe uma sequência e remoção que ajuda o adversário. Começar pelos efeitos presentes nos cenários catalogados.
- Calcular o custo de gastar a única Normal, uma busca, um material ou um descarte pela alternativa que deixa de existir. Considerar duplicatas e efeitos úteis no cemitério quando modelados.
- Colocar guardar recurso e encerrar desenvolvimento entre as alternativas. Se já existe defesa e continuação, a extensão precisa justificar o recurso adicional.

**Exemplos de aceite:** buscar a peça ausente em vez de outra cópia sem utilidade; preservar o único acesso restante ao motor; remover um bloqueio antes de iniciar uma linha dependente dele; não estender quando o resultado adicional não compensa o custo. Validar também cenários opostos, nos quais estender é necessário para sobreviver ou vencer.

**Meta:** eliminar pelo menos 80% dos erros prioritários catalogados, sem quebrar os 44 cenários existentes. Esse percentual é uma meta de trabalho, não um resultado já obtido.

### Etapa 2 — Fazer as interrupções e a memória influenciarem o jogo

**Prioridade P1. Dependências: etapas 0 e 1. Esforço relativo: grande.**

- Criar descritores dos efeitos prioritários: busca, extensão, remoção, negação, recuperação, custo, restrição e dependência de alvo. Usar identidade de efeito quando disponível.
- Comparar responder agora com deixar resolver. Considerar impacto do elo, recursos já gastos, ameaça de letal e existência de outra interação própria.
- Consumir os fatos revelados de `BotKnowledge`, distinguindo carta conhecida, carta vista anteriormente sem localização atual e hipótese de arquétipo. Manter incerteza explícita e invalidar associações conforme movimentos e embaralhamentos.
- Criar cenários com duas oportunidades de resposta: uma de baixo impacto e outra que habilita a principal ameaça. Adicionar casos em que guardar seria fatal.
- Começar com um repertório pequeno de ameaças dos decks avaliados. Não atribuir probabilidades precisas sem dados para calibrá-las.

**Aceite:** o bot muda a resposta quando a ameaça ou a evidência pública muda; observações equivalentes geram decisões equivalentes com a mesma semente do bot, mesmo trocando cartas ocultas do adversário. O teste não pode fornecer a resposta correta por acesso à lista adversária.

### Etapa 3 — Planejar sequências adaptáveis e recuperar após interrupção

**Prioridade P1. Dependências: etapas 1 e 2. Esforço relativo: grande.**

- Evoluir passos lineares para transições com pré-condições, escolhas alternativas, custos, restrições e confirmação de resultado. Reutilizar rotas atuais como as primeiras transições.
- Manter objetivos e recursos para o próximo turno, reavaliando sua validade. Não conservar índices de prompts antigos nem presumir que um efeito resolveu.
- Ordenar candidatos por viabilidade e ganho antes de limitar sua quantidade, reduzindo o viés da ordem dos JSONs.
- Fazer busca limitada de sequências nos efeitos cobertos, incluindo parar, linha alternativa e recuperação após uma interrupção plausível. Começar com poucas ações e interromper na fronteira de efeito desconhecido.
- Representar Normal disponível, efeitos usados por turno, custos, zonas e restrições no estado de planejamento. O core valida a ação real mesmo quando a projeção estima que ela será possível.
- Validar cada transição em cenários do core. A previsão de estado deve ser comparada ao resultado observado; divergências precisam virar casos de regressão.

**Primeiro alvo:** Albaz e Phantom Knights, que já possuem rotas e decisões alternativas; depois Destiny HERO e Aesir.

**Aceite:** completar uma alternativa com peças diferentes; continuar após perder o primeiro starter quando houver recursos; parar quando a continuação se tornou inviável; preservar recuperação para o próximo turno. Executar casos de abertura, segundo jogador, mesa adversária estabelecida e jogo prolongado.

**Decisão arquitetural:** começar com transições explícitas e validadas. Investigar clonagem ou replay do core isoladamente antes de depender disso para busca. A análise atual não confirmou uma API de clonagem. Uma simulação nunca pode usar a mão real oculta, a ordem real de compras ou a semente do duelo como conhecimento do bot.

### Etapa 4 — Melhorar combate e execução sem bloquear a mesa

**Prioridade P1. Dependência: avaliação compartilhada da etapa 1. Pode anteceder partes da etapa 3. Esforço relativo: médio a grande.**

- Cobrir primeiro os efeitos de batalha frequentes nos decks de teste: proteção contra destruição, ataques adicionais, dano diferenciado e consequências da saída do campo.
- Separar letal demonstrado no modelo de uma tentativa de letal sob incerteza. Uma carta baixada deve mudar a avaliação de risco conforme as evidências, sem cancelar automaticamente toda oportunidade.
- Comparar ordem de ataques pelo campo restante e pela continuação, além do dano. Recalcular após cada resposta real do core.
- Medir tempo total de decisão, inclusive extração do estado. Ao ampliar a busca, mover a análise pesada para Worker ou worker thread, com observação serializável, ID de revisão, cancelamento e descarte de respostas atrasadas. Manter o handle do core sob responsabilidade da sessão.
- Ao atingir o orçamento, usar o melhor candidato válido já encontrado; tratar o orçamento como limite cooperativo, não como garantia de interrupção automática de qualquer rotina síncrona.

**Aceite:** acertar os cenários de letal e de ordem de ataques cobertos, não anunciar certeza sobre efeitos desconhecidos e manter a mesa responsiva no navegador móvel. Como alvo inicial após isolamento, medir p95 ≤ 100 ms e p99 ≤ 300 ms por decisão do Difícil em dispositivos definidos no relatório; calibrar os limites com medição real.

### Etapa 5 — Generalizar por motor do deck e separar dificuldades

**Prioridade P2. Dependências: ganho demonstrado nas etapas anteriores. Esforço relativo: grande e contínuo.**

- Separar compatibilidade exata de compatibilidade parcial. Declarar cartas obrigatórias, quantidades mínimas, substitutos autorizados e restrições de cada rota.
- Uma lista modificada só recebe as rotas cujos requisitos foram verificados. Indicar cobertura parcial e conservar a assinatura exata como opção confiável.
- Ampliar os sete decks que já ganharam decisões recentes antes de iniciar dezenas de perfis novos. Para cada deck, incluir abertura, resposta, recuperação e condição de vitória.
- Criar uma bateria Goat independente usando listas do repositório, começando por `starter-yugi`, `starter-kaiba`, `structure-zombie-madness` e `structure-fury`. São casos de regressão do produto; não representam por si uma amostra competitiva do formato.
- Fazer as diferenças de nível virem da capacidade de comparar alternativas: Fácil com visão local, Médio com linhas e recursos, Difícil com respostas adversárias e recuperação. Não enfraquecer artificialmente o Médio para melhorar o placar do Difícil.

**Aceite:** trocar uma carta flexível mantém apenas as rotas compatíveis; remover uma peça obrigatória desativa as rotas afetadas; cada novo perfil possui resultados documentados. Certificar força por conjunto de decks cobertos, sem extrapolar para toda a biblioteca.

## 6. Protocolo para afirmar que melhorou

### Três baterias separadas

| Bateria | Pergunta | Critério |
| --- | --- | --- |
| Legalidade e continuidade | A partida funciona? | Zero rejeições e erros nos cenários de regressão; limites e inconclusivas sempre discriminados. |
| Qualidade de decisão | A escolha preserva ou alcança o objetivo? | Casos reais com alternativas aceitáveis e resultado observado no core; incluir situações contrárias à regra aprendida. |
| Força em partidas | O bot vence mais de forma sustentada? | Avaliação reservada, pareada e estratificada por deck, adversário e posição inicial. |

Para a bateria de força:

1. Separar sementes de desenvolvimento e de validação antes de ajustar pesos. O avaliador atual aceita `BOT_SEED_OFFSET`; a separação ainda precisa ser definida e respeitada no processo.
2. Comparar candidato contra a versão congelada, Médio e adversários de estilos distintos. Incluir espelhos e confrontos cruzados. O avaliador atual usa espelho e o próximo deck na lista; ampliar essa matriz explicitamente.
3. Preservar decks e compras por assento e inverter as políticas dentro de cada par. Nos confrontos assimétricos, reportar também qual política pilotou cada deck e executar a orientação reversa do confronto quando necessário.
4. Planejar inicialmente pelo menos 256 pares por comparação principal, distribuídos pelo painel. Isso é ponto de partida para medir incerteza, não garantia de significância por deck.
5. Usar intervalo de confiança que reamostre pares de sementes inteiros, estratificado por confronto, em vez de tratar cada partida como independente. Preservar também o agrupamento quando a mesma seed for reutilizada entre comparações.
6. Contar vitória como 1, empate real como 0,5 e derrota como 0 para a pontuação principal. Publicar também a taxa de vitória em partidas decididas. Inconclusivas ficam fora dessa pontuação e aparecem separadamente; aumento delas impede aprovação automática e exige investigação.
7. Definir previamente a meta: candidato com pontuação ≥ 55% contra a versão congelada e limite inferior do IC de 95% acima de 50%, no painel reservado. Exigir evidência equivalente para anunciar Difícil superior ao Médio. Sem isso, a conclusão continua inconclusiva.
8. Inspecionar resultados por deck e lado inicial. Uma melhora agregada não autoriza esconder uma regressão clara num perfil; investigar quedas acima de 5 pontos percentuais, considerando a incerteza.
9. Revisar uma amostra de partidas com jogadores que conheçam os decks antes de afirmar nível competitivo. Comparação contra o próprio bot mede melhoria relativa.

O tamanho da amostra e as metas devem ser fixados antes da avaliação final. Não repetir a bateria reservada com novos ajustes até encontrar um resultado favorável; depois de usada para orientar mudanças, aquela amostra passa a ser de desenvolvimento.

### Experimentos que atribuem o ganho

O avaliador já permite `hard-no-sequence`. Preservar essa comparação e adicionar chaves experimentais para avaliação de estado, memória adversária e recuperação. Comparar com e sem cada capacidade nas mesmas condições permite descobrir qual parte melhora o jogo e qual só aumenta custo.

Métricas auxiliares: oportunidades de letal aproveitadas, recursos essenciais desperdiçados, sucesso de recuperação nos cenários elegíveis, divergências entre previsão e core, origem das decisões, tempo e partidas inconclusivas. Reduzir fallbacks sozinho não é critério de inteligência.

## 7. Ordem de entregas revisáveis

| Entrega | Conteúdo | Condição para avançar |
| --- | --- | --- |
| PR 1 | Baseline isolada, trace completo, relatório atual e primeiros casos de decisão ruim | Problemas reproduzíveis e métricas atribuíveis. |
| PR 2 | Candidatos comparáveis, custo de oportunidade e opção de guardar | Melhora nos erros catalogados e preservação das rotas. |
| PR 3 | Timing de respostas e memória pública aplicada | Casos de gastar/guardar e não interferência de informação oculta passando. |
| PR 4 | Recuperação e sequência adaptável em Albaz/Phantom Knights | Resultados confirmados pelo core após interrupção. |
| PR 5 | Combate, orçamento e isolamento da análise quando necessário | Ganho tático sem perda de responsividade. |
| PR 6 | Avaliação reservada e expansão gradual de perfis/listas | Ganho de força demonstrado, com limitações publicadas. |

Cada entrega deve incluir cenários motivados por comportamento real, uma comparação contra a referência e um relato do que melhorou ou permaneceu inconclusivo. Alterações em código devem seguir o `AGENTS.md` e ler a documentação local pertinente do Next.js antes da implementação.

## 8. O que deixar para depois

- LLM tomando cada decisão durante o duelo: acrescenta variabilidade e latência sem resolver legalidade, observabilidade ou avaliação. Pode ajudar offline na autoria de casos e descritores, sempre validados.
- Aprendizado por reforço amplo: depende de ambiente reproduzível, observações corretas, adversários, métricas e orçamento de treino. Primeiro construir essas bases; depois comparar uma política aprendida contra a referência forte.
- Mais profundidade sobre um modelo que prevê efeitos incorretamente: priorizar fidelidade dos efeitos cobertos e medir erro de previsão.
- Conversão automática de todos os textos de guias em combos executáveis: exigir pré-condições, efeitos e testes no core.
- Reescrita integral do cérebro antes de medir: extrair componentes conforme necessário para as entregas, preservando a cobertura existente.

**Primeira ação recomendada:** executar a etapa 0 e usar o catálogo resultante para selecionar as primeiras correções da etapa 1. O objetivo da primeira versão é demonstrar decisões melhores e ganho mensurável nos decks cobertos, com uma base que permita ampliar essa qualidade depois.
