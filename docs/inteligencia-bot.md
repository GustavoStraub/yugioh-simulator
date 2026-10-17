# Inteligência dos bots

Proposta de evolução — 17 de outubro de 2026.

Este documento define o comportamento desejado, a arquitetura e as etapas de
implementação. O diagnóstico da seção 2 registra a situação anterior à
implementação. O estado do código, os testes executados e os critérios ainda
pendentes estão em [Implementação e avaliação](inteligencia-bot-implementacao.md).

## 1. Objetivo

O bot deve pilotar o deck com uma intenção: reconhecer sua condição de vitória,
preparar os recursos necessários, escolher uma sequência e adaptá-la ao que
acontece na mesa. Ganhar pontos de vida, causar dano ou colocar o monstro de
maior ATK não basta para decidir se uma jogada é boa.

Exemplo: buscar um monstro pequeno pode ser melhor que buscar o maior se esse
monstro inicia a sequência do deck. Da mesma forma, guardar uma remoção pode
valer mais que usá-la na primeira oportunidade, e encerrar o desenvolvimento
com uma defesa e uma continuação pode ser melhor que gastar a mão inteira.

Teremos três níveis: **Fácil**, **Médio** e **Difícil**. O Difícil tem como meta
pilotar os decks cobertos com decisões de nível competitivo. Essa qualidade
precisa ser demonstrada por deck; selecionar Difícil não torna qualquer lista
forte nem garante decisões perfeitas.

## 2. O que existe hoje

| Parte atual | O que já faz | Limitação para a evolução |
| --- | --- | --- |
| `src/lib/duel/bot/bot-brain.ts` | Compara ações, escolhe invocações, ativações, respostas, custos e alvos; lembra o alvo de um ataque. | A maior parte das escolhas maximiza uma nota imediata, sem plano estratégico persistente por deck. |
| `src/lib/duel/bot/card-intel.ts` | Lê atributos do banco oficial e reconhece funções e custos de algumas cartas. | A cobertura de funções é concentrada em cartas Goat e não representa os motores dos guias TCG. |
| `src/lib/duel/bot/combat.ts` | Estima trocas e dano; trata monstros ocultos como desconhecidos. | Analisa ataques individualmente e aproxima o valor das cartas principalmente pelos números. |
| `src/lib/duel/bot-responder.ts` | Fornece respostas genéricas quando não há heurística aplicável. | É uma reserva de continuidade, sem conhecimento estratégico; sua legalidade também precisa ser verificada. |
| `src/lib/duel/duel-session.ts` | Mantém um cérebro por assento e fornece campo, turno, fase, último elo e invocação em andamento. | Ainda não entrega perfil estratégico, memória de eventos observáveis e intenção dos efeitos ao cérebro. |
| `src/data/deck-guides/` e `src/data/deck-learning-base.json` | Documentam planos, funções, etapas, cuidados e fontes. Quatro guias possuem práticas executáveis. | O cérebro não consulta os guias; a maior parte das lições é editorial, sem regras executáveis. |
| `tools/harness/test-bot.mjs` | Executa cenários dirigidos e partidas com sementes reproduzíveis, incluindo comparação entre cérebros. | Precisa ganhar verificações por estratégia, por nível e por decisões sob incerteza. |

Hoje, uma seleção genérica ainda pode escolher uma busca pelo ATK, um descarte
pelo menor valor numérico e um material pelo corpo mais barato. Essas escolhas
podem parecer razoáveis isoladamente e destruir a sequência que motivou a
ativação. Esse é um dos primeiros problemas a resolver.

Referências da base de ensino: [guias de decks](deck-learning.md) e
[base editorial](deck-learning-base.md).

## 3. Os três níveis

Os níveis compartilham motor de regras, cartas, informação permitida e
proteções contra travamentos. O que muda é a qualidade da análise.
A dificuldade editorial do guia — Iniciante, Intermediário ou Avançado —
continua indicando a complexidade do deck, independentemente do nível do bot.

| Capacidade | Fácil | Médio | Difícil |
| --- | --- | --- | --- |
| Plano do deck | Reconhece a condição de vitória e as peças principais. | Executa as rotas principais validadas. | Compara rotas, adapta materiais e planeja a continuação. |
| Antecipação | Resolve oportunidades imediatas e combinações curtas. | Analisa uma sequência até seu resultado, incluindo custos e defesa. | Compara sequências, respostas plausíveis do adversário e recuperação. |
| Busca e descarte | Usa prioridades simples ligadas ao deck. | Busca a peça que falta e preserva os recursos da rota. | Considera redundância, interrupções, restrições e o próximo turno. |
| Uso das respostas | Reage às ameaças mais evidentes. | Guarda respostas para ações relevantes e protege a própria sequência. | Procura o ponto que interrompe a rota adversária e compara deixar resolver com responder. |
| Combate | Evita perdas evidentes quando há alternativa e aproveita dano disponível. | Planeja ordem de ataques, trocas e finalização. | Avalia risco, efeitos conhecidos, exposição e o estado após a batalha. |
| Informação oculta | Usa hipóteses simples. | Considera cartas reveladas e padrões observados. | Mantém hipóteses por evidência e prefere linhas robustas a respostas plausíveis. |
| Uso de recursos | Pode perder oportunidades e escolher uma rota menos eficiente. | Evita desperdícios frequentes e mantém alguma continuação. | Compara o ganho marginal de continuar com preservar recursos. |

O Fácil deve ser um oponente compreensível para aprender: desenvolve o próprio
jogo, mas enxerga menos alternativas e deixa passar oportunidades sutis. Não
precisa cometer suicídio deliberado, ignorar regras ou receber uma mão pior.
Variações podem ocorrer entre opções aceitáveis, com aleatoriedade reproduzível.

O Médio deve ser um parceiro de treino consistente: conhece o funcionamento do
deck e conclui suas linhas principais quando as condições estão presentes.
O Difícil deve saber também quando mudar a linha ou parar, mesmo havendo
outras ativações disponíveis.

## 4. Dos guias ao conhecimento executável

### 4.1. Duas representações ligadas pela mesma estratégia

Os textos dos guias explicam o jogo ao jogador. O bot precisa de dados
estruturados: condições de entrada, ações, custos, escolhas e resultados
observáveis. A proposta é manter um **perfil estratégico por deck**, com
referências ao guia e às lições que justificam cada rota.

A conversão acontece durante a autoria e a validação do conteúdo. Uma frase
como “preserve recursos para o próximo turno” precisa virar critérios
específicos daquele deck. Não basta carregar o Markdown ou o texto de `why`
e esperar que ele execute uma jogada.

| Conteúdo do guia | Conhecimento necessário no perfil |
| --- | --- |
| `overview.goal` e `overview.plan` | Condição de vitória, objetivos de abertura, pressão e recuperação. |
| `keyCards` | Funções por carta e por efeito: início, extensão, busca, interação, recuperação e finalização. |
| `preparation` e `cautions` | Pré-condições, restrições, recursos mínimos e situações em que evitar uma rota. |
| `steps` | Nós de uma sequência com escolhas e evidências de resolução. |
| `practice.goal` e `completeWhen` | Casos iniciais para verificar resultados no motor, quando há prática. |
| `sources`, `revision` e `deckSnapshot` | Rastreabilidade e detecção de conteúdo desatualizado. |

As condições de prática atuais verificam cartas, PV e opções oferecidas; elas
não descrevem sozinhas todas as regras, custos ou variações de uma estratégia.
As lições editoriais, com `practice: null`, exigem validação adicional antes
de se tornarem uma rota do bot.

### 4.2. Conteúdo mínimo de um perfil

- **Identidade:** ID, versão do contrato, revisão do perfil, formato, preset,
  referência e revisão do guia, assinatura da lista revisada.
- **Objetivos:** como o deck vence, o que pretende estabelecer e quais
  recursos garantem sua continuidade.
- **Funções:** cartas e efeitos que iniciam, estendem, protegem, interrompem,
  recuperam ou finalizam; uma carta pode exercer mais de uma função.
- **Rotas:** pré-condições, alternativas, etapas, custos, materiais, alvos,
  escolhas de efeito, restrições e resultados esperados.
- **Reservas:** recursos que não devem ser gastos sem uma alternativa melhor,
  como a única peça de acesso ou o descarte necessário à próxima etapa.
- **Respostas:** ameaças reconhecidas e janelas relevantes para interagir.
- **Verificação:** cenários no motor que comprovam a rota e suas variações.

Cada etapa identifica o efeito, a finalidade da seleção e o estado que deve
ser observado após resolver. Referências usam passcodes e identificadores de
efeito; nomes traduzidos ficam apenas na apresentação. Os predicados usam um
vocabulário tipado e validado, sem executar instruções livres vindas do texto.

### 4.3. Identificar o deck e lidar com mudanças

O perfil deve ser escolhido pela **lista do próprio bot** e pelo formato.
O ID do preset ajuda a localizar o candidato; a composição e as quantidades
confirmam a compatibilidade. A assinatura desconsidera a ordem das cartas.

Para o preset oficial, comparar a lista completa revisada, inclusive Extra e
Side, seguindo o cuidado já existente em `matchesGuideDeck`. Uma revisão do
guia ou da lista marca o perfil para conferência antes de publicá-lo de novo.

Para decks personalizados, começar com a inteligência genérica. A reutilização
parcial de um perfil exige declarar suas peças obrigatórias, quantidades e
restrições e conferir cada rota contra a lista real. Compartilhar algumas
cartas ou o nome do arquétipo não comprova compatibilidade.

Deck sem perfil deve continuar jogável em todos os níveis, usando análise
genérica. A interface informa “Estratégia específica em preparação” junto do
deck quando necessário. A qualidade competitiva desse deck só será considerada
coberta após a validação do perfil.

## 5. Como decidir cada passo

### 5.1. Ciclo de decisão

1. **Observar:** ler o prompt atual, a própria mão, o campo permitido, as
   zonas públicas, a corrente, as restrições conhecidas e o histórico visível.
2. **Diagnosticar:** reconhecer perigo imediato, possibilidade de vitória,
   recursos de acesso, defesas e capacidade de continuar jogando.
3. **Definir o objetivo:** sobreviver, estabelecer interação, quebrar a mesa,
   recuperar recursos ou finalizar, conforme a situação e o deck.
4. **Gerar alternativas:** incluir rotas compatíveis, respostas táticas,
   ações genéricas e a opção de passar quando o motor permitir.
5. **Comparar consequências:** verificar o que sobra após custos, resolução,
   batalha e respostas plausíveis, na profundidade permitida pelo nível.
6. **Executar uma escolha:** traduzir a intenção para uma opção do prompt atual.
7. **Conferir e replanejar:** observar o resultado real antes de avançar.

A rota é um grafo com bifurcações e saídas. Negação, remoção, compra, mudança
de alvo, perda de material ou uma nova oportunidade podem alterar a decisão.
O bot não deve continuar repetindo a receita original depois que ela deixou
de fazer sentido.

### 5.2. Manter intenção entre prompts

O motor divide uma jogada em várias perguntas: ativar, pagar custo, escolher
material, selecionar alvo, escolher opção e posição. O cérebro precisa lembrar
o objetivo que iniciou essa sequência.

Exemplo de intenção: “Buscar a peça que abre a Fusão, devolver a carta
redundante e reservar um descarte para a rota seguinte”. A escolha da busca e
a devolução não podem usar prioridades independentes que se contradizem.

A memória da execução precisa registrar rota e etapa, efeito de origem,
finalidade de cada escolha, recursos reservados, alternativas e condição de
sucesso. Uma pilha de intenções separa custos e seleções de efeitos que entram
na corrente; responder ao adversário não pode sobrescrever a intenção da
ativação anterior.

As respostas são reconstruídas a partir do prompt atual. Não guardar índices
de candidatos para reutilizar depois: a lista e a posição das cartas mudam.
Distinguir cópias por identidade de instância quando disponível, acompanhando
movimentos observáveis; passcode sozinho não identifica uma cópia. Se perder
a referência, invalidar a escolha e procurar uma alternativa válida.

Uma etapa só conclui quando seu resultado é confirmado. Ter escolhido uma
ativação não significa que seu efeito resolveu. Estados que exigem corrente
encerrada devem aguardar essa confirmação, como já fazem as práticas.

### 5.3. Avaliar o estado resultante

Notas numéricas continuam úteis para comparar alternativas. A mudança é
avaliar a sequência e a posição resultante, com justificativas verificáveis,
em vez de depender apenas da nota da primeira ação.

| Dimensão | Pergunta que a avaliação precisa responder |
| --- | --- |
| Vitória e sobrevivência | A linha vence sob as hipóteses avaliadas? Evita uma derrota visível? Há risco de dano ou esgotamento do Deck? |
| Vantagem útil | Quantos recursos utilizáveis restam, considerando mão, campo, Cemitério, restrições e cartas redundantes? |
| Interação | Quantas ameaças relevantes consigo responder, em quais janelas e com quais custos? |
| Acesso e continuidade | Ainda consigo iniciar uma jogada após uma interrupção ou no próximo turno? |
| Pressão | O dano é realizável? A batalha abre caminho ou troca recursos favoravelmente? |
| Exposição | Quanto perco para uma resposta plausível? Vale colocar mais um recurso na mesa? |
| Coerência | As buscas, materiais, zonas e custos preservam a condição de vitória do deck? |

Primeiro descartar opções ilegais ou incompatíveis com os recursos conhecidos.
Depois reconhecer consequências imediatas comprovadas, comparar riscos e
benefícios e desempatar pela eficiência. Uma finalização contra campo aberto
não é garantida se ainda houver resposta oculta plausível.

Não existe peso universal para toda partida: Cemitério pode ser um recurso,
perder PV pode ser um custo aceitável e destruir uma carta própria pode
desenvolver o deck. Benefícios futuros dependem das condições de seus efeitos.

### 5.4. Batalha e correntes também fazem parte do plano

Planejar a ordem dos atacantes, a remoção necessária antes de atacar e o que
fica para a Main Phase 2. Recalcular após cada batalha ou resposta; mudar para
a Battle Phase também tem custo de oportunidade.

Nas correntes, comparar o efeito de responder agora com o de deixar resolver,
considerando o elo, efeito, alvos públicos, custos e recursos restantes.
Não adotar regras absolutas como “sempre negar a busca” ou “sempre guardar a
negação para o chefe”. O melhor ponto depende do que foi observado da rota
adversária. Efeitos opcionais e a opção de não responder precisam ser
alternativas reais quando o prompt permitir.

## 6. Exemplo piloto: Albaz Strike

Usar a lista exata de `tcg-sdaz` e as práticas existentes do guia
`albaz-strike`. O exemplo abaixo descreve objetivos de decisão; custos,
materiais e restrições devem ser conferidos no motor para cada variante.

| Situação observada | Fácil | Médio | Difícil |
| --- | --- | --- | --- |
| Kitt dá acesso à Fusão do Marcado. | Prioriza a peça de início reconhecida. | Busca a peça e escolhe a devolução preservando os custos da rota. | Compara os acessos disponíveis, a Normal, as reservas e as alternativas se a rota sofrer interrupção. |
| Há materiais para mais de uma primeira Fusão. | Usa uma rota principal compatível. | Escolhe a rota validada que consegue pagar e concluir. | Compara materiais, descarte, restrições, interação final e continuação. |
| Jadespelho pode interagir com uma ameaça. | Responde à ameaça mais evidente. | Avalia se o alvo e o custo justificam gastar a interação. | Compara usar agora, esperar ou preservar recursos, incluindo benefícios posteriores que ainda possam resolver. |
| Uma peça importante é negada. | Procura uma ação imediata disponível. | Abandona a rota inválida e usa uma alternativa conhecida. | Reavalia o objetivo, compara reconstrução e defesa e evita gastar o restante da mão sem retorno. |

A prova de inteligência é a coerência do conjunto: a busca prepara os
materiais, o descarte preserva a continuação e a interação atende a uma ameaça.
Chegar ao monstro de maior ATK não é evidência suficiente.

Depois de Albaz, usar os três guias de Heróis Lendários já exercitados para
avaliar decisões de materiais, zonas, Cemitério, recuperação e ramificações.
Manter cenários Goat desde o início, mesmo sem guias estratégicos equivalentes,
para preservar combate, remoções e gestão de recursos nesse formato.

## 7. Informação e memória justas

Todos os níveis conhecem a própria lista e as próprias cartas acessíveis,
além das informações públicas e reveladas legitimamente ao seu assento.
Nenhum nível acessa a mão oculta, os versos ou a lista privada adversária,
a ordem dos Decks ou a semente usada para determinar compras.

O fato de o lobby ou a sessão conhecer o deck adversário não autoriza o
cérebro a consultá-lo. Reconhecer um possível arquétipo pelas cartas mostradas
é uma hipótese; receber seu `opponentId` para escolher respostas é outra
fonte de informação e fica fora da proposta.

A memória registra fatos observáveis e hipóteses separadamente. Uma carta
revelada que depois é embaralhada não mantém uma localização conhecida.
Um monstro baixado sem revelação continua desconhecido, inclusive seus
atributos. O histórico entregue ao bot também deve respeitar a visibilidade
por assento, pois mensagens brutas do motor podem carregar informação privada.

No Difícil, estimar respostas possíveis a partir do formato e das evidências
da partida. Registrar hipótese, evidência e confiança; evitar tratar uma
estimativa como certeza. Inicialmente usar cenários plausíveis, sem inventar
percentuais precisos onde não existe uma base calibrada.

Teste obrigatório: duas partidas com a mesma observação para o bot, mas cartas
ocultas diferentes, devem produzir a mesma decisão quando a semente de
desempate do bot for igual. Essa semente é separada da aleatoriedade do duelo.
No modo bot × bot, aplicar esse isolamento também entre os dois cérebros.

## 8. Arquitetura proposta

Evoluir o `BotBrain` existente por camadas, preservando o mesmo caminho de
regras para navegador e servidor. Os nomes abaixo são sugestões de módulos
novos, não arquivos já disponíveis.

| Camada proposta | Responsabilidade |
| --- | --- |
| `bot/difficulty.ts` | Políticas dos níveis, limites de análise e variação reproduzível. |
| `bot/knowledge.ts` | Estado permitido ao assento, memória de fatos e hipóteses. |
| `bot/deck-profile.ts` e `src/data/bot-profiles/` | Contrato, compatibilidade, referências e perfis revisados. |
| `bot/planner.ts` | Objetivos, geração de rotas, comparação e replanejamento. |
| `bot/evaluator.ts` | Consequências, risco, recursos, continuidade e explicações. |
| `bot/intent.ts` | Intenções pendentes, reservas e confirmação entre prompts. |
| `bot/effect-handlers.ts` | Tradução de efeitos cobertos para custos, opções, alvos e materiais. |
| `bot/decision-trace.ts` | Registro reproduzível da decisão, alternativas e uso da reserva. |

`card-intel.ts` continua fornecendo dados oficiais. Funções estratégicas podem
ser múltiplas e depender do efeito e do estado, sem substituir o banco por
interpretações de nomes. `combat.ts` passa a colaborar com a análise da fase.
O `BotBrain` coordena as camadas e mantém a reserva genérica para lacunas.

### Integração com a sessão

Acrescentar a configuração do bot ao assento: dificuldade e referência ao
perfil compatível com a própria lista. Enriquecer `BotContext` com formato,
informação observável da corrente, efeito em execução e eventos filtrados
quando necessários. Nunca fornecer um atalho ao estado privado do motor.

Toda ampliação do contexto precisa chegar também aos rastreadores de
`test-bot.mjs` e `test-preset-decks.mjs`; comparar cérebros com informações
diferentes produziria uma medição inválida. Preservar a leitura preguiçosa e
memoizada do campo, já existente na sessão.

Carregar apenas os perfis necessários ao duelo. O núcleo compartilhado deve
continuar independente de React, `next/server` e recursos exclusivos do DOM.
Antes de implementar carregamento ou mudanças de interface, consultar a
documentação da versão instalada em `node_modules/next/dist/docs/`, conforme
as instruções do repositório.

### Planejamento não pressupõe copiar o motor

A interface `OcgCore` instalada não expõe uma operação de clonagem de duelo.
Um `BoardState` também não contém todo o estado interno, como flags de efeitos
e restrições acumuladas. Portanto, não assumir que copiar o tabuleiro permite
simular fielmente uma sequência arbitrária.

Na primeira entrega, usar rotas e consequências cobertas por modelos explícitos,
validados no motor, com incerteza marcada onde o modelo não conhece o efeito.
Heurísticas genéricas ajudam a ordenar alternativas; resultados aproximados
não podem ser apresentados como prova de vitória ou de legalidade.

Uma busca mais ampla pode ser investigada depois: motor isolado com mecanismo
de restauração comprovado, ou reconstrução/reprodução determinística do histórico
em cenários compatíveis com a informação do bot. Medir custo e fidelidade antes
de adotá-la. Reproduzir a partida com o estado oculto real para escolher a
melhor resposta violaria o isolamento, mesmo em uma instância separada.

## 9. Desempenho, legalidade e diagnóstico

Começar com orçamento por decisão e por quantidade de alternativas. Metas
iniciais de CPU, a validar em aparelho de referência: até 25 ms no Fácil,
100 ms no Médio e 300 ms no Difícil por decisão estratégica. Registrar mediana,
p95 e p99; escolhas auxiliares de uma mesma jogada não devem repetir toda a
busca. Esses valores são metas de engenharia, não resultados já medidos.

O orçamento deve preservar uma alternativa válida encontrada até então.
Esgotar tempo encerra a análise e escolhe essa alternativa; não significa
passar obrigatoriamente ou abandonar uma seleção obrigatória.

Busca cara precisa sair da execução que bloqueia a interface. Como `decide`
hoje é síncrono, um Worker ou análise assíncrona exige adaptar a espera na
sessão, enviar dados serializáveis e conferir se a resposta ainda corresponde
ao prompt pendente. Cancelar ao reiniciar ou encerrar; liberar o motor auxiliar.
Separar tempo de cálculo das pausas visuais de `pacing.ts`.

Validar respostas contra o contrato do prompt: candidatos, quantidades,
opções, somas e permissões de cancelar ou passar. Reutilizar os validadores
existentes quando aplicáveis, como `sum-selection.ts` e `announce-filter.ts`.
O motor permanece a autoridade final; acompanhar `RETRY` e evitar repetir a
mesma resposta rejeitada indefinidamente.

Os limites atuais de decisões e ativações são proteções, não níveis de
dificuldade. Revê-los com medição para que não interrompam rotas longas
legítimas. Somar detecção de repetição sem progresso, considerando mudanças
de estado e recursos, sem confundir uma repetição produtiva com travamento.

Cada decisão deve poder registrar: nível, perfil e revisão, observação usada,
objetivo, rota, alternativas relevantes, escolha, motivo, tempo e eventual
uso da reserva. O diagnóstico é estruturado e verificável, sem exigir uma
narrativa livre de raciocínio. Exemplo: “Preservou a única peça de acesso;
descartou a cópia redundante”.

Logs compartilhados e explicações ao vivo respeitam a visibilidade das cartas.
Um modo de explicação pode existir para treino ou revisão autorizada, sem
revelar a mão do bot durante um duelo comum.

## 10. Experiência do jogador

No lobby, acrescentar a escolha **Fácil · Médio · Difícil**, com descrições:

- **Fácil:** “Aprenda o deck e pratique suas primeiras jogadas.”
- **Médio:** “Enfrente um bot que conhece as estratégias do deck.”
- **Difícil:** “Enfrente um bot que planeja sequências e adapta suas respostas.”

Usar Médio como padrão para novas partidas e configurações antigas sem nível.
Persistir a escolha em `StoredDuelSetup`, encaminhá-la à configuração da sessão
e mantê-la na revanche. Durante a migração, a ausência de perfil usa o cérebro
genérico disponível, com cobertura informada junto do deck.

O nível acompanha o assento do bot quando muda quem começa. Em bot × bot,
permitir configurar cada lado e garantir memória independente. A seleção
não altera listas, compras, PV ou regras. A trilha de exercícios mantém seu
parceiro de treino próprio, que aguarda a lição; não deve virar um adversário
Difícil por causa da preferência do lobby.

## 11. Como comprovar a melhora

### Cenários de decisão

| Cenário | Evidência esperada |
| --- | --- |
| Busca com peça pequena necessária e monstro grande dispensável. | Escolhe a peça que completa uma rota viável. |
| Descarte com uma única peça de acesso e uma carta redundante. | Preserva o acesso quando há alternativa de custo. |
| Várias opções de material e zona. | Conclui a rota sem consumir o recurso ou a zona reservados. |
| Negação no início ou no meio de uma sequência. | Invalida a intenção afetada e procura uma alternativa legal. |
| Interação contra ameaça secundária seguida de ameaça relevante. | Compara as consequências de gastar ou preservar a resposta. |
| Dano imediato com perda de toda a defesa. | Compara finalização, sobrevivência e continuação. |
| Carta oculta substituída sem mudar a observação. | Mantém a mesma decisão com o mesmo desempate. |
| Carta revelada devolvida e embaralhada. | Descarta a associação entre identidade e localização oculta. |
| Efeito desconhecido ou perfil incompatível. | Usa análise genérica ou reserva válida e registra a lacuna. |
| Sequência longa com progresso e repetição sem progresso. | Permite a primeira e interrompe a segunda. |

Reaproveitar as mãos e os objetivos das práticas existentes, mas testar
também mãos alternativas, recursos ausentes, cartas redundantes, interrupções,
primeiro e segundo turno. Os cenários precisam chegar pelo caminho real da
sessão para verificar que a intenção recebe as informações necessárias.

### Partidas comparativas

Comparar a versão nova com a anterior, além dos pilotos passivo e guloso já
existentes. Usar os mesmos decks e sementes, com pares de assentos invertidos;
registrar também o resultado da versão anterior contra ela mesma no mesmo
protocolo. O harness atual já demonstra por que uma amostra de sementes não
precisa estar centrada exatamente em 50%.

Separar resultados por formato, deck, confronto, nível e quem começa. Incluir
espelhos e confrontos distintos: um bot pode melhorar no espelho e piorar contra
outro plano. Registrar vitórias, derrotas, empates, partidas inconclusivas,
limites excedidos, respostas rejeitadas, uso da reserva e tempo. Não transformar
travamentos ou limites de turnos em vitórias silenciosas.

A comparação entre níveis busca uma vantagem consistente do Médio sobre o
Fácil e do Difícil sobre o Médio, nas listas cobertas. Informar tamanho da
amostra e intervalo de confiança, ampliar amostras inconclusivas e manter
sementes e cenários reservados para evitar ajustar o bot apenas aos exemplos.

Para avaliar a meta de jogo profissional, combinar esses dados com revisão
das decisões por quem conhece o deck. Ganhar do cérebro anterior prova uma
melhora relativa; não comprova sozinho domínio competitivo.

### Verificações existentes a reaproveitar

```sh
npm run test:bot -- 60 passivo goat
npm run test:bot -- 60 guloso tcg
npm run test:deck-guides
npm run test:deck-learning-base
npm run test:learning
npm run test:ui
```

Esses comandos já existem e são pontos de partida, não uma bateria nova
implementada por este documento. O teste de bot também aceita `cerebro` com
`BOT_RIVAL` apontando para uma versão anterior preservada dentro de `src/`.
Para mudanças de contexto e execução, ampliar a cobertura de `test:presets`;
para o lobby, persistência, revanche e espectador, acrescentar verificações no
navegador. Executar lint, verificação de tipos e build na implementação.

## 12. Ordem de implementação e critérios de conclusão

### Etapa 1 — Medir e preparar a configuração

Registrar a referência atual, tornar diagnósticos e reservas observáveis,
definir o contrato dos níveis e encaminhar a configuração por assento.
Acrescentar ao lobby conforme houver comportamento diferenciado validado.

**Concluída quando:** configurações antigas abrem, assentos e revanche
preservam o nível, bot × bot continua isolado e a medição é reproduzível.

### Etapa 2 — Conhecimento do deck e intenção

Criar contrato e validação dos perfis, começar com Albaz e implementar as
intenções para busca, devolução, descarte, materiais, opções e resolução.
Vincular cada rota à lição e à revisão correspondentes.

**Concluída quando:** o bot executa as três práticas de Albaz na sessão real,
preserva os recursos declarados, rejeita listas incompatíveis e continua
jogando quando o perfil não está disponível.

### Etapa 3 — Planejamento e replanejamento

Comparar rotas completas e a opção de parar, integrar combate e respostas,
reservar recursos e reconstruir o plano após interrupções. Diferenciar
Fácil e Médio pela cobertura e profundidade efetivas.

**Concluída quando:** passa os cenários de alternativas e interrupção,
o Médio demonstra vantagem na avaliação e não há regressões de continuidade
nos decks Goat e TCG exercitados.

### Etapa 4 — Difícil com cobertura demonstrada

Comparar respostas adversárias plausíveis, risco e recuperação; avaliar
continuação até o próximo turno nas rotas modeladas. Ampliar o piloto para os
três guias de Heróis Lendários e validar decisões específicas desses decks.

**Concluída quando:** supera o Médio de forma sustentada na amostra reservada,
passa os cenários por perfil, mantém isolamento de informação e atende ao
orçamento de desempenho. A revisão das partidas deve sustentar a qualidade
competitiva anunciada para cada perfil.

### Etapa 5 — Ampliar a cobertura

Converter os demais guias em perfis por prioridade de uso, validando as rotas
antes de ativá-las. Acrescentar conhecimento genérico e cobertura Goat ao longo
do processo. Publicar por deck quais planos estão cobertos e suas limitações.
Uma eventual busca com simulação ampla exige investigação própria de
fidelidade, custo e isolamento.

O primeiro marco útil é **Albaz com plano, intenção entre prompts e recuperação
após interrupção**, sustentado por comparação com o cérebro atual. Esse piloto
permite validar a arquitetura antes de multiplicá-la para a biblioteca inteira.
