# Mobile e tablet

Validado em 15/10/2026. A referência de interação continua sendo o Master Duel,
conforme [a pesquisa visual do projeto](master-duel.md) e o
[portal oficial](https://www.konami.com/yugioh/masterduel/eu/en/).

## Comportamento

- Construtor: abaixo de 1024px, as abas Cartas, Meu deck e Biblioteca usam a
  altura disponível. O catálogo mantém a posição ao trocar de aba e os
  filtros ficam recolhíveis. No desktop, continuam expostos.
- Toque no construtor: abre o texto da carta com ações explícitas de adicionar
  e remover cópias. Consultar uma carta nunca muda o deck, inclusive quando
  ela já atingiu o limite de cópias.
- Lobbies: a leitura vazia deixa de ocupar o topo no mobile. Tocar numa carta
  abre seus detalhes; iniciar duelo e confirmar presença têm botão fixo em
  telas pequenas.
- Mesa: trilhos compactos até 1180px de largura ou 600px de altura. Abaixo de
  500px de altura, os controles ficam em duas colunas e os painéis adaptam a
  leitura e a rolagem. A rotação preserva o estado do motor e das escolhas.
  Na horizontal, os LP ficam nas laterais e liberam a altura do campo. De
  370 a 500px de altura, os atalhos cabem numa coluna mais estreita à direita.
- Horizontal a partir de 560px: texto e atributos ficam numa coluna fixa à
  esquerda, atualizada por um toque. Dispensa o toque longo e o popup de
  leitura. Instruções de zona e retorno à decisão ficam na lateral para não
  bloquear zonas do campo. A coluna usa 22% da largura, entre 156 e 240px,
  deixando mais espaço para a mesa; faixas das mãos e vãos menores aumentam
  as cartas nas telas baixas.
- Proporções: as sete colunas usam a largura disponível; os números de ATK/DEF
  ficam em duas linhas no mobile, com atributos, níveis e contagens menores.
  No desktop e no mobile, as zonas são quadradas e as cartas mantêm a mesma
  dimensão nas duas posições: ataque na vertical, defesa girada em 90°, sem
  redução. A carta fica mais iluminada sob o holograma e mantém o contorno.
  Hologramas continuam ligados conforme a preferência, com altura e largura
  proporcionais à carta; os efeitos de saída usam a mesma âncora.
  As cartas da mão são maiores que as do campo no telefone: crescem 44% em
  relação à mão anterior sem aumentar a faixa que reserva altura. Mãos
  cheias sobrepõem as cartas, preservando o acesso por toque.
- Botão de tela cheia junto de Auto, Info e registro: entrada e saída por
  toque onde houver suporte, ou instruções para abrir pela tela inicial nos
  demais navegadores. Configurações → Tela mantém a ajuda de instalação.
  Manifesto, ícones e metadados permitem a abertura pela tela inicial.
  Barra de endereço e fundo do sistema recebem o azul da mesa onde permitido.
- Telefone na vertical: aviso dispensável recomendando a horizontal. O app
  permite continuar na vertical; as sete colunas tornam as zonas pequenas.
- Viewport com altura dinâmica e margens de área segura. Controles principais
  de toque com 44px; campos com 16px no toque para evitar zoom automático do
  iOS. O zoom manual permanece disponível.

## Verificação

Todos os testes abaixo passaram. Os testes mobile, WebKit e viewports foram
executados contra o build de produção (`APP_URL=http://127.0.0.1:3100`).

| Verificação | Cobertura |
| --- | --- |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Tipos |
| `npm run build` | Compilação, geração e CSS de produção |
| `npm run test:mobile` | 13 tamanhos × construtor/lobby bot/lobby online; edição por toque, limite de cópias, busca, filtros, ferramentas, sala online e rotação |
| `npm run test:mobile` — motor real | 844×390, 568×320, 932×430 e 844×300 (altura reduzida simulando barras abertas): leitura lateral por toque, Ativar, zona, busca no Deck, seleção preservada ao espiar/girar, histórico, configurações, rendição e revanche; tela cheia no HUD, entrada/saída reais, recusa e falta de suporte no Chrome |
| `npm run test:viewports` | 10 tamanhos × Goat/TCG: zonas, pilhas, trilhos, LP, navegação, toque longo e movimento reduzido; zero falhas |
| `npm run test:mobile:webkit` | 5 tamanhos × 3 telas, leitura/edição por toque e 2 duelos completos até rendição/revanche; sem erros JavaScript |
| `npm run test:mobile:field` | Chrome e WebKit × Goat e TCG × 7 tamanhos: zonas quadradas, mesma escala em ataque/defesa, mesa cheia, 10 hologramas ligados, números e marcadores sem sobreposição, mão com dez ou onze cartas consultadas individualmente, troca real de posição e controles alcançáveis |
| `npm run test:draw` | Sete compras, incluindo mão já povoada; voo pousa no centro correto da carta |
| `npm run test:browser-builder` | Regressão desktop de edição, desfazer, ferramentas, importar/exportar, arrastar e lobby |
| `npm run test:browser-peek` | Regressão desktop dos diálogos, seleções, configurações e revanche |
| `npm run test:browser-online` | Dois clientes, perspectivas, jokenpô, 24 ações e desconexão |

Tamanhos do teste mobile: 320×568, 360×800, 390×844, 430×932, 568×320,
667×375, 844×390, 932×430, 768×1024, 820×1180, 1024×768, 1180×820 e
1440×900. WebKit: 390×844, 844×390, 568×320, 768×1024 e 1024×768.

Capturas revisadas em `.cache/shots/mobile` e `.cache/shots/viewport-*.png`.
O WebKit é instalado separadamente para QA; as instruções estão no README.

O teste de campo inclui 568×320, 667×375, 844×390, 844×300, 932×430 e
1024×768 e 1440×900. As capturas `*-full-field.png` permitem revisar a mesa
preenchida com monstros em ataque e defesa nos dois lados.

A tela cheia depende de interação e permissão do navegador, conforme a
[documentação da API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen).
A abertura como aplicativo segue o [manifesto e o suporte do WebKit](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).
Não há promessa de remover a barra do sistema nem suporte offline.

O build ainda emite o aviso preexistente de rastreamento de arquivos em
`src/server/decks/store.ts` (leitura dinâmica da biblioteca); a compilação
termina com sucesso.

A validação cobre navegadores com emulação de toque e viewport. Aparelhos
físicos, teclado virtual, barras do Safari iOS e recortes reais de tela ainda
precisam de conferência em hardware.
