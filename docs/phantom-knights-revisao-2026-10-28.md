# Cavaleiros Fantasmas — revisão individual de 28/10/2026

Deck: `tcg-lehd-phantom-knights`, Heróis Lendários de 2018. A lista permanece
com 40 cartas no Principal e 10 no Extra, totalizando 40 cartas distintas.
Foram lidos todos os textos do catálogo, consultados os textos oficiais das
interações centrais e verificados os scripts fixados usados pelo projeto.
As estratégias são sínteses autorais para essa lista: sem Torn Scales,
Cherubini, Raider's Knight ou Arc Rebellion, que não fazem parte do preset.

O guia `/aprender/herois-lendarios-cavaleiros-fantasmas` passa à revisão 2:
13 lições, todas com treino na mesa; 40 leituras estratégicas individuais e
10 decisões comentadas, sendo quatro novas. As três práticas anteriores foram
preservadas, as cinco leituras anteriores viraram exercícios e outras cinco
práticas foram adicionadas. A revisão separa o progresso anterior.

## Estratégias praticadas

- Espada Quebrada destrói a si mesma e uma carta adversária; recupera dois
  Cavaleiros de mesmo Nível como Níveis 4 e abre Rebelião, respeitando TREVAS.
- Rebelião gasta os dois materiais com ganho de ATK, permitindo Launch.
  Réquiem recebe Rebelião e Launch como materiais; o exercício usa Launch
  como custo seguinte, preservando Rebelião e os efeitos concedidos.
- Bardiche destrói a própria Espada corretamente Invocada por Xyz para
  converter seus materiais em um Classe 4 defensivo, Pesadelo.
- Luvas envia Lâmina ao Cemitério para reanimar um Cavaleiro; virar material
  Xyz evita o banimento ao deixar o campo imposto pela reanimação.
- Brigandina é resolvida sem Armadilhas no Cemitério e combina com Armagedom
  para Classe 4. Não se atribui bloqueio de Invocações a Rhongomyniad de dois materiais.
- Luvas usada do campo em Espada concede 1000 ATK: o treino verifica 3000 ATK.
- Furão usa duas setas livres de Bardiche e escolhe Manto + Botas, somando
  exatamente seis Níveis; os corpos negados viram um Xyz que gera remoção.
- Tornados Gêmeos descarta Launch, limpa duas cartas adversárias e prepara
  sua outra função: associar um Cavaleiro da mão a um Xyz TREVAS.
- Lâmina nega um Monstro de Efeito, chega ao Cemitério quando seu alvo sai
  e reanima um material no mesmo turno. Explica-se que ela também impede
  atacar o monstro afetado, podendo prejudicar o próprio dano.
- Manopla Perdida transforma Manto em Nível 2 e entra como segundo Nível 2;
  Lança Amaldiçoada zera ATK e nega um monstro adversário.

Os cenários com Bardiche já em campo representam continuação: não certificam
sua Invocação inicial, coberta pela prática anterior. As mesas com Armadilhas
já Baixadas representam preparação em turno anterior; não ensinam ativar uma
Armadilha recém-Baixada sem a exceção de Brigandina.

## Fontes

As fontes ficam junto às lições e cartas no app. Referências centrais:

- [Coleção LEHD](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&pid=18812002&request_locale=en&rp=99999).
- [Espada Quebrada](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12203&ope=2&request_locale=en)
  e [Bardiche](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=14054&ope=2&request_locale=en).
- [Launch](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12644&ope=2&request_locale=en)
  e [Réquiem](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12639&ope=2&request_locale=en).
- [Lâmina](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12205&ope=2&request_locale=en),
  [Brigandina](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12267&ope=2&request_locale=en),
  [Furão](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=13068&ope=2&request_locale=en)
  e [Manopla](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12980&ope=2&request_locale=en).

## Integração e evidências

`phantom-strategy.ts` só é carregado no Difícil para a assinatura exata da lista,
inclusive no modo de assistir. Prioriza buscas, ordem de Brigandina, materiais,
setas, recuperação e alvos por contexto. Preserva Rebelião sob Réquiem e Botas
como o material preferido quando seu envio gera busca. A política acompanha
suas próprias Invocações-Xyz de Espada: não presume recuperação só porque uma
Espada aparece no campo. O motor continua decidindo ações e candidatos legais.
O perfil histórico referencia a revisão 2 e mantém suas três rotas.

- `npm run test:deck-guides`: dez sequências novas e todas as práticas anteriores,
  sem RETRY ou erro Lua. Verifica ATK, Níveis, materiais associados e mesa adversária.
- `node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-bot-phantom.mjs`:
  12 cenários com escolhas do bot, incluindo ambos os assentos, custos de Réquiem,
  Brigandina bloqueada e Furão sem setas. Uma sessão adicional com worker real
  e perfil automático completa Espada → Rebelião → Réquiem.
- `npm run test:deck-learning-base`: 92 guias, 229 lições, 31 práticas e 40 decisões,
  com listas, referências e progresso verificados.
- `npm run test:bot-strategy` e `npm run test:bot-decisions`: regressões das rotas
  e decisões anteriores em sessões reais.
- `node tools/harness/test-browser-phantom-guide.mjs`: 13 exercícios acessíveis;
  duas sequências completas por cliques, progresso salvo e mesa preparada no celular.
- `BOT_PRESET=tcg-lehd-phantom-knights node tools/harness/test-browser-bot-worker.mjs`:
  política confirmada no worker do Chrome com CPU reduzida e decisões vinculadas
  a seis lições, sem erros do worker.
- TypeScript, ESLint dos arquivos alterados e build de produção.

`practiceSetup` retira cada carta preparada da lista antes de montar a mesa,
valida quantidades e zonas e preserva as cinco cartas da mão. As condições de
objetivo agora também distinguem jogador, Nível, negação e materiais associados.
As dicas diferenciam ações, seleções e gatilhos para não sugerir uma ativação
quando a etapa pede somente selecionar um material.

Os testes demonstram os cenários descritos, não força competitiva ou cobertura
exaustiva de todos os confrontos. Não houve mudança na legalidade dos presets.
