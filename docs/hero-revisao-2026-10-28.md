# HERO — revisão individual de 28/10/2026

Deck revisado: `tcg-lehd-destiny-hero`, Heróis Lendários de 2018. Mantida a lista
oficial de 40 cartas no Principal e 10 no Extra, com 38 cartas distintas. Foram
lidos os textos das 38 cartas no catálogo e confrontadas as interações centrais
com a coleção e páginas oficiais Konami. As estratégias são sínteses autorais
para esta lista, sem adicionar cartas de outras versões de HERO.

O guia `/aprender/herois-lendarios-destiny-hero` está na revisão 2: 13 lições,
12 exercícios executáveis e uma leitura sobre a recuperação de Celestial.
As três práticas anteriores foram preservadas e nove práticas foram acrescentadas.
As cinco estratégias antigas foram revisadas: quatro agora têm execução na mesa;
a leitura de Celestial continua explicando o turno posterior e mão vazia, sem
apresentar uma compra impossível no primeiro turno como exercício concluído.
Todas as 38 cartas têm explicação estratégica individual.

## Exercícios novos

- Sacar o Destino descarta Malicioso: compra e extensão preservando a Normal.
- Homem em Chamas envia Névoa, busca Broca-negra e vira TREVAS para Lei Obscura.
  O bloqueio de Fusões permite o Mascarado, mas impediria reanimar Névoa.
- Perigoso distingue descarte de custo e envio do Deck, preparando Malicioso.
- Dinatag altera Distopia e libera a destruição: o exercício usa sua própria
  Torre como alvo de demonstração e explica por que não repetir isso sem ganho
  em partida real. O bot é testado removendo uma ameaça adversária.
- Broca-negra e Malicioso dão acesso a Condutor Maravilha; uma nova Invocação
  na seta recupera Polimerização. A Magia Normal pode ser usada naquele turno;
  Mudar a Máscara Baixada deve esperar.
- Além do Destino usa Malicioso como alvo de Nível 6 antes de seu banimento:
  Sonhador, Malicioso e Distopia podem virar os três Tributos de Plasma.
- Plasma e Dogma da mão fazem Dragão Final sem suas Invocações individuais.
- Distopia e outro HERÓI do Destino fazem Dusktopia; o roteiro explica o custo,
  a Fusão adicional e a proteção que também impede dano de batalha do alvo.
- Dizimador preserva Distopia e o aumenta a 3100 ATK pela seta, com três nomes
  HERO distintos no Cemitério. O objetivo verifica o ATK atual no motor.

## Fontes

Referências clicáveis também ficam nas lições e cartas do app:

- [Coleção oficial LEHD](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&pid=18812002&request_locale=en&rp=99999).
- [Névoa Sombria](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=11308&request_locale=en).
- [Perigoso](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=12694&request_locale=en).
- [Dinatag](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=12703&request_locale=en).
- [Condutor Maravilha](https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=13543&request_locale=en).

## Bot e validação

`hero-strategy.ts` recebe somente a assinatura exata da lista revisada, na
dificuldade Difícil, também no modo de assistir. Usa mão própria, zonas públicas,
quantidades conhecidas da própria lista e candidatos legais oferecidos pelo motor;
não consulta a ordem oculta do Deck. Decisões e diagnósticos apontam à lição. O perfil histórico foi atualizado
para referenciar a revisão 2 do guia, mantendo suas três rotas anteriores.
Integra prioridades de Normal, Máscara, Fusão, descarte, envio, materiais,
recuperação e alvos; preserva Malicioso ainda útil, evita destruir seu próprio
campo com Distopia e não paga o descarte de Perigoso só por ATK sem continuação.
Dizimador e Condutor preservam os chefes na escolha dos materiais; Dusktopia
prioriza proteção defensiva no turno adversário. São avaliações contextuais,
sem promessa de executar sempre a mesma sequência ou de força competitiva.

Validações:

- `npm run test:deck-guides`: integridade dos guias, práticas anteriores e as
  nove sequências novas no ocgcore. Sem RETRY nem erro Lua.
- `node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-bot-hero.mjs`:
  nove cenários com o próprio bot escolhendo ações, materiais, custos e alvos.
  Inclui Máscara nos dois assentos e preservação do próprio campo.
- `npm run test:deck-learning-base`: 92 guias, 224 lições, 21 práticas;
  vínculo de listas, fontes, progresso e decisões.
- `npm run test:bot-strategy` e `npm run test:bot-decisions`: rotas históricas,
  decisões editoriais e sessões integrais, incluindo os outros decks. As nove
  práticas novas são verificadas separadamente pelos testes do guia e da política.
- `npm run test:bot-slifer`: regressão da política anterior e sessão com worker.
- `node tools/harness/test-browser-hero-guide.mjs`: 12 exercícios acessíveis,
  inicialização do treino no Chrome, desktop e celular sem overflow.
- `BOT_PRESET=tcg-lehd-destiny-hero node tools/harness/test-browser-bot-worker.mjs`:
  política HERO carregada no worker real, cinco decisões, CPU móvel emulada e
  nenhum erro. A mão aleatória não exerceu as sequências nessa amostra; elas
  são verificadas nos nove cenários determinísticos do bot.
- TypeScript, ESLint dos arquivos alterados e build de produção.

O estado inicial dos exercícios usa cinco cartas retiradas do Principal completo,
e não cópias adicionais. O progresso passa à revisão 2 para não considerar as
novas práticas concluídas pelo progresso antigo. As condições de treino agora
podem conferir o Campo e o ATK de um monstro, além das zonas já suportadas.
