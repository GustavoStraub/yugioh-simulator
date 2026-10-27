# Bot: decisões com retorno — 27/10/2026

Os duelos locais, a revanche e o modo de assistir agora usam Difícil nos dois
assentos. Configurações antigas são normalizadas ao carregar e salvar. Os modos
anteriores permanecem no cérebro exclusivamente para comparações do harness.

## Problema encontrado e correções

O cérebro atribuía pontos positivos a efeitos desconhecidos apenas por serem
oferecidos pelo motor. Legalidade não demonstra vantagem: Nobleman pode ter
somente um alvo próprio, Tornado Dragon pode destruir a própria armadilha, e
Tracer pode trocar o próprio Tuner por outro corpo sem desenvolver o campo.

`effect-value.ts` acrescenta avaliação específica, conferida nos scripts Lua
fixados do projeto. A identidade inclui o índice do efeito: uma remoção e uma
reanimação da mesma carta não recebem a mesma decisão.

- Recusa remoções cobertas quando não há alvo adversário do tipo/posição correto.
- Inclui Magias de Campo na análise e dá valor às próprias armadilhas; ATK zero
  não significa que uma carta seja descartável.
- Compara o alvo removido ao recurso perdido em Scrap Dragon, Diamond Dire Wolf
  e Break Sword. Considera a recuperação de dois Cavaleiros de mesmo Nível.
- Preserva Tracer quando só seria possível trocar seu próprio corpo sem ganho;
  permite destruir Quick Launch em resolução, preservando o Tuner.
- Não gasta Tufão para destruir uma Magia Normal em resolução como se isso
  negasse o efeito. Magias Contínuas, de Campo e Equipamentos são distintos.
- Stardust não nega a própria jogada; a reanimação continua disponível.
- Rotas e decisões de `/aprender` passam pelas mesmas verificações. As decisões
  dos guias que recomendam guardar recursos também participam da análise normal.
- A leitura do tabuleiro é reaproveitada dentro de cada decisão, preservando a
  distinção entre leitura parcial e completa para não multiplicar consultas WASM.

## Validação

`npm run test:bot-resources` cobre decisões de Main Phase, corrente, efeitos
opcionais, escolha de alvos, migração do nível e oito cenários na DuelSession
real. Comprova preservação e remoções favoráveis de monstro e Magia de Campo.

Também passaram as baterias de decisões, rotas, motores de arquétipo, evolução,
TypeScript, lint dos arquivos alterados, build de produção e o teste de lobby,
revanche e espectador no Chrome.

Contra o piloto guloso, o bot venceu 41/60 partidas Goat e 15/20 TCG, com todos
os duelos concluídos. A primeira amostra de 20 Goat ficou em 12/20, abaixo do
limite de 65% desse teste; o cérebro anterior obteve os mesmos 12/20 nessas
sementes. Isso motivou a execução da bateria completa de 60.

A amostra exploratória contra o cérebro congelado antes desta revisão teve
32 partidas TCG (14 vitórias, 18 derrotas) e 32 Goat (15 vitórias, 17 derrotas),
sem erros, respostas rejeitadas ou limites de execução. Essa amostra **não
demonstrou ganho geral de força**; os resultados comprovados são as decisões e
consequências dos cenários dirigidos. Relatórios locais:
`.cache/bot-evaluation/resource-review-{tcg,goat}.json`.

## Limite de cobertura

Esta revisão acrescenta modelos para as cartas listadas em `effect-value.ts`.
Efeitos ainda não modelados conservam a heurística genérica. O bot não aprende
automaticamente com partidas nem compreende todo texto de carta. Os guias são
uma fonte de decisões condicionais e sequências; ampliar a qualidade em outros
decks exige ampliar essa cobertura e medir novamente.
