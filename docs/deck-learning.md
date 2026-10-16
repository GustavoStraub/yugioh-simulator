# Aprender os decks

A área `/aprender` apresenta guias editoriais para os decks oficiais do
catálogo. Estão disponíveis Albaz Strike e os três decks de Heróis Lendários de 2018: Aesir, Destiny HERO e Cavaleiros Fantasmas. Cada guia mantém a lista exata de seu preset e três exercícios validados no motor.
O conteúdo é carregado dos JSONs do projeto; pesquisar as fontes é uma etapa
de autoria, sem consulta ou geração de aulas durante a navegação do jogador.

## Organização

- `src/data/deck-guides/<slug>.json`: um guia por lista de deck.
- `src/lib/domain/deck-guide.ts`: contrato do conteúdo, comparação com a lista
  revisada e leitura segura do progresso.
- `src/lib/data/deck-guides.ts`: registro dos guias disponíveis.
- `src/components/learning/`: biblioteca, leitor de lições e apresentação.
- `src/hooks/useGuideProgress.ts`: progresso local, separado por jogador, guia
  e revisão do conteúdo.

O JSON referencia cartas por passcode. Imagens e textos completos continuam
vindo do catálogo compartilhado e respeitam a seleção PT/EN. A explicação
editorial está em português.

## Campos do guia

| Campo | Finalidade |
| --- | --- |
| `schemaVersion` | Versão do contrato; atualmente `1`. |
| `id`, `presetId` | Identidade da trilha e vínculo com a lista existente. |
| `revision`, `reviewedAt` | Revisão editorial e data da conferência das fontes. |
| `deckSnapshot` | Principal, Extra, Side e formato usados na revisão. |
| `title`, `subtitle`, `description`, `difficulty`, `minutes`, `tags`, `coverCodes` | Apresentação da trilha. |
| `overview` | Objetivo, plano, pontos fortes e cuidados. |
| `keyCards` | Passcode, nome de referência, função, explicação e fontes. |
| `lessons` | Mão inicial, roteiro, dicas, etapas e objetivo na mesa. |
| `sources` | Referências identificadas por ID, título e URL. |

Cada lição contém `id`, `title`, `summary`, `minutes`, `sourceIds`,
`preparation`, `startingHand`, `steps`, `outcome`, `cautions` e `practice`.
Cada passo contém `title`, `action`, `why` e `cardCodes`.
`practice` contém as condições do objetivo (`goal`) e as etapas (`stages`). Cada etapa tem título, instrução, explicação e condições de conclusão (`completeWhen`). Condições verificam cartas em zonas, pontos de vida ou escolhas oferecidas pelo motor. Alvos podem limitar o destaque a ações (`scope: "action"`) ou seleções (`scope: "selection"`), evitando indicar como custo uma carta cujo efeito deve ser ativado.

O snapshot permite detectar mudanças de cartas, quantidades ou formato sem
depender da ordem do arquivo gerado. Quando diverge, o guia avisa que precisa
de revisão e desabilita seu atalho de prática. Não editar os arquivos de
presets gerados para acomodar uma aula.

## Produzir outra trilha

1. Escolher um preset e conferir sua composição exata e as quantidades.
2. Consultar o produto, os efeitos e as regras oficiais. Referências de
   jogadores podem ajudar na pesquisa; a sequência deve ser adaptada à lista
   do app, com explicações próprias e links das fontes.
3. Preencher o JSON seguindo o contrato. Copiar a lista revisada para
   `deckSnapshot`; não usar a composição atual dinamicamente como snapshot.
4. Montar mãos possíveis, declarar as condições e explicar custos e
   restrições. Descrever os exemplos como jogadas possíveis naquela situação.
5. Reproduzir cada sequência no ocgcore com a lista completa, removendo da
   pilha as cartas já colocadas na mão. Conferir o estado final e os recursos
   gastos. Os testes de Albaz e Heróis Lendários demonstram esse processo para as doze rotas.
6. Registrar o guia em `DECK_GUIDES`, acrescentar suas verificações no harness
   e conferir a apresentação no navegador.
7. Ao alterar lista ou lições, revisar as fontes e incrementar `revision`.
   Isso evita carregar conclusões de uma versão anterior como progresso novo.

## Validação

```sh
npm run test:deck-guides
npm run test:browser-deck-guides
npm run test:browser-lesson-practice
npm run lint
npm run build
```

O teste de conteúdo confere a composição revisada, referências, mãos,
objetivos, etapas e isolamento do progresso. As três rotas de Albaz são executadas
no ocgcore em regras TCG: Lubellion até Jadespelho, Albion até Jadespelho e
Kitt buscando o início da primeira sequência. Também confere descarte,
devolução e destino dos materiais.

O teste de navegador usa Chrome e o servidor em `APP_URL` (padrão
`http://127.0.0.1:3000`). Cobre biblioteca, busca, leitura de cartas, retomada, outro jogador, telas estreitas, fontes, 404 e o
início de um duelo com a lista oficial. Capturas vão para
`.cache/shots/learning`.

## Exercícios na mesa

Cada lição abre `/aprender/<guia>/treinar/<lição>` com as cinco cartas de
`startingHand`. A sessão retira essas cópias do Principal antes de colocá-las
na mão e desliga a compra inicial automática para os dois assentos. O total
da lista é preservado. O restante do deck continua embaralhado.

O jogador executa as ações na mesma mesa e no mesmo motor dos duelos. Um
parceiro de treino aguarda enquanto a lição acontece no primeiro turno. As
dicas avançam com evidências dos snapshots: seleções oferecidas, materiais,
descarte e cartas em campo. O objetivo só conclui após resolver os efeitos e
voltar a uma decisão livre, sem corrente pendente.

Cada etapa também declara `targets`: passcode, localização do motor e,
opcionalmente, controlador (padrão: jogador 0). A moldura magenta tracejada
com o selo **GUIA** indica somente os alvos que o motor oferece no prompt
atual. Vale na mão, campo, listas de materiais, pilhas e efeitos; sai ao
selecionar a carta e acompanha a mudança de etapa. Ela ocupa uma camada
independente dos brilhos de ações e respeita a preferência por movimento
reduzido. Os duelos livres não recebem esse destaque.

Concluir o objetivo salva a lição no progresso; ler o roteiro não a conclui.
A revisão `2` do piloto separa esse progresso das antigas perguntas. O jogador
pode esconder as dicas, recomeçar com a mesma mão, repetir após concluir e ir
ao próximo exercício. Encerrar o turno antes do objetivo pede uma nova tentativa.
Ao sair ou recomeçar, a sessão anterior libera seu handle do motor.

`test:browser-lesson-practice` executa as três rotas com cliques na interface,
confere a mão inicial, reinício e progresso final. Capturas incluem desktop e
celular em paisagem. O atalho adicional contra o bot continua sendo um duelo
livre com compras aleatórias.
