# Yu-Gi-Oh! Goat

Deck builder e simulador de duelo do formato Goat (abril de 2005), rodando o
**ocgcore de verdade** (o engine do EDOPro) compilado para WebAssembly — contra
o bot ou online, contra um amigo.

- `/` — construtor de decks
- `/aprender` — guias para aprender os decks oficiais; piloto com Albaz Strike
- `/duel` — duelo contra o bot
- `/duel/online` — duelo online (salas com link de convite)

Na aba **Aprender**, o guia de Albaz Strike reúne o plano do deck, cartas-chave,
três exercícios na mesa com mão preparada, dicas e as fontes consultadas.
Concluir os objetivos salva o progresso no navegador para cada jogador. O atalho de prática
abre um duelo livre contra o bot com a lista oficial. Autoria dos JSONs e
validação das jogadas: [guias de decks](docs/deck-learning.md).

Os duelos e o modo de assistir usam um único nível: **Difícil**, com estratégias
dos guias disponíveis. A revisão de custos, destruição própria e testes está em
[decisões com retorno](docs/bot-recursos-2026-10-27.md). A proposta histórica está
em [inteligência dos bots](docs/inteligencia-bot.md).

## Telefone e tablet

O construtor e os lobbies funcionam na vertical e na horizontal. No construtor,
use **Cartas**, **Meu deck** e **Biblioteca**; toque numa carta para ler e escolha
**Adicionar** ou **Remover**. Os filtros podem ser recolhidos para dar espaço ao
catálogo.

Para o duelo no telefone, **recomendamos a horizontal**. A mesa avisa ao entrar
na vertical, sem impedir a partida. Na horizontal, **toque numa carta** para
ler o texto na lateral esquerda e ver os comandos. Na vertical, toque e segure
para abrir a leitura. Os hologramas seguem a preferência escolhida, com escala
compacta; girar o aparelho preserva a partida e as escolhas em andamento.
As zonas são quadradas também no desktop: a carta mantém o tamanho e gira
90° em defesa, como num campo físico, com o contorno visível sob o holograma.

Use o botão **⛶** junto de **Auto**, **Info** e do registro para entrar e sair de
tela cheia. Nos navegadores sem suporte, ele mostra como abrir pela tela inicial.
Também é possível adicionar o jogo à tela inicial e abri-lo pelo
ícone, em uma janela sem barra de endereço. A barra do sistema depende do
aparelho; as cores acompanham o azul da mesa onde o navegador permite.

Testes de navegação e toque em Chrome, com o servidor rodando:

```bash
npm run test:mobile
npm run test:viewports
```

Os testes cobrem telefones a partir de 320px de largura, paisagem a partir de
568×320, tablets e desktop. As capturas ficam em `.cache/shots/mobile` e
`.cache/shots`.

Para repetir a validação no WebKit (motor do Safari), instale o ambiente de
teste opcional na pasta de cache, sem alterar as dependências do app:

```bash
npm install --prefix .cache/mobile-webkit --no-package-lock playwright
.cache/mobile-webkit/node_modules/.bin/playwright install webkit
npm run test:mobile:webkit
npm run test:mobile:field
```

A emulação em Chrome e WebKit não substitui a conferência em aparelhos físicos.

## Requisitos

- **Node.js 22.18 ou mais novo** (desenvolvido no 26). O servidor roda
  TypeScript direto, sem compilar, e isso só existe a partir daí.
- **Internet** enquanto joga: o catálogo de cartas vem da
  [YGOPRODeck](https://ygoprodeck.com/api-guide/) e o script de cada carta vem
  do GitHub do [ProjectIgnis](https://github.com/ProjectIgnis/CardScripts),
  baixados na hora e guardados em memória.
- Para jogar pela internet: **`cloudflared`** (`brew install cloudflared`).

## Rodar localmente

```bash
git clone https://github.com/GustavoStraub/yugioh-simulator.git
cd yugioh-simulator
npm install      # também copia o engine (wasm) para public/ocgcore
npm run dev      # http://localhost:3000
```

O `npm run dev` sobe um servidor Node próprio (`server.mjs`) em vez do
`next dev` puro — é ele quem serve o WebSocket do duelo online. Para depurar
algo que não seja o online, `npm run dev:next` usa o Next sozinho.

Para rodar como em produção (mais rápido, sem recarregar ao salvar):

```bash
npm run build
npm start        # http://localhost:3000
```

O servidor imprime ao subir o endereço local, o da rede e a pasta onde os
decks ficam salvos:

```
  ▲ Yu-Gi-Oh! Goat — desenvolvimento
    http://localhost:3000
    http://192.168.0.42:3000
    convite: http://192.168.0.42:3000/duel/online
    decks: /caminho/do/projeto/.data/decks
```

## Jogar com amigos na mesma rede

Com o servidor rodando (`npm run dev` ou `npm start`), qualquer aparelho do
mesmo Wi-Fi entra pelo endereço de rede impresso acima. Duas abas do mesmo
navegador também valem por dois jogadores — a identidade fica no
`sessionStorage`, que é por aba.

1. Abra `/duel/online`, escolha um deck e clique em **Criar sala nova**.
2. Mande o link da sala para o amigo (a tela já monta com o IP da rede —
   `localhost` só funciona para quem hospeda).
3. Os dois clicam em **Estou pronto** e disputam **pedra, papel e tesoura** —
   quem ganhar escolhe jogar o primeiro ou o segundo turno (empate joga de
   novo).

Se o amigo não conseguir abrir o link, o firewall do computador que hospeda
pode estar barrando a porta 3000.

## Jogar pela internet

### Link temporário — um comando

Builda, sobe o servidor, abre um túnel e te devolve o link pronto para mandar:

```bash
brew install cloudflared   # uma vez
npm run public
```

```
  ┌───────────────────────────────────────────────────────────┐
  │  https://algo-aleatorio.trycloudflare.com/duel/online      │
  └───────────────────────────────────────────────────────────┘
```

Enquanto o terminal estiver aberto, o jogo está no ar; `Ctrl+C` derruba
servidor e túnel juntos. `npm run public -- --sem-build` pula a compilação (útil
para reabrir o túnel). Se a 3000 estiver ocupada (um `npm run dev` aberto, por
exemplo), o servidor sobe na próxima porta livre e o túnel vai junto;
`PORT=3001 npm run public` exige uma porta específica.

O túnel abre uma conexão **de dentro para fora**, então não precisa de
encaminhamento de porta nem de acesso ao roteador — é a saída para quem não é
dono da rede. De brinde ele entrega HTTPS, o que faz o botão de copiar link
funcionar (a área de transferência do navegador só existe em contexto seguro).

A URL muda a cada execução, e quem está jogando cai se o seu computador
dormir ou o terminal fechar.

### Endereço fixo

Duas saídas:

- **Túnel nomeado da Cloudflare** — precisa de conta e de um domínio na
  Cloudflare. O servidor continua no seu computador
  (`npm run build && npm start`), e o túnel aponta um subdomínio fixo para
  `http://localhost:3000`. Se for usar o `next dev` atrás dele, ponha o domínio
  em `DEV_ORIGINS`.
- **Um servidor seu** (VPS, máquina de casa ligada direto):

  ```bash
  npm ci
  npm run build
  PORT=3000 npm start
  ```

  Atrás de um proxy reverso com HTTPS (Caddy, Nginx) que repasse o
  **WebSocket** (cabeçalhos `Upgrade`/`Connection`) — sem isso o duelo online
  não conecta. Guarde a pasta de decks (`DECKS_DIR`) num lugar que sobreviva a
  um novo deploy.

**Não roda em hospedagem serverless (Vercel e afins):** o duelo online precisa
de um processo Node que fique de pé, segure as conexões WebSocket e guarde as
salas em memória.

## Configuração

Tudo opcional, por variável de ambiente:

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do servidor (e do `npm run public`). Sem ela, a 3000 ocupada faz o servidor subir na próxima livre (até 3019); com ela, porta ocupada é erro |
| `HOST` | `0.0.0.0` | Interface em que o servidor escuta; `127.0.0.1` deixa só esta máquina entrar |
| `DECKS_DIR` | `.data/decks` | Onde os decks são gravados |
| `DUEL_DISCONNECT_GRACE_MS` | `45000` | Quanto esperar por quem caiu antes de liberar "encerrar a meu favor" |
| `DUEL_HEARTBEAT_MS` | `30000` | Intervalo do ping que detecta conexão morta |
| `CARDSCRIPTS_DIR` | `.cache/CardScripts` | Clone local dos scripts (`npm run fixtures`); sem ele, o servidor baixa do GitHub |
| `DEV_ORIGINS` | — | Domínios extras liberados no `next dev` (separados por vírgula) |

## Durante o duelo

A caixa do efeito no canto fica visível por quatro segundos, enquanto o duelo
continua. Uma nova ativação substitui a anterior e reinicia esse tempo. As
animações centrais são breves; a engrenagem permite acelerar o ritmo da partida
sem encurtar o tempo de leitura da caixa.

O engine roda **no servidor**, não no navegador: é o que impede que um jogador
leia a mão do outro pelo console. Detalhes do desenho em
[`docs/multiplayer.md`](docs/multiplayer.md).

Para desistir, clique no **seu deck** e escolha 🏳️ *Render-se* (pede
confirmação — é a única ação da mesa que não dá para desfazer). Os pontos de
vida não são mexidos: só o resultado muda.

Quando a partida acaba, a tela diz **por que** acabou (LP a zero, deck vazio,
Exodia, rendição) e oferece um caminho só: *Voltar à sala*. Lá dentro cada um
troca de deck se quiser e clica em **Estou pronto** de novo — a partida seguinte
começa na mesma sala, com os assentos sorteados outra vez.

Se alguém cair no meio do duelo, o lugar fica guardado e a pessoa volta no
mesmo assento ao reabrir o link. Quem ficou vê o aviso na mesa e, depois de 45
segundos (`DUEL_DISCONNECT_GRACE_MS`), pode encerrar o duelo a seu favor —
ninguém fica preso a um tabuleiro que não anda mais.

## Construtor de decks

Na primeira visita o app pede o seu **nome**: é ele que identifica a sua
coleção e é ele que o adversário vê na mesa. O nome **não** diferencia
maiúsculas, acentos nem espaços — "Straub", "straub" e "STRAUB" são a mesma
pessoa, com a mesma biblioteca.

Clique numa carta para ler os detalhes e ampliar a imagem. Passar o mouse não
troca a leitura; no construtor, adicionar e remover exigem os botões do painel.
O painel mostra a banlist como aviso e as cópias no deck. O limite de três
cópias e a capacidade da zona desabilitam **Adicionar** quando atingidos.

- **Biblioteca de decks** — crie, duplique, renomeie e apague quantos quiser.
  Os decks são gravados **pelo servidor** em `.data/decks/<apelido>.json`
  (`straub.json`), não no navegador: limpar os dados do site não leva nada
  junto, e o arquivo dá para achar, ler e copiar à mão. O servidor imprime o
  caminho da pasta ao subir.

  Como o arquivo é do **apelido** e não do navegador, a coleção acompanha você:
  outra porta (`:3000` e `:3100` são origens diferentes, com `localStorage`
  separado), outro navegador, outro aparelho da rede — é só usar o mesmo nome.
  Coleções antigas gravadas sob id aleatório são adotadas na primeira visita, e
  se você aparecer em vários arquivos elas são **juntadas** (o original fica ao
  lado como `.absorvido.bak`, para dar para desfazer à mão).

  Fazer backup é copiar a pasta; apontar `DECKS_DIR` para um diretório
  sincronizado (iCloud, Dropbox) dá os mesmos decks em outro computador, sem
  banco nenhum.
- **Sem banlist** — nenhuma carta é proibida ou limitada. A lista de abril de
  2005 continua à vista na carta e no filtro, como informação; o único limite
  que vale é o de 3 cópias, que é regra do jogo. (Os decks oficiais do app
  sempre trouxeram cartas proibidas e sempre puderam ser jogados — a restrição
  valia só para quem montava à mão.)
- **Português e inglês** — o seletor `PT`/`EN` no cabeçalho troca o nome e o
  texto das cartas. A busca acha nos dois idiomas de qualquer jeito, ignorando
  acento: `dragao`, `DRAGÃO` e `blue eyes` levam ao mesmo lugar.

## Testes

Ver [`tools/harness/README.md`](tools/harness/README.md) — o harness roda o
engine de verdade, sem navegador, e testa carta por carta. Antes da primeira
vez:

```bash
npm run fixtures         # clona os scripts e baixa o pool Goat em .cache/
```

Os que cobrem o online:

```bash
npm run test:multiplayer     # sala, projeção por assento, codec, roteamento
npm run test:browser-online  # duas abas de Chrome de verdade, duelando
npm run test:browser-decks   # biblioteca de decks, persistência e idioma
```

## Documentação

- [`docs/inteligencia-bot-implementacao.md`](docs/inteligencia-bot-implementacao.md)
  — níveis do bot, perfis executáveis, testes e limites demonstrados na avaliação.
- [`docs/multiplayer.md`](docs/multiplayer.md) — como o duelo online foi
  desenhado (servidor dono do engine, projeção por assento).
- [`docs/tcg-completo.md`](docs/tcg-completo.md) — achados e plano para levar
  o app ao pool completo do TCG.
