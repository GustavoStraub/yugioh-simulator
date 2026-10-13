# A tela de duelo no jeito do Master Duel

> Pedido do Gustavo, 13/10/2026: "refatorar o visual do duelo baseando-se
> **completamente** no Master Duel — efeitos, escolhas, correntes, resolução,
> informação das cartas, literalmente tudo", e, no meio do trabalho, "pegar a
> jogabilidade também": poder **cancelar** uma jogada enquanto ainda dá (o
> exemplo dele: cliquei "Invocar", o jogo pede a zona — ali devia dar para
> desistir).
>
> Segundo pedido, no mesmo dia: "uma geral no duelo em questão de UI/UX —
> praticamente uma refatoração visual completa; eu queria que ficasse
> **idêntico** ao Yu-Gi-Oh! Master Duel; estude o jogo em questão visuais",
> "o que você conseguir trazer de efeitos especiais também é muito bem-vindo",
> "qualquer dúvida, não adivinhe, me pergunte" — e tudo num branch separado,
> com PR no fim (§6).
>
> Este documento é a investigação, o que cada entrega mudou, o que ficou de
> propósito diferente do MD e as próximas fases. O plano anterior de UI/UX
> (`docs/ui-ux-plano.md`) copiou o **comportamento** do MD e do Tag Force
> sobre a arte de mesa do Tag Force; este troca a **aparência** inteira e
> volta ao comportamento onde o MD faz diferente.

## 1. Resumo

- **Segunda entrega** (branch `visual-master-duel-2`, §6): a mesa inteira
  refeita sobre **capturas reais** do jogo (~90 telas de jogadores na Steam,
  olhadas uma a uma — a primeira entrega só tinha lido texto). Tela cheia,
  campo neon em 3D com as cartas de pé, HUD dos cantos (placas de LP com
  dígitos quadrados, botão redondo de fase, botões Auto / "i" / "!" /
  registro), painel de leitura da carta do MD, comandos redondos, a "lista de
  cartas" de baixo para toda escolha e para a resposta na corrente, faixas de
  fase ("TURN CHANGE", "BATTLE PHASE"), corte de invocação, seta de ataque,
  "Final Blow!", estilhaço, corrente com o número enorme, tela de VICTORY /
  LOSE, rachaduras na mesa conforme o LP cai.
- **Decisões do Gustavo** (perguntadas antes de começar): faixas e carimbos
  em **inglês estilizado** como no MD; mesa no estilo **neon/cibernético**
  (desenhada em código, sem arte da Konami); **botão único de fase** do MD
  (abandona a trilha DP…EP sempre à vista); **corte de invocação** nas
  invocações do Extra Deck, de Ritual e por Tributo.
- **Primeira entrega** (branch `visual-master-duel`, §3): a câmera 3D, a
  paleta azul-noite, as placas nos cantos, a zona escolhida antes do comando
  (cancelável, §4).
- **Limite do motor:** a escolha de zona e de posição **não têm cancelamento
  no ygopro-core** (só tributos e algumas seleções de carta têm). Por isso o
  cancelar da invocação funciona escolhendo a zona antes do comando, e só
  onde as zonas são previsíveis pela mesa (§4).

## 2. O que o Master Duel mostra — visto nas capturas

Primeiro levantamento (13/10/2026, de manhã): só texto — guias, notas de
atualização, wiki. Segundo (à tarde): as 8 capturas da página da Steam e ~450
capturas de jogadores na Steam Community, das quais ~90 telas de duelo foram
olhadas em resolução cheia (mesas de vários temas, o painel da carta, a lista
de cartas, a corrente, as faixas de fase, o "Final Blow!", a tela de vitória,
os cortes de invocação). O que segue é o que as capturas **mostram**; o que
continua sem confirmação está marcado.

| Tema | O que as capturas mostram | Ainda não confirmado |
|---|---|---|
| Mesa | Tela inteira, sem moldura de interface. Câmera alta atrás do jogador: as zonas do chão bem achatadas, as **cartas quase de pé** sobre elas (pouco achatadas). Cartas do oponente **de pé, legíveis** (não de cabeça para baixo); as setas Link dele são indicadores da mesa. Deck de pé no canto de baixo à direita, Extra Deck no de baixo à esquerda; **Cemitério e banidas são dois poços redondos** à direita da fileira de monstros (banidas em cima). A metade de quem perde LP **racha**. A borda da metade de quem joga acende (azul/vermelho). | — |
| ATK/DEF | Número grande embaixo das suas cartas e **em cima** das do oponente; ATK maior que o "/DEF"; valor acima do impresso em azul-claro. Estrela + Nível no pé direito da carta; material Xyz no pé esquerdo. | A cor do valor abaixo do impresso (usamos vermelho). |
| Cores | **Azul = jogada comum** (Invocar, Baixar, posição; atacar na Battle Phase) e **amarelo = ativar efeito** — na mão e no campo; as duas juntas quando a carta tem as duas. Alvo de escolha no campo: amarelo. | — |
| HUD | Engrenagem redonda em cima à esquerda; placa do oponente em cima à direita (nome numa faixa com fio vermelho, "LP 8000" grande, avatar sextavado); a sua embaixo à esquerda (avatar redondo); embaixo à direita os botões redondos Auto (ON/OFF), "i", "!" (com a contagem em cima) e registro. **Botão de fase**: disco "Turn N / Main1", azul com aro dourado no seu turno, sextavado vermelho no do oponente, na direita, na altura da linha do meio. LP fica **vermelho** quando baixo (≤ 1000 nas capturas). Relógio de turno em círculo à esquerda. | O desenho exato do menu do botão de fase (usamos pílulas ao lado dele). |
| Leitura da carta | Painel alto no canto de cima à esquerda, **por cima** do cenário: nome numa faixa com o círculo do atributo (kanji, em qualquer idioma), a carta à esquerda, Nível/ATK/DEF com ícones ao lado, faixa do tipo **na cor da moldura** ("[Dragão/Sincro/Efeito]"), texto rolável. Fundo vermelho na carta do oponente. | — |
| Escolhas | "Lista de cartas" num painel escuro **embaixo, no meio**: instrução no topo (palavra-chave em amarelo), "N cartas", a faixa azul de cartas com rolagem e setas, o botão de confirmar no pé (pílula escura com o fio verde-limão); abas no canto (grade, seta para baixo). Alvo no campo: faixa translúcida atravessando a mesa com a instrução. | — |
| Corrente | Ao responder: o mesmo painel de baixo, "O oponente ativou X. Ativar um efeito (corrente)?", com as cartas que respondem e Cancelar / Ativar. Elos: as cartas ativadas grandes, inclinadas, **ligadas por correntes de metal**, com o **número do elo enorme, vazado e brilhante**. Texto do efeito ativado numa caixa no canto de cima à direita. | Como o número "se quebra" na resolução; o carimbo da negação (usamos o "proibido" + NEGATED). |
| Faixas | "TURN CHANGE", "STANDBY PHASE", "BATTLE PHASE": faixa atravessando a tela, letras itálicas grossas metálicas — em inglês mesmo no jogo em outros idiomas. | A cor da faixa no seu turno (só vimos as vermelhas do oponente; usamos azul). |
| Invocação | Corte em tela cheia: a arte do monstro grande com raios de luz, as estrelas (ou "LINK-2"), o nome em itálico e "ATK 2400 DEF 1500" numa barra azul-escura. | Quais invocações ganham o corte — decidido pelo Gustavo: Extra Deck, Ritual e Tributo. |
| Batalha | Seta segmentada **azul** do atacante ao alvo. "**Final Blow !**" em duas faixas verde-limão verticais nas laterais quando o ataque é letal. Dano em número grande vermelho junto do LP. | — |
| Fim | A mesa desfocada, "**VICTORY**" (ou "FINISHED") gigante com um traço de luz, uma faixa com o motivo, as placas dos dois com a **coroa** do vencedor e o "OK". | A palavra da derrota (usamos "LOSE"). |

## 3. Primeira entrega — o que mudou na tela

Tudo em `DuelBoard.tsx`, `DuelCardSlot.tsx`, `ChainSpotlight.tsx`,
`ChainStack.tsx`, `useDuelFeedback.ts` e `globals.css` (bloco "Master Duel").

1. **Câmera 3D** (`.md-camera`/`.md-board`): só as quatro fileiras e as Zonas
   Extra deitam (`rotateX(22deg)`, perspectiva 1800 px, girando pela borda de
   baixo — nada cresce, então nada invade trilho nem sai da janela). Deitada,
   a mesa "desce" e abria um vão de ~60 px sob a mão do oponente (espaço
   morto, observação do Gustavo): a câmera sobe por baixo dela
   (`margin-top: -9vh`). E o teto da carta pela largura foi refeito para a
   mesa deitada (`.md-field`: 7,6 larguras de carta em vez de 8,3 — as
   fileiras de longe encolhem). Resultado: cartas 8–10% maiores em toda tela
   larga (1440×900 Goat 128 → 138 px de altura; 1880×1050 166 → 182 px). Mãos, avisos, voos e diálogos
   ficam em pé. Em tela baixa (≤ 500 px, celular deitado) a mesa fica
   **plana**: a inclinação achatava as fileiras e a perspectiva encolhia as de
   longe (no TCG a Zona Extra ficava com 28 px); ali a placa de LP também
   perde o nome e as mãos encolhem uns pixels. Os voos (ataque, compra, saída) leem
   `getBoundingClientRect`, que já devolve a caixa projetada.
2. **Paleta só no duelo** (`.md-duel`): os componentes falam `--tf-*`;
   redefinir os tokens no escopo do duelo troca a tela inteira sem tocar no
   construtor de deck. Tapete com grade sutil e brilho central; zona vazia é
   só o traço luminoso. Jogada disponível = contorno **amarelo**; alvo =
   **azul**; zona de destino = traço ciano.
3. **Placas de LP nos cantos** (`LifeBar`): a sua embaixo à esquerda (no pé da
   leitura da carta), a do oponente em cima à direita; avatar com anel azul ou
   vermelho, "LP" e o número **correndo** até o valor novo (`useContagem`,
   salta direto com "menos movimento"). O selo "Sua vez" virou aba no alto da
   placa. Na mesa estreita (≤ 900 px) elas voltam para a faixa do topo.
4. **Luz de quem decide**: anel pulsando no avatar de quem o jogo espera —
   o seu quando há pergunta para você, o do oponente enquanto ele joga.
5. **Mão do Master Duel**: sem caixa, cartas grandes na borda de baixo,
   encavalando só o necessário para caber (`passoDaMao`, em `cqw`/`cqh` da
   própria mão). A do oponente: versos no alto, do tamanho de carta de
   verdade (`clamp(56px, 9vh, 84px)` — com 48 px ficava miúda, observação do
   Gustavo), com a contagem ao lado. O aviso "Fulano está jogando…" saiu de
   cima dela: mora sob a placa do oponente, junto da luz de quem decide (na
   mesa estreita, logo abaixo da mão dele).
6. **Comandos em pé** (`CardActionMenu`): vão para o `body` por portal,
   ancorados na caixa da carta na tela, com ícone por verbo (o ícone vem por
   `::before`, fora do `innerText` — os testes escolhem a jogada pelo texto).
   Dentro da mesa inclinada o menu ficava deitado e o "clique fora fecha"
   deixava de cobrir a tela (um ancestral com `transform` vira o contêiner do
   `position: fixed`). Abre sempre **para cima** da carta, também no campo
   (pedido do Gustavo: ao responder na corrente, o "Ativar" abrindo para baixo
   caía sobre a mão) — só desce quando não cabe em cima. E desvia das barras
   de decisão (`data-menu-avoid`), para não tapar o "Não responder".
7. **Registro do duelo em gaveta** (botão "📜 Registro" no canto superior
   direito): a coluna que o histórico ocupava voltou para o campo. A gaveta
   fica montada mesmo fechada (`[data-duel-log]` continua legível).
8. **Leitura da carta por dono**: fundo azul se a carta é sua, vermelho se é
   do oponente, neutro quando não se sabe (lista de busca).
9. **Corrente azul/vermelha**: número do elo no slot, no destaque central e na
   pilha da corrente.
10. **Faixa de virada de turno** atravessando a mesa (azul / vermelha).
11. **Marca de carta escolhida** visível: era um `ring-2` do Tailwind que a
    `box-shadow` da zona sempre apagava (regra fora de camada vence
    utilitário); agora é `.tf-slot-picked`, anel verde.

## 4. Cancelar a invocação — zona escolhida antes do comando

**O problema.** No ygopro-core, `SelectPlace` e `SelectPosition` só aceitam
uma resposta válida ou devolvem RETRY — não existe o "-1 = desisto" que
`SelectTributeP`, `SelectCard`, `SelectUnselectCard` e outros aceitam quando
o core marca `can_cancel` (conferido em `playerop.cpp`, edo9300/ygopro-core).
Mandado o "Invocar", a zona não tem volta.

**A solução** (`src/lib/duel/zone-first.ts`): como no Master Duel, a zona é
escolhida **junto** do comando. "Invocar" abre a escolha de zona **sem falar
com o motor**; "Cancelar" (ou Esc) só fecha — nada foi enviado. Clicar a zona
manda o comando e, quando o core pergunta a zona, a resposta já é a escolhida
(`placeResponseFor`), consumida uma vez no primeiro prompt seguinte. Se a zona
não estiver entre as oferecidas, o jogador escolhe de novo (nunca trava, nunca
responde outra pergunta).

**Onde vale** — só onde o conjunto de zonas é previsível pela mesa:

| Jogada (da mão) | Zonas | Por que só aí |
|---|---|---|
| Invocar / Baixar monstro de Nível 1–4 | Zonas de Monstro principais livres (0–4) | Nível 5+ pede tributo, e o tributo libera zona: a pergunta fica depois dele (e a escolha de tributo já tem "Cancelar invocação"). |
| Baixar Magia/Armadilha (não de Campo) | Zonas de M/A livres (0–4) | Magia de Campo vai sozinha para a Zona de Campo. |
| Ativar Magia/Armadilha (não de Campo) | Zonas de M/A livres (0–4) | Efeito de monstro na mão não ocupa zona. |
| Ativar como Escala de Pêndulo | Zonas 0 e 4 livres | Reconhecido pelo detalhe exato do core (string 1160). |

Fora disso (Invocação-Especial, efeito de monstro, carta do campo) a jogada
vai direto, como antes. Com uma zona só não há o que escolher — também vai
direto.

**Prova:** `npm run test:zone-first` monta 8 mesas no motor real (Goat e
MR5), calcula a previsão com a mesma função da tela e confere que as zonas
oferecidas pelo core são **exatamente** as previstas e que a carta termina na
zona escolhida; e que Nível 6 e Magia de Campo seguem direto.

Onde o core já permite cancelar, a tela já oferecia: escolha de tributos
("Cancelar invocação"), seleções de carta com `can_cancel` (inclui o alvo do
ataque) e marcar/desmarcar (`SELECT_UNSELECT_CARD`).

## 5. Janela de resposta sem popup

> Substituída na segunda entrega (§6): as capturas mostram que o MD pergunta
> num painel de baixo, com as cartas que respondem. O painel novo **não
> bloqueia** a mesa — a carta que brilha continua ativável pelo menu dela,
> como aqui embaixo.

`SELECT_CHAIN` passou a `presentation: "inline"`: as cartas que podem
responder brilham onde estão (mão, campo; pilha brilhando para Cemitério,
banidas e Extra; "Outras jogadas" para o resto) e se ativam pelo menu da
carta ("Ativar em resposta" + o efeito). A barra (`ChainResponseBar`) mostra o
elo do topo ("O oponente ativou Reforço do Exército", com a miniatura), quantas
jogadas respondem e "Não responder". O modo Automático/Sempre/Nunca e o Ctrl
continuam decidindo **quando** a janela aparece.

## 6. Segunda entrega — a mesa inteira refeita

Branch `visual-master-duel-2`. Arquivos novos: `DuelHud.tsx` (placas, botão de
fase, botões redondos), `DuelInfo.tsx` (os painéis "i" e "!", as rachaduras),
`FieldStats.tsx` (o ATK/DEF grande), `MdCardList.tsx` (a lista de cartas),
`MdBanners.tsx` (faixas e "Final Blow!"), `SummonCutIn.tsx` e
`src/app/md-duel.css` (todo o desenho da mesa, importado no `layout.tsx`
depois do `globals.css`).

**Tela e HUD.**

1. **Tela cheia**: a raiz da mesa é `fixed inset-0` e cobre o cabeçalho do
   site (que fica montado por baixo — o PT/EN e a saída foram para a
   engrenagem). As fontes do MD não são livres; as mais próximas: **Exo 2**
   itálica pesada nas faixas e no botão de fase, **Oxanium** (dígitos
   quadrados com cantos cortados) no LP e nos números (`next/font`).
2. **Placas de LP** (`LifePlate`): avatar redondo (seu) / sextavado (do
   oponente) com a inicial, nome numa faixa escura com o fio na cor do lado
   (acende no turno de quem é), "LP" e o número correndo; vermelho a partir de
   1000. Sem barra de vida — o MD não tem.
3. **Botão de fase** (`PhaseButton`): o disco "Turn N / Main1" (sextavado
   vermelho no turno do oponente) à direita, alinhado à linha do meio da mesa
   (medida: `data-center-line`). No seu turno, com fase para onde ir, ele
   pulsa; o clique abre ao lado as pílulas Battle Phase / Main Phase 2 / End
   Phase — só as que o core oferece. O botão em si é controle da mesa
   (`data-table-control`) e diz em `data-phase-options` para onde dá para ir:
   os testes juntam isso à lista de botões (`FASES_DISPONIVEIS`) e o
   `clickAction("EP")` abre o menu e clica.
4. **Botões redondos** (`HudButtons`): Auto/ON/OFF (a confirmação de
   ativação — Automático/Sempre/Nunca; "Hold" com Ctrl), "i" (ATK em campo e o
   tamanho das pilhas de cada um), "!" (os avisos de jogador do core, com a
   contagem em cima — antes pendurados nas placas) e o registro.
5. **Engrenagem** em cima à esquerda: confirmação de ativação, velocidade,
   **corte de invocação** (liga/desliga; preferência nova `cutIns`), som (o
   antigo 🔊 virou seção), idioma das cartas, dicas, atalhos, **Render-se** e
   **Sair** (com confirmação).

**Mesa.**

6. **Campo neon**: o salão escuro com névoa azul e circuitos (`.md-arena`), o
   tapete com malha sextavada e borda neon, a metade do oponente puxando para o
   vermelho. Zonas desenhadas no tapete: o anel que brilha (monstro e Zona
   Extra), a placa com fio interno (Magia/Armadilha), o hexágono (Campo).
7. **Câmera**: `rotateX(38deg)` com perspectiva em `vh` (a conta vale em
   qualquer tela) e a carta medida pela câmera — o menor entre o teto pela
   largura (sete colunas) e o teto pela altura (as fileiras, desfeito o
   achatamento com `cos()`). As cartas ficam **de pé** sobre a zona
   (`rotateX(-16deg)` pela borda de baixo, `transform-style: preserve-3d`), um
   pouco acima do tapete (`translateZ`) para não brigar com ele pelo pixel.
8. **Cartas do oponente de pé**, como no MD; só as setas Link dele giram meia
   volta (apontam para casas da mesa).
9. **ATK/DEF grande** numa camada plana por cima da mesa (`FieldStatsLayer`):
   dentro do plano 3D o número ficava atrás das cartas de pé da fileira da
   frente (profundidade decide quem tapa, não o `z-index`) e saía cortado.
   Embaixo da sua carta, em cima da do oponente; azul-claro acima do impresso,
   vermelho abaixo.
10. **Poços** do Cemitério e das banidas, um sobre o outro na coluna ao lado
    dos monstros (a arte da carta do topo dentro do círculo); Deck e Extra
    Deck como pilhas de versos de pé.
11. **Realce do MD**: azul jogada comum, amarelo efeito, as duas cores
    alternando quando a carta tem as duas (`intent` "action"/"activate"/"both",
    pelo verbo de cada `CardAction`); alvo amarelo; zona escolhível com o anel
    aceso.
12. **Mãos**: a sua grande e cortada pela borda de baixo (sobe inteira ao
    passar o mouse); a do oponente, versos cortados pela borda de cima.
13. **Luz de turno** na borda da metade de quem joga; **rachaduras** na metade
    de quem tem ≤ 6000, 4000 e 2000 LP (o traço novo "corre" e a metade dá um
    clarão).

**Decisões.**

14. **Comandos redondos** em cima da carta (disco amarelo para ativar efeito,
    azul para o resto), com o nome embaixo e o efeito, quando há mais de um.
15. **Lista de cartas** (`DecisionSheet` + `CardStrip`/`CardTile`): o painel de
    baixo para buscar no Deck, escolher do Cemitério, consultar pilhas e
    responder — com setas, aba de grade e a **seta para baixo**, que esconde o
    painel para ver a mesa (o "Ver a mesa" de antes; Esc também). Continua
    sendo diálogo com rótulo e montado mesmo escondido (a regra de nunca
    prender a mesa).
16. **Resposta na corrente**: "O oponente ativou X. Ativar uma carta em
    resposta (corrente)?" no painel de baixo, com as cartas que respondem
    (clique escolhe, clique de novo ativa) e "Não responder"; **não bloqueia**
    a mesa, e a seta recolhe o painel numa faixa.
17. **Faixas de instrução** atravessando a mesa: seleção no campo, escolha de
    zona (agora também a de uma zona só, que não tinha instrução nenhuma),
    decisão escondida.

**Efeitos.**

18. **Faixas** "DUEL START" / "TURN CHANGE" e uma por fase (DRAW, STANDBY,
    MAIN PHASE 1, BATTLE PHASE, MAIN PHASE 2, END PHASE), azuis no seu turno e
    vermelhas no do oponente, numa fila curta (a fase que ficou para trás sai).
    A sessão pausa um pouco mais na fase (200 → 340 ms) e na virada de turno
    (760 ms) para elas se lerem.
19. **Corte de invocação**: a arte recortada em tela cheia, raios na cor do
    atributo, faíscas, "SYNCHRO SUMMON" etc., as estrelas (ou Rank, ou LINK),
    o nome e o ATK/DEF. A sessão decide (`cutInFor`: Fusão, Sincro, Xyz, Link,
    Ritual; Nível 5+ por Invocação-Normal) e pausa 1,7 s (o clique pula); sem a
    arte recortada, a carta inteira ocupa o lugar.
20. **Ataque**: a seta segmentada do atacante ao alvo, o atacante brilhando na
    cor do dono e o impacto no alvo. **"Final Blow !"** nas laterais quando o
    ataque declarado tira todos os LP (direto com ATK ≥ LP, ou contra monstro
    em ataque com a diferença ≥ LP; contra defesa não).
21. **Estilhaço**: a carta destruída se parte em doze cacos que voam girando,
    com um clarão (pausa 520 → 640 ms).
22. **Corrente**: a carta ativada grande em 3D com o número do elo enorme e
    vazado, a corrente de metal pendurando o elo novo no anterior, a caixa do
    efeito no canto de cima à direita; negação com o "proibido" e o carimbo
    NEGATED. A pilha de elos (à esquerda) com os números vazados e os elos de
    metal.
23. **Dano** em número grande vermelho (cura verde) junto da placa; **fim de
    duelo** com VICTORY / LOSE / DRAW (FINISHED para quem só assiste), o
    motivo, as placas com a coroa e os botões do MD.
24. **Sons** sintetizados novos (sem áudio do jogo): o corte, a faixa, a
    corrente e o golpe final.

## 7. Desvios deliberados do Master Duel

- **A zona é perguntada** quando há escolha (o MD, por padrão, põe a carta
  sozinha). No TCG a zona decide setas Link e Zonas Extra; no Goat quase não
  importa, mas perguntar é o que dá o momento de cancelar (§4).
- **Sem avatar/Mate nem relógio de turno**: o avatar é a inicial do nome; o
  duelo não tem limite de tempo.
- **O poço do Cemitério mostra a arte da carta do topo** (o MD mostra um
  orbe): é informação que se consulta a toda hora.
- **A pilha de elos à esquerda** continua, além das cartas grandes: no MD a
  corrente se acompanha pelo registro.
- **Rótulos em português** onde não são faixa nem carimbo ("Você ativou", "Não
  responder", "Confirmar") — o resto da interface segue em português.
- **No Goat não há Zona Extra**: o meio da mesa é só o corredor com a linha de
  luz (o MD sempre tem a fileira, porque é Master Rule).

## 8. Próximas fases

- **Jogabilidade do MD**: arrastar a carta para a zona; ordem de ativação de
  gatilhos simultâneos; "Self Chain"; banco de tempo no online.
- **Leitura**: alternar valores atuais/originais; "efeito já usado neste
  turno"; "Cartas relacionadas".
- **Resolução da corrente** com o número se quebrando a cada elo.
- **Temas de mesa** (o Gustavo escolheu o neon; a troca de tema não foi
  pedida).

## 9. Verificação

### Primeira entrega

Testes novos ou ajustados (o ajuste é sempre de seletor/espera, nunca de
critério):

- `test:zone-first` (novo) — §4.
- `test:browser-chain` — o histórico é lido de `[data-duel-log]` (o "último
  trilho" passou a ser a placa do oponente e as fases).
- `test:browser` — a rendição espera o deck ficar clicável. Antes esperava o
  texto "LP", que a placa antiga não tinha: o teste seguia por acaso depois
  de 60 s de timeout; a placa nova mostra "LP" desde o primeiro quadro, antes
  de o duelo ter cartas.
- `test:modern-play` — a carta já marcada é `.tf-slot-picked` (era
  `.ring-emerald-400`, um anel que a `box-shadow` da zona sempre apagava).

Achados no caminho:

- `test:learning` falha às vezes **também na `main`** (1 em 3 rodadas): a
  checagem "quem assiste vê a mão do assento 0" lê a mesa num turno que varia
  (20, 33, 46…) e às vezes o bot esvaziou a mão. Instabilidade do teste, não
  desta mudança.
- `test:browser-announce` imprimiu o resultado e ficou pendurado depois do
  fim (o processo não saía); a bateria final roda cada teste com vigia.

## Fontes

- Steam — as 8 capturas da página do jogo e ~450 capturas de jogadores na
  Steam Community (mais votadas, mais recentes, do ano), ~90 delas olhadas em
  resolução cheia (13/10/2026).
- gameplay.tips — Duel screen info guide (field, menu and icons)
- outof.games — board guide; Activation Confirmation toggle; news 5582
- YGOrganization — notas de atualização (fev/2025, 1.5.1, ago/2022, ago/2024,
  2.1.0, 2.7.0)
- Master Duel Meta — expanded rule book; timer update; updates de jul/2025 e
  abr/2026
- levelwinner, itemlevel, Sportskeeda, Seafoam Gaming, ASCII (Weekly),
  Upcomer, Steam (discussões), Yugipedia (Ranked Duel)
