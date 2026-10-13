# A tela de duelo no jeito do Master Duel

> Pedido do Gustavo, 13/10/2026: "refatorar o visual do duelo baseando-se
> **completamente** no Master Duel — efeitos, escolhas, correntes, resolução,
> informação das cartas, literalmente tudo", e, no meio do trabalho, "pegar a
> jogabilidade também": poder **cancelar** uma jogada enquanto ainda dá (o
> exemplo dele: cliquei "Invocar", o jogo pede a zona — ali devia dar para
> desistir).
>
> Este documento é a investigação, o que a primeira entrega já mudou, o que
> ficou de propósito diferente do MD e as próximas fases. O plano anterior de
> UI/UX (`docs/ui-ux-plano.md`) copiou o **comportamento** do MD e do Tag
> Force sobre a arte de mesa do Tag Force; este troca a **aparência** inteira
> e volta ao comportamento onde o MD faz diferente.

## 1. Resumo

- **Primeira entrega feita** (branch `visual-master-duel`): mesa em
  perspectiva 3D, paleta azul-noite/ciano, placas de LP nos cantos com o LP
  correndo, mão grande na borda de baixo, comandos em pé ao lado da carta,
  registro do duelo em gaveta, leitura da carta azul (sua) / vermelha (do
  oponente), corrente nas mesmas cores, "luz de quem decide", faixa de virada
  de turno.
- **Jogabilidade:** "Invocar"/"Baixar"/"Ativar" da mão agora pedem a zona
  **antes** de falar com o motor, com **Cancelar** (e Esc) — §4. E a janela
  de resposta na corrente deixou de ser um popup: as cartas que respondem
  brilham e uma barra diz a que se responde, com "Não responder" (§5).
- **Limite do motor:** a escolha de zona e de posição **não têm cancelamento
  no ygopro-core** (só tributos e algumas seleções de carta têm). Por isso o
  cancelar da invocação funciona escolhendo a zona antes do comando, e só
  onde as zonas são previsíveis pela mesa (§4).
- **O que ainda é inferência:** a pesquisa só leu texto (guias, notas de
  atualização, wiki); nenhum vídeo ou captura foi visto. Posições e regras de
  cor estão documentadas; tempos de animação, formato exato do número do elo,
  o desenho da quebra do elo e o texto da tela de vitória não estão (§2).

## 2. O que o Master Duel faz — documentado × inferido

Pesquisa de 13/10/2026 (fontes no fim). **Documentado** = está escrito em
fonte; *(inferido)* = memória do jogo ou dedução, a conferir em vídeo.

| Tema | Documentado | *(inferido)* |
|---|---|---|
| Mesa | 3D; cada um vê o próprio lado embaixo. Deck no canto inferior direito, Cemitério num círculo acima dele, banidas acima do Cemitério; Extra Deck no inferior esquerdo, Zona de Campo acima dele. A mesa vai se "quebrando" conforme o LP cai. | Inclinação moderada (`rotateX` 30–40°), lado de lá ~80% da largura do lado de cá. |
| Cores | **Azul = você, vermelho = oponente**: fundo da leitura da carta, ícones de local, luz de "quem age". Moldura **azul e amarela** = dois tipos de jogada (as duas juntas quando a carta pode atacar e ativar). | Qual é qual (azul = ativar? amarelo = atacar?) — **não confirmado**. |
| HUD | Engrenagem no canto superior esquerdo; no inferior direito: Registro do Duelo, "!" (cartas limitando ações), "i" (passo da batalha), Confirmação de Ativação (Automático/Ligado/Desligado). Botão de fase azul à direita. Luz de quem decide: "passa do vermelho em cima para o azul do nosso lado". Banco de tempo por jogador. Texto do efeito ativado no canto superior direito. | LP do jogador embaixo à esquerda, do oponente em cima à direita; LP correndo ~0,5–1 s. |
| Mão | Sua embaixo, a do oponente em cima; molduras coloridas nas jogáveis. | Cartas grandes, encavalando conforme cresce; carta sobe ao passar o mouse. |
| Comandos | Arrastar a carta (ou o próprio comando) para a zona; símbolo de "proibido" em comando bloqueado; duplo clique confirma. | Pilha vertical de botões em pé, logo acima da carta. |
| Leitura da carta | Valores **atuais** no duelo (um botão alterna para os originais); fundo azul/vermelho por dono; ícone de "efeito já usado neste turno"; efeitos ativáveis agora destacados em azul no texto; ícones de estado (negado, não pode atacar…); "Cartas relacionadas". | Painel alto à esquerda: arte, nome + atributo, estrelas, [Tipo/Efeito], ATK/DEF, texto rolável. |
| Corrente | **Sem popup de sim/não**: a luz vem para o seu lado, as cartas ativáveis brilham, um "Cancelar" passa. Ajustes Automático/Ligado/Desligado, "Self Chain", ordem de ativação de gatilhos simultâneos. Animação de ativação; texto do efeito no canto superior direito. Monstro negado ganha símbolo de proibido. | Ativação da mão voa ao centro; número do elo brilhante na carta; resolução de cima para baixo com o número se quebrando. Carimbo "NEGADO" grande **não confirmado**. |
| Escolhas | Lista de cartas horizontal **ou** vertical; ícones de local azul/vermelho; duplo clique confirma; moeda na cor de quem lançou. | Faixa escura no meio com a fileira de cartas, contador x/y e Confirmar; alvo no campo com o resto escurecido e faixa de instrução no topo. |
| Batalha / turno | Tela de "Duel Start"; moeda decide quem começa. | Faixa atravessando o centro na virada de turno (azul seu, vermelha dele); estilhaço na destruição; número de dano grande. |

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

`SELECT_CHAIN` passou a `presentation: "inline"`: as cartas que podem
responder brilham onde estão (mão, campo; pilha brilhando para Cemitério,
banidas e Extra; "Outras jogadas" para o resto) e se ativam pelo menu da
carta ("Ativar em resposta" + o efeito). A barra (`ChainResponseBar`) mostra o
elo do topo ("O oponente ativou Reforço do Exército", com a miniatura), quantas
jogadas respondem e "Não responder". O modo Automático/Sempre/Nunca e o Ctrl
continuam decidindo **quando** a janela aparece.

## 6. Desvios deliberados do Master Duel

- **Fases sempre à vista** (DP…EP na coluna da direita) em vez do botão
  único que abre um menu: um clique em vez de dois, e os testes de navegador
  avançam a fase pelo texto do botão.
- **A zona é perguntada** quando há escolha (o MD, por padrão, põe a carta
  sozinha). No TCG a zona decide setas Link e Zonas Extra; no Goat quase não
  importa, mas perguntar é o que dá o momento de cancelar.
- **Banidas como pilha** ao lado do Cemitério, não como círculo acima dele.
- **Sem avatar/Mate**: o avatar é a inicial do nome.

## 7. Próximas fases

- **B — Escolhas.** Seletor de cartas em faixa horizontal (a "Card List" do
  MD) com ícone de local azul/vermelho e contador x/y; posição (ATK em pé /
  DEF deitada, lado a lado); atributo e tipo em grade de ícones; alvo no
  campo com o resto escurecido e a instrução numa faixa no topo.
- **C — Corrente e resolução.** Ativação da mão voando ao centro; do campo, a
  carta acende no lugar; elos ligados por uma corrente desenhada; resolução de
  cima para baixo com o número se quebrando; negação com o símbolo de
  proibido na carta; texto do efeito ativado no canto superior direito.
- **D — Leitura da carta.** Alternar atuais/originais; "efeito já usado neste
  turno"; ícones de estado; efeitos ativáveis agora destacados no texto;
  "Cartas relacionadas".
- **E — Batalha.** Seta de ataque, impacto, estilhaço na destruição, número de
  dano grande; a mesa se desgastando com o LP.
- **F — Canto inferior direito do MD.** "!" (o que limita ações — hoje
  `PlayerHints` e as marcas das cartas), "i" (passo da batalha), estado do
  campo.
- **G — Jogabilidade.** Arrastar a carta para a zona; ordem de ativação de
  gatilhos simultâneos (opcional, como no MD); "Self Chain"; banco de tempo
  no online.
- **H — Telas estreitas** no visual novo (hoje passam no `test:viewports`, mas
  foram pouco olhadas).

## 8. Verificação desta entrega

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

- gameplay.tips — Duel screen info guide (field, menu and icons)
- outof.games — board guide; Activation Confirmation toggle; news 5582
- YGOrganization — notas de atualização (fev/2025, 1.5.1, ago/2022, ago/2024,
  2.1.0, 2.7.0)
- Master Duel Meta — expanded rule book; timer update; updates de jul/2025 e
  abr/2026
- levelwinner, itemlevel, Sportskeeda, Seafoam Gaming, ASCII (Weekly),
  Upcomer, Steam (discussões), Yugipedia (Ranked Duel)
