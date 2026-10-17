# Inteligência dos bots — implementação e avaliação

Registro de 17 de outubro de 2026. A proposta continua em
[inteligencia-bot.md](inteligencia-bot.md). Este registro separa funcionalidades
entregues de critérios de força que ainda precisam de comprovação.

## Código disponível

- Fácil, Médio e Difícil no lobby, com Médio como padrão. `StoredDuelSetup`
  normaliza configurações antigas. A revanche conserva o nível, e bot × bot
  permite níveis diferentes para cada lado. Exercícios conservam seu parceiro
  de treino e não usam a preferência do lobby.
- `difficulty.ts` define análise, limites e desempate reproduzível com semente
  independente do core. Fácil usa prioridades locais. Médio executa rotas
  principais. Difícil compara também variações revisadas, hipóteses de resposta,
  exposição e continuidade. Esses comportamentos diferentes não são uma
  certificação de força competitiva.
- `knowledge.ts` acompanha corrente, efeito em resolução, alvos anunciados,
  negações e fatos revelados por assento. Embaralhamentos e movimentos invalidam
  associações de identidade com posições. Hipóteses ficam separadas dos fatos.
- O cérebro recebe apenas sua lista, tabuleiro por assento e prompts filtrados.
  Seleções da mão adversária e tributos/somas envolvendo monstros ocultos
  também passam pelo filtro. Não recebe `opponentId`, lista adversária, ordem
  dos Decks ou semente do duelo. As duas memórias são independentes.
- `deck-profile.ts` confere contrato, formato, Main/Extra/Side com quantidades
  e revisão do guia. Uma lista diferente ou perfil indisponível usa o cérebro
  genérico. Apenas os perfis candidatos são carregados por importação dinâmica.
- `planner.ts`, `intent.ts`, `evaluator.ts` e `effect-handlers.ts` preservam
  intenção entre ativação, custo, opção, busca, materiais e resolução. As
  escolhas usam candidatos atuais. Negações e ações indisponíveis invalidam
  o plano; confirmação depende do estado observado. Custos alternativos
  preservam o acesso e a continuação declarados.
- `battle-planner.ts` compara ordens de ataques com busca limitada e recalcula
  depois de cada decisão real. É um modelo aproximado, sem clonagem do core
  nem prova de vitória contra efeitos que não modela.
- `response-validator.ts` confere índices, quantidades, somas, tributos,
  máscaras de posição, lugares, opções, declarações, ordenações e contadores.
  `RETRY` registra a rejeição e procura outra resposta. As proteções contra
  repetição acompanham progresso de estado, permitindo sequências longas.
- `decision-trace.ts` registra observação permitida, nível, perfil/revisão,
  rota, alternativas, escolha, motivo, reserva e tempo. O callback é privado e
  opt-in: não entra no snapshot, log público ou WebSocket. Uma falha do callback
  não altera a jogada.

Os modelos atuais usam uma fatia máxima de 12 ms por análise, menor que os
tetos de 25/100/300 ms da proposta. A leitura do campo continua preguiçosa e
memoizada. Não foi introduzido Worker porque esta busca é pequena; aumentar a
fatia ou adotar simulação ampla exige mover esse trabalho para fora da UI.

## Cobertura validada

| Lista exata | Planos principais | Variações adicionais no Difícil |
| --- | --- | --- |
| `tcg-sdaz` — Albaz Strike | Lubellion/Jadespelho, Albion/Jadespelho, acesso por Kitt | Custos alternativos nas rotas existentes |
| `tcg-lehd-aesir` | Thor, Odin, Loki com Gullveig | 19 inícios alternativos conferidos no core |
| `tcg-lehd-destiny-hero` | Distopia/Malicioso, Dark Law/recuperação, Plasma | Custo de D ao Cubo preserva Plasma e a continuação |
| `tcg-lehd-phantom-knights` | Espada Quebrada, Bardiche, Leviair/recuperação | Início por Luvas Gastas na rota Xyz |

São 12 rotas principais e 20 variações de início: 32 modelos explícitos.
`test:bot-strategy` executa 44 casos na `DuelSession`: as 12 rotas nos dois
níveis planejadores e as 20 variações no Difícil. Os casos isolam cada rota
para verificar seus ramos; `test:bot-decisions` usa o perfil integral para
verificar a escolha entre rotas e mãos alternativas.

Tyr foi excluído como início isolado de Gullveig: seu efeito de autodestruição
impede a sequência. Compartilhar arquétipo não bastou para publicar essa rota.

Os outros guias editoriais continuam com **estratégia específica em preparação**.
Não foram transformados automaticamente em instruções executáveis. Os 110
presets TCG continuam jogáveis pelo cérebro genérico, e a bateria de continuidade
exercita uma partida por preset. Isso não comprova domínio das 196 lições
editoriais ainda sem modelos de execução.

## Reprodução

```sh
npm run test:bot-strategy
npm run test:bot-decisions
npm run test:browser-bot
npm run eval:bot
```

O teste de navegador exige o app em execução em `APP_URL` (padrão
`http://127.0.0.1:3000`). Ele verifica seleção de nível e cobertura, bot começando,
revanche, bot × bot com níveis distintos, configuração antiga e largura móvel.
Só apaga a biblioteca do próprio perfil de teste.

O avaliador aceita `BOT_ROUNDS`, `BOT_DECKS`, `BOT_FORMAT`, `BOT_SEED_OFFSET`,
`BOT_REPORT` e `BOT_BASELINE` (caminho absoluto do módulo anterior, exportando
`BotBrain`). `BOT_COMPARISONS=medium:easy,hard:medium` seleciona confrontos.
O módulo anterior pode ser preservado em `.cache/bot-baseline/`, mantendo os
imports `@/` resolvidos pelo loader do harness. A revisão da referência consta
do relatório de avaliação.

Cada semente é jogada duas vezes, invertendo os cérebros nos assentos e mantendo
as compras por assento. Há espelhos e confrontos entre listas distintas. O
relatório JSON discrimina vitórias, derrotas, empates, inconclusivas, limites,
respostas rejeitadas, reservas e CPU por confronto, deck e assento. Partidas
interrompidas nunca viram vitórias. Os intervalos Wilson de 95% são descritivos
por partida; os pares compartilham sementes, e uma conclusão estatística mais
forte deve considerar essa dependência.

`test-bot.mjs` e `test-preset-decks.mjs` usam `bot-observer.mjs`, com o mesmo
`BotKnowledge` e filtragem da sessão. O teste antigo aceita `BOT_MAIN`,
`BOT_DIFFICULTY` e `BOT_RIVAL_DIFFICULTY` para repetir comparações. Sua alternância
de assentos ocorre por volta completa da biblioteca; uma execução curta no TCG
pode cobrir somente o assento 0. O novo avaliador usa pares desde o primeiro caso.

## Critérios ainda pendentes

A execução dos modelos e a continuidade dos duelos foram verificadas. A
superioridade sustentada do Médio sobre o Fácil e do Difícil sobre o Médio
**ainda não foi demonstrada na amostra reservada**.
Portanto, os critérios de força das etapas 3 e 4 continuam pendentes, e não há
certificação de jogo profissional para nenhum perfil. A revisão competitiva
por jogadores dos decks também permanece necessária.

A etapa 5 permanece aberta para converter e validar os outros guias. A entrega
inclui a infraestrutura de perfis, as quatro listas acima e suas variações,
mas não a cobertura estratégica integral da biblioteca. Modelos amplos de
respostas adversárias, continuação até o próximo turno e recuperação após
qualquer interrupção também exigem ampliar a cobertura explícita dos efeitos.

Os números e o protocolo do último ensaio estão em
[bot-evaluation-2026-10-17.json](bot-evaluation-2026-10-17.json). Aprovar todos os
testes de execução não encerra os critérios de qualidade que ficaram pendentes.


No ensaio final foram disputadas 2.560 partidas (512 por comparação), com
referência anterior contra ela mesma em 50,0%. Médio e Difícil venceram a
referência em 286/512 (55,9%; IC descritivo 51,5–60,1%). Médio contra Fácil ficou
em 270/510 decisões (52,9%; 48,6–57,2%), com duas partidas inconclusivas.
Difícil contra Médio ficou em 251/512 (49,0%; 44,7–53,3%). Não houve respostas
rejeitadas no ensaio. Esses resultados justificam manter abertos os critérios
de separação de força dos níveis, apesar do avanço relativo à referência.

Também passaram tipos, lint, build, 44 casos de rotas, os cenários de decisão,
as 330 partidas de continuidade dos presets (110 em cada nível), guias, base editorial, informação
oculta, multiplayer, aprendizado, prompts comuns/raros, marcas e alvos da corrente.
Os ensaios legados terminaram em 45/60 contra o passivo Goat e 46/60 contra o
guloso TCG; este último usou somente o assento 0 e não substitui o protocolo em pares.
