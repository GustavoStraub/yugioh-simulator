# Slifer — revisão individual de 27/10/2026

Primeiro deck desta rodada de aprofundamento. Foram lidas as 38 cartas distintas
da lista oficial de 40 cartas, conferidos os nomes e efeitos na lista Konami e
consultadas as páginas individuais das interações principais. A composição do
preset não foi alterada: três Ahrima, uma cópia das demais cartas e Extra vazio.

O guia `/aprender/tcg-egs1` passou de duas para 13 lições, com explicação do
motivo de cada etapa, oito decisões comentadas e função estratégica para todas
as cartas. A classificação mudou para Intermediário pela gestão de ordem,
custos, formas de invocação e bloqueios, sem implicar força competitiva.

## Conteúdo que faltava

- Ahrima como acesso ao Campo e como conversão de Tributo adversário em recurso.
- Compra versus busca: Duke Shade e Vishuda são alvos; Slifer DIVINO não é.
- Covil e Controlador de Inimigos: um adversário paga o custo, outro é tomado.
- Covil substitui custo de efeito; Cruzar Almas permite os Tributos da invocação.
- Reator e Skyblaster precisam de uma janela de Invocação-Tributo depois da Normal.
- Avanço e O Nome Verdadeiro usam informação do topo; a Especial do Slifer é temporária.
- Gestão de mão, destinos das cartas em Ataque Força Trovão e proteção compatível
  com a forma de invocação do Deus.
- Recuperação, alternativas sem Slifer e diferenças entre tributar, destruir e enviar.
- Duke Shade e a ordem do Campo: a alteração de atributo não deve ser tratada como
  uma autorização genérica para novas Especiais depois do bloqueio.

## Fontes

As fontes ficam junto às cartas, lições e decisões no app. Referências centrais:

- [Lista oficial do produto](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&pid=2000001116000&request_locale=en&rp=99999).
- [Ahrima](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13684&ope=2&request_locale=en),
  [Covil](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13686&ope=2&request_locale=en)
  e [Cruzar Almas](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=15838&ope=2&request_locale=en).
- [Slifer](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=4999&ope=2&request_locale=en),
  [Reator](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=15330&ope=2&request_locale=en),
  [Avanço](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=11425&ope=2&request_locale=en)
  e [O Nome Verdadeiro](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12239&ope=2&request_locale=en).
- [Duke Shade](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13685&ope=2&request_locale=en)
  e [seu script no commit fixado do projeto](https://github.com/ProjectIgnis/CardScripts/blob/a30bd15c0fc5fad951762420c55f5e0b96f596ea/official/c12766474.lua).

As estratégias são sínteses autorais adaptadas à lista. O teste de ordenação
com Duke é evidência de comportamento do motor usado pelo app; não é apresentado
como tradução de uma resposta oficial específica que não foi encontrada.

## Evidência e limites

`npm run test:slifer-guide` verifica o conteúdo e 14 situações no core:
busca do Campo, Tributo adversário e busca de Vishuda; Controlador; Reator com
e sem Avanço; Skyblaster com corpo prévio; Cruzar Almas com três adversários;
Nome Verdadeiro seguido da saída do Slifer Especial; impossibilidade de usar
Covil sozinho na Normal; Ficha final; quatro ordens de Ficha/Covil/Duke; e
recuperação de Vishuda por Duke. Usa a lista completa, retirando as cartas
colocadas na mão e mesa para não duplicar cópias. Não tolera RETRY ou erro Lua.

Oito lições têm sequências com essa evidência; as demais mantêm revisão editorial
baseada nos efeitos. Todas continuam sendo leituras, sem botão de exercício
roteirizado inventado. As 12 práticas anteriores de outros decks permanecem.

`npm run test:browser-slifer-guide` confere as 13 lições, raciocínios, leitura de
cartas, oito decisões, fontes e celular. A revisão 2 separa o progresso da versão
anterior, pois as duas lições antigas também foram substancialmente reescritas.

O índice do bot foi regenerado e vincula a lista exata à política de Slifer.
`slifer-strategy.ts` traduz as lições em avaliações de ações, custos, alvos,
opções e informação do topo, com `guideLesson` nos diagnósticos. A abertura de
Ahrima também usa os sinais genéricos; as demais decisões da página continuam
como estudo, enquanto a política verifica seu contexto dinâmico diretamente.

`npm run test:bot-slifer` executa 17 cenários com o próprio bot escolhendo todas
as ações: inclui os dois assentos, recusa de gastos sem retorno, limite de Covil,
proteção do Campo e preservação da mão. Também verifica invalidação do topo após
compra, embaralhamento ou reordenação desconhecida, Main 2, listas incompatíveis
e uma sessão com worker real completando Avanço → Nome Verdadeiro → Reator → Slifer.

A política só entra para a assinatura revisada de `tcg-egs1`, inclusive no modo
de assistir. Não interpreta texto livre nem a ordem oculta do Deck. Os próprios
movimentos da ordenação conhecida não invalidam o que o bot acabou de observar;
mudanças posteriores invalidam. O motor decide quais ações e candidatos são legais.

Na amostra exploratória de oito pares com assentos trocados (16 partidas), a
política venceu 11 e perdeu cinco contra o cérebro congelado imediatamente antes
dessa integração, sem erros, RETRY ou limites de execução. É evidência pequena
de desenvolvimento, sem certificação de força competitiva. Relatório local:
`.cache/bot-evaluation/slifer-policy.json`.

O teste `BOT_PRESET=tcg-egs1 node tools/harness/test-browser-bot-worker.mjs`
também confirmou o vínculo no Chrome real, com viewport móvel e CPU reduzida:
worker ativo, decisões relacionadas às lições de Ahrima/Covil e nenhum erro do
worker. O texto de cobertura do lobby identifica esse plano para o deck revisado.

Os outros 91 guias mantêm seu conteúdo e revisão. Próximos decks devem passar
por pesquisa individual e verificação das interações, sem expansão automática
de resumos para toda a biblioteca.
