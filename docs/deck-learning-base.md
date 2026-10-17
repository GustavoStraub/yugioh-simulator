# Base editorial de aprendizado dos decks

Esta base reúne planos e roteiros em português publicados na área `/aprender` pelo adaptador `src/lib/data/deck-learning-adapter.ts`. O arquivo `src/data/deck-learning-base.json` conserva o contrato de autoria editorial (schemaVersion 1, revisão 2026-10-16), com mãos e prática nulas para as novas estratégias. O adaptador preserva as 12 práticas executáveis dos quatro JSONs históricos e acrescenta as 196 leituras, sem inventar objetivos de execução.

## Escopo e critérios

A cobertura contém exatamente 110 presets TCG: 92 selecionados e 18 excluídos. Não inclui presets GOAT; as cópias TCG com equivalente GOAT são explicitamente excluídas. A seleção é editorial: uma exclusão não significa que o deck não tenha qualquer jogada possível, apenas que não foi aceito no recorte de estratégia da base. A seleção editorial privilegia motores estratégicos presentes na lista exata; listas introdutórias, produtos de tutorial ou listas sem motor suficiente recebem justificativa individual. Não se acrescentam cartas de versões posteriores ou de múltiplas caixas.

São 208 lições: 12 importadas dos quatro guias ativos e 196 novas. Os quatro guias existentes têm oito lições cada (três importadas, seguidas de cinco novas); os demais têm duas. Há 496 referências globais, incluindo fontes oficiais de efeitos verificadas e fontes preservadas dos guias ativos.

## Fontes e limites

Os efeitos oficiais verificados têm URL e data de acesso por carta, sem reprodução integral do efeito. Os roteiros são adaptações autorais baseadas nesses efeitos, não combos atribuídos a publicações nem sequências validadas no motor. Fontes publicadas indicadas por deck são referências complementares; não se afirma revisão integral. Os passos novos identificam apenas nomes completos explicitamente escritos na ação, em inglês ou português; abreviações podem resultar em cardCodes vazio. Mãos iniciais e prática das novas lições são nulas. As lições importadas preservam suas mãos, preparação, passos e fontes, mas também têm prática nula nesta base.

No app, uma estratégia apresenta seu cenário e etapas, permite consultar cartas
e fontes, retomar a etapa e concluir explicitamente a leitura. Essa conclusão
fica separada da execução dos exercícios na mesa. Os quatro guias históricos
mantêm suas URLs e chaves de progresso. O seletor de decks usa um índice leve
de rotas e a biblioteca recebe resumos do servidor, com busca e carregamento
de 12 guias por vez.

## Decks e lições

### Starter Deck: Syrus Truesdale (`tcg-ysds`)

Preservar presença na batalha e reciclar roids da lista com Expressroid e Ambulanceroid; estratégia de atrito, sem Fusões.

- Expressroid transforma o Cemitério em reposição
- Comprar sem abandonar o campo

### Starter Deck: Yu-Gi-Oh! 5D's (`tcg-5ds1`)

Reanimar um monstro pequeno com Junk Synchron e convertê-lo em Junk Warrior; o restante da mesa pode aumentar o ATK do Sincro.

- Uma Invocação-Normal vira Junk Warrior
- Preparar o bônus antes da Sincro

### Starter Deck: Yu-Gi-Oh! 5D's 2009 (`tcg-5ds2`)

Usar Road Synchron e corpos pequenos para Road Warrior; o chefe traz outro Guerreiro ou Máquina pequeno do Deck.

- Planejar os três materiais de Road Warrior
- A rota curta de Junk Warrior

### Starter Deck: Duelist Toolbox (`tcg-5ds3`)

Reviver Reguladores Synchron e aproveitar vários não-Reguladores para remover cartas com Junk Destroyer.

- Explorer recupera o Regulador
- Hedgehog amplia a soma

### Starter Deck: Dawn of the Xyz (`tcg-ys11`)

Converter pares de níveis iguais em Xyz; escolher entre defesa com Gachi Gachi e pressão com Utopia.

- Utopia pede dois Níveis 4
- Preservar corpos com Gachi Gachi

### Starter Deck: Xyz Symphony (`tcg-ys12`)

Goblindbergh e Gogogo Giant produzem pares para Xyz; os Djinn oferecem respostas diferentes de Utopia.

- Goblindbergh acelera o Classe 4
- Giant reaproveita Gogogo Golem

### Deck Inicial - Kaiba Reloaded (`tcg-yskr`)

Acessar Blue-Eyes por Tributo eficiente e reciclar Dragões Normais; uma estratégia simples de monstros grandes.

- Um monstro paga os dois Tributos
- Reanimação vira combustível

### Deck Inicial - Yugi Reloaded (`tcg-ysyr`)

Alternar vantagem de cartas com Gadgets e acesso ao Dark Magician usando as Magias da própria lista.

- Cada Gadget deixa o próximo pronto
- Três Magias acessam Dark Magician

### Super Deck Inicial: V de Vitória (`tcg-ys13`)

Ajustar níveis com Gagaga para Utopia e reservar Utopia Ray como finalização condicional.

- Child acompanha o Nível
- Utopia Ray é uma escolha de emergência

### Deck Inicial - Yuya (`tcg-ys16`)

Montar escalas Performapal, repor a mão e devolver monstros Pêndulo ao campo para pressão de batalha.

- As escalas determinam quem entra
- Odd-Eyes prepara a mão seguinte

### Deck Inicial: Ataque Link (`tcg-ys17`)

Transformar Draconnet e um Monstro Normal em materiais Link, ampliando a mesa com Linkslayer.

- Draconnet inicia a progressão Link
- Chegar ao Decode Talker

### Deck Inicial: Decifrador de Códigos (`tcg-ys18`)

Combinar extensores Ciberso com Link Spider para chegar a Transcode Talker e recuperar um Link já usado.

- Widget Kid produz dois Cibersos
- Transcode recupera o Link

### Structure Deck: Warrior's Triumph (`tcg-sd5`)

Buscar Guerreiros adequados à mesa e reaproveitar Equipamentos; os ataques múltiplos de Mataza tornam os bônus relevantes.

- Buscar o Guerreiro que resolve o turno
- Equipamentos multiplicam pressão

### Structure Deck: Dinosaur's Rage (`tcg-sd09`)

Usar destruição e banimento de Dinossauros como recursos, alternando Hydrogeddon e Tyranno Infinity.

- Hydrogeddon recompensa vencer a batalha
- Banir alimenta Tyranno Infinity

### Structure Deck: Invincible Fortress (`tcg-sd7`)

Reutilizar efeitos de virar monstros Rocha e controlar o campo com Guardian Sphinx, usando Exxod como dano adicional.

- Guardian Sphinx reinicia a mesa adversária
- A Invocação-Virar vira dano com Exxod

### Structure Deck: Lord of the Storm (`tcg-sd8`)

Aproveitar Harpie Lady e o Campo para limpar retaguarda, protegendo os monstros enquanto pressiona por batalha.

- A Invocação das Harpias remove retaguarda
- Hysteric Party reconstrói a presença

### Structure Deck: Spellcaster's Judgment (`tcg-sd6`)

Acumular Marcadores de Magia e converter Magias em vantagem com Breaker e Skilled Dark Magician.

- Magias preparam Dark Magician
- Transformar Dark Magician em dano

### Rise of the Dragon Lords Structure Deck (`tcg-sdrl`)

Enviar Dragões grandes ao Cemitério e reanimá-los; Felgrand original exige passagem anterior pelo campo.

- Descartar o alvo que realmente pode voltar
- Respeitar a condição do Felgrand antigo

### Structure Deck: Machine Re-Volt (`tcg-sd10`)

Manter reposição de mão com Gadgets e aproveitar seus benefícios como Tributos para Ancient Gear Gadjiltron Dragon.

- Gadgets sustentam as trocas
- Gadjiltron por Tributo com benefício

### The Dark Emperor Structure Deck (`tcg-sdde`)

Banir monstros que retornam na Fase Final para manter Tributos recorrentes, combinando D.D. Survivor e Caius.

- O Tributo retorna no fim do turno
- Scout Plane aceita outros pontos de partida

### Zombie World Structure Deck (`tcg-sdzw`)

Transformar o campo e os Cemitérios em Zumbis para reanimar recursos e explorar o tipo dos monstros adversários.

- Zombie Master recicla o campo
- Book of Life muda os dois Cemitérios

### Spellcaster's Command Structure Deck (`tcg-sdsc`)

Guardar Marcadores em Magical Citadel e gastá-los para invocar Endymion e recuperar uma Magia.

- Seis marcadores acessam o chefe
- Administrar o banco de marcadores

### Warriors' Strike Structure Deck (`tcg-sdws`)

Usar Supervise para habilitar efeitos Gemini e converter sua saída em reanimação de um Monstro Normal.

- Chevalier transforma Supervise em troca dupla
- Blazewing entrega um Gemini já habilitado

### Machina Mayhem Structure Deck (`tcg-sdmm`)

Gearframe busca Fortress, que transforma Máquinas da mão em pressão e retorna do Cemitério.

- Gearframe encontra a ameaça
- O Union preserva o chefe

### Structure Deck: Marik (`tcg-sdma`)

Usar Gravekeeper's Spy e Necrovalley para estabelecer presença e restringir o Cemitério; não tratar a lista como um motor Ra moderno.

- Spy produz o segundo Gravekeeper
- Commandant acessa a restrição

### Dragunity Legion Structure Deck (`tcg-sddl`)

Equipar Dragões Dragunity aos portadores e converter Aklys em remoção, sem acrescentar Sincros ausentes do produto.

- Legionnaire e Aklys removem duas cartas
- Ravine prepara a peça que falta

### Gates of the Underworld Structure Deck (`tcg-sdgu`)

Descartar Dark World por efeitos para buscar, comprar e colocar Grapha repetidamente no campo.

- Gates converte o descarte em vantagem
- Grapha volta sem consumir sua peça menor

### Lost Sanctuary Structure Deck (`tcg-sdls`)

Earth encontra Agents; Venus fornece corpos pequenos e Hyperion converte Fadas no Cemitério em invocação e remoção.

- A busca prepara o turno de Venus
- Hyperion usa o Cemitério duas vezes

### Dragons Collide Structure Deck (`tcg-sddc`)

Preparar LUZ e TREVAS no Cemitério para Dragões Chaos e recuperar ameaças de Nível alto.

- Eclipse transforma banimento em acesso
- Lightpulsar deixa uma continuação

### Realm of the Sea Emperor Structure Deck (`tcg-sdre`)

Enviar Atlanteans ao Cemitério para ativar efeitos de monstros de ÁGUA, gerando busca e destruição junto da ação principal.

- Abyss Soldier transforma o custo em remoção
- Diva e Infantry desenvolvem os corpos

### Samurai Warlords Structure Deck (`tcg-sdwa`)

Reunir Six Samurai de nomes diferentes para liberar extensores e converter Invocações em marcadores de vantagem.

- United precisa entrar antes dos Samurais
- Dois Kizan formam o Xyz da caixa

### Investida dos Reis de Fogo Deck Estrutural (`tcg-sdok`)

Destruir os próprios FIRE para ativar reposição e o retorno de Garunix; vencer por pressão recorrente e limpezas de campo.

- Onslaught prepara Garunix para voltar
- Circle faz a troca com o Cemitério

### Saga do Dragão Branco de Olhos Azuis Deck Estrutural (`tcg-sdbe`)

Transformar o efeito de Maiden e a soma de níveis em Blue-Eyes e Azure-Eyes; preservar Dragões Normais para reanimação.

- Maiden converte um alvo em Blue-Eyes
- Maiden e Blue-Eyes viram Azure-Eyes

### Revolução do Dragão Cibernético Deck Estrutural (`tcg-sdcr`)

Core encontra suporte e Drei iguala os Níveis para Nova; preservar recursos de Máquina para reanimação ou Fusão.

- Core encontra o suporte, não o corpo
- Drei prepara o Classe 5

### Ofensiva Engrenagi Deck Estrutural (`tcg-sdgr`)

Usar Geargiarmor para buscas recorrentes e Geargiaccelerator para transformar presença em Gear Gigant X.

- Armor busca o extensor
- A Armadilha produz dois Níveis 4

### Reino da Luz Deck Estrutural (`tcg-sdli`)

Enviar Lightsworn por efeitos para alimentar o Cemitério, reviver com Lumina e alcançar Judgment Dragon ou Michael.

- Lumina e Raiden formam Michael
- Quatro nomes liberam Judgment Dragon

### Ataque do HERÓI Deck Estrutural (`tcg-sdhs`)

Invocar Shadow Mist especialmente para encontrar Mask Change e construir Dark Law, respeitando a escolha de um único efeito de Mist por turno.

- Monk encontra Mist e Mask Change
- Form Change muda a resposta

### Mestre do Pêndulo Deck Estrutural (`tcg-sdmp`)

Montar escalas Magician com busca e recuperação, escolhendo a rota de Sincro ou Classe 7 conforme os níveis disponíveis.

- Wisdom-Eye corrige a escala
- Nobledragon usa Odd-Eyes sem desperdiçá-lo

### Sincron Extremo Deck Estrutural (`tcg-sdse`)

Reciclar Reguladores Synchron e construir uma Sincro Reguladora junto de outra Sincro para chegar a Stardust Warrior.

- Jet Synchron retorna para Jet Warrior
- A soma para Stardust Warrior

### Imperador das Trevas Deck Estrutural (`tcg-sr01`)

Gerar dois corpos com Edea/Eidos e usar Tributos de Monarch para remover recursos, com Domain restringindo o Extra adversário.

- Edea e Eidos pagam o Monarch
- Stormforth muda quem paga o Tributo

### Renascimento dos Verdadeiros Dragões Deck Estrutural (`tcg-sr02`)

Preparar Dragões de Nível 7/8 no Cemitério e reanimar Felgrand ou Arkbrave para remoção e continuidade.

- Felgrand reanimado remove por banimento
- Arkbrave prepara a próxima Fase de Apoio

### Deck Estrutural: Seto Kaiba (`tcg-sdks`)

Fazer circular A, B e C entre campo e Cemitério para ABC-Dragon Buster; os Unions repõem peças quando deixam o campo.

- Hangar busca e equipa a peça
- ABC converte as três peças em interação

### Deck Estrutural: Yugi Muto (`tcg-sdmy`)

Os Electromagnet Warriors buscam e desenvolvem peças para Berserkion, depois trocam-se por Magnet Warriors durante o turno adversário.

- Beta encontra Gamma e prepara a mesa
- Berserkion gasta e devolve as peças

### Deck Estrutural Fúria do Dinosmagador (`tcg-sr04`)

Oviraptor busca ou prepara o Cemitério; Ultimate Conductor Tyranno transforma a destruição dos próprios Dinossauros em pressão.

- Oviraptor escolhe acesso ou preparação
- O custo de Tyranno também desenvolve

### Deck Estrutural Reação das Máquinas (`tcg-sr03`)

Buscar Ancient Gear e destruir Geartown ou Ancient Gear Fortress para trazer Reactor Dragon; atacar reduzindo respostas de retaguarda.

- Catapult e Geartown põem dois chefes em jogo
- Wyvern define o restante do turno

### Dominação Pêndulo Deck Estrutural (`tcg-sdpd`)

Kepler encontra Contratos, Gate busca D/D e Lamia viabiliza Siegfried usando um D/D/D não-Regulador; administrar os custos da Fase de Apoio.

- Kepler transforma a Normal em busca
- Lamia e Apocalypse fazem Siegfried

### Deck Estrutural: Link Ciberso (`tcg-sdcl`)

Gerar materiais Ciberso com Balancer Lord e Dotscaper, alinhando Links para aproveitar efeitos de ligação mútua.

- Balancer Lord concede outra Normal
- Dotscaper repõe um material Link

### Deck Estrutural: Covil das Trevas (`tcg-sr06`)

Lair of Darkness permite pagar custos de Tributo com um monstro adversário de TREVAS; Lilith e Diabolos convertem esses Tributos em controle.

- Ahrima localiza o Campo
- Lilith paga com o monstro adversário

### Deck Estrutural: Podercodificar Link (`tcg-sdpl`)

Produzir corpos de Ciberso e Fichas para Powercode Talker; aproveitar Sea Archiver quando uma invocação ocorrer em zona apontada.

- Debug encontra um Ciberso pequeno
- Gadget reaproveita um corpo e deixa Ficha

### Deck Estrutural: Onda de Luz (`tcg-sr05`)

Manter Fadas de benefício no campo e trocar Counter Traps por negação, compra e aumento de ATK.

- Artemis transforma negação em compra
- Ariadne reduz o custo de Parshath

### Deck Estrutural: Horda Zumbi (`tcg-sr07`)

Estabelecer Zombie World e Doomking, enviando Banshee e Bloom ao Cemitério com o motor Uni-Zombie.

- Solitaire acessa Uni-Zombie e o Campo
- Bloom coloca Doomking no campo

### Deck Estrutural: Ordem dos Magos (`tcg-sr08`)

Ativar Magias para alimentar escalas Endymion e converter três marcadores de Servant em dois monstros, preservando acesso à negação.

- Servant transforma três Magias em desenvolvimento
- Endymion conserva o recurso da negação

### Deck Estrutural: Revolta do Foguette (`tcg-sdrr`)

Quick Launch e Tracer desenvolvem Rokkets; usar destruição planejada para substituir os corpos e construir Borreload ou Furious.

- Tracer transforma uma carta em outro Rokket
- Rapid Trigger faz Furious destruindo materiais

### Deck Estrutural: Queima-almas (`tcg-sdsb`)

Gazelle prepara o Cemitério; Sanctuary permite reencarnação de Link e recuperar Roar para negar uma ação adversária.

- Balelynx encontra Sanctuary e abre Gazelle
- Reencarnação recupera Roar

### Deck Estrutural: Loucura Mecanizada (`tcg-sr10`)

Descartar Máquinas prepara Fortress e Citadel; destruir suas Máquinas de TERRA permite que Citadel retorne e limpe monstros.

- Redeployment escolhe duas peças
- Citadel transforma destruição em resposta

### Deck Estrutural: Bestas Sagradas (`tcg-sdsa`)

Usar Dark Beckoning Beast e Spirit Gates para acessar os invocadores das Bestas Sagradas e manter Fallen Paradise.

- Beckoning acessa o invocador
- Paradise sustenta a vantagem

### Deck Estrutural: Confronto Sombraneco (`tcg-sdsh`)

Fundir usando Shaddolls enviados por efeito para encadear vantagem; escolher Construct, Winda ou Apkallone conforme a interação necessária.

- A Fusão usa o Deck sob uma condição
- El Shaddoll Fusion muda a resposta

### Deck Estrutural: Encantadoras Espirituais (`tcg-sdch`)

Reunir Atributos diferentes para Awakening of the Possessed e usar Possessed Partnerships como reanimação e remoção.

- Spirit Charmers prepara monstro e suporte
- Partnerships transforma Atributos em remoção

### Deck Estrutural: Golpe Cibernético (`tcg-sdcs`)

Cyberdark Claw e Realm encontram o motor; Horizon prepara Cyber End no Cemitério e Chimera habilita Power Bond com materiais do Cemitério.

- Claw encontra Realm e Chimera
- Cyberdark End exige a preparação completa

### Deck Estrutural: Correntes Glaciais (`tcg-sdfc`)

Revealer traz um Regulador, Speaker estende a mesa e Hexa ajusta níveis para as Sincros Ice Barrier presentes no Extra.

- Revealer e Speaker produzem materiais
- Escolher qual Trishula cabe na soma

### Deck Estrutural: Golpe de Arbaz (`tcg-sdaz`)

Acessar Branded Fusion, escolher a rota até Mirrorjade e administrar os recursos de Albaz para interagir e continuar em turnos posteriores.

- Sua primeira sequência até Jadespelho
- Uma alternativa sem o descarte
- Quando a magia não vem na mão
- Sarcófago vira acesso à Fusão
- Mirrorjade transforma Albion em recurso futuro
- Mercourier é uma escolha de material e proteção
- Albaz usa um monstro adversário como material
- Albion Encoberto prepara recuperação de Branded

### Deck Estrutural: Mundo Negro (`tcg-sr13`)

Genta e Gates encadeiam descartes por efeito; a nova Fusão Grapha converte materiais do Cemitério em uma interação que também pode ativar Dark World.

- Genta coloca Gates e retorna
- Accession faz Grapha e prepara o descarte

### Deck Estrutural: Lenda das Feras Cristalinas (`tcg-sdcb`)

Sapphire Pegasus e Crystal Bond alimentam as Zonas de Magias/Armadilhas; Rainbow Bridge of the Heart transforma essa presença em busca e devolução.

- Bond prepara dois pontos do motor
- Conclave transforma destruição em desenvolvimento

### Deck Estrutural: Cuidado com Armadilhatrix (`tcg-sdbt`)

Sera converte Armadilhas Normais em monstros e os efeitos Traptrix em mais Armadilhas; Holeutea e Pinguicula ampliam a mesa.

- Myrmeleo vira Sera e prepara Holeutea
- Dionaea transforma Cemitério em Classe 4

### Deck Estrutural: Reis de Fogo (`tcg-sr14`)

Ponix encontra Sanctuary e Island; destruir FIRE prepara Sacred Garunix, Kirin e retornos em Fases de Apoio.

- Ponix acessa os dois Campos do plano
- Kirin responde e recupera o Cemitério

### Deck Estrutural: O Rei Carmesim (`tcg-sdck`)

Soul Resonator encontra Bone Archfiend para Red Rising; reciclar Resonators permite escalar para Scarred e Abyss.

- Soul e Bone chegam a Scarred
- Scarred vira Abyss e deixa outro Dragão

### Deck Estrutural: Destino Branco de Olhos Azuis (`tcg-sdwd`)

Sage, Maiden of White e Wishes estabelecem True Light, Blue-Eyes e Reguladores; as Sincros oferecem interação e retorno de Dragões.

- Maiden prepara True Light
- Spirit Dragon entrega outro Sincro

### Deck dos Deuses Egípcios: Obelisco, o Atormentador (`tcg-ego1`)

Produzir Tributos e usar Soul Crossing para chegar a Obelisk; as Magias específicas convertem a presença do Deus em controle.

- Soul Crossing usa os recursos adversários
- Fist of Fate depende do Deus presente

### Deck dos Deuses Egípcios: Slifer, o Dragão Celeste (`tcg-egs1`)

Produzir Tributos para Slifer e preservar a mão para seu ATK; Thunderforce Attack pode repor cartas na sua Fase Principal.

- Skyblaster ajuda a reunir os Tributos
- Thunderforce protege e recompõe a mão

### Decks Lendários do Yugi — Battle City (`tcg-ygld-battle-city`)

Usar o pequeno motor de Dark Magician e as Fusões presentes, sem atribuir à lista o suporte moderno que ela não contém.

- Curtain entrega Dark Magician e remoção
- Gazelle e Berfomet usam a Fusão da caixa

### Decks Lendários do Yugi — Gadget (`tcg-ygld-gadget`)

Repor a mão com os três Gadgets e transformar o conjunto em pressão de Stronghold, mantendo as linhas de Silent separadas.

- A sequência de cores mantém recursos
- Stronghold exige as três cores no campo

### Decks Lendários II — Joey (`tcg-ldk2-joey`)

Preparar os materiais corretos para Archfiend Black Skull Dragon e recuperar Red-Eyes com Stone; não tratar Gemini no Deck como Monstro Normal.

- A Fusão exige o Archfiend como Normal
- Stone acessa Red-Eyes sem a Fusão

### Decks Lendários II — Kaiba (`tcg-ldk2-kaiba`)

As White Stones e os Eyes of Blue acessam Blue-Eyes e Dragon Spirit of White; Sincros de Nível 9 dão continuidade.

- Ancients transforma um envio em invocação futura
- Protector converte um corpo em Blue-Eyes

### Decks Lendários II — Yugi (`tcg-ldk2-yugi`)

Obliterate envia partes de Exodia ao Cemitério para Exodia Incarnate, que as devolve à mão e pressiona por batalha.

- Obliterate prepara a encarnação
- Incarnate troca uma parte por pressão

### Decks de Dragões Lendários — Cyber Dragon (`tcg-ledd-cyber-dragon`)

Core acessa o suporte e pares de Nível 5 fazem Nova/Infinity; as Fusões de contato usam zonas adversárias específicas para remover ameaças.

- Nova vira Infinity nesta edição
- Escolher entre Megafleet e Fortress

### Decks de Dragões Lendários — Dimensional Dragons (`tcg-ledd-dimensional-dragons`)

Arc Pendulum transforma destruição de Odd-Eyes em desenvolvimento; Absolute e as Fusões oferecem escolhas de interação.

- Sky Iris liga Arc Pendulum
- Absolute deixa Vortex ao ir ao Cemitério

### Decks de Dragões Lendários — Legendary Dragons of Atlantis (`tcg-ledd-legendary-dragons-of-atlantis`)

Magician's Rod encontra Magias/Armadilhas que mencionam Dark Magician; Timaeus e as Armadilhas sustentam o controle com Dark Magician the Dragon Knight.

- Rod acessa a peça de controle
- Dragon Knight protege Eternal Soul

### Decks de Heróis Lendários — Aesir (`tcg-lehd-aesir`)

Gullveig concentra a abertura, mas escolher materiais, posição e Regulador no Cemitério determina proteção e retorno dos Aesir.

- Chegue a Thor
- Chegue a Odin
- Chegue a Loki
- Vanadis muda a receita sem mudar o destino
- A invocação flexível pode perder a volta de Thor
- Valquíria faz Odin sem Gullveig
- Gullveig protege pela seta
- Aesir retorna apenas na Fase Final correta

### Decks de Heróis Lendários — Destiny HERO (`tcg-lehd-destiny-hero`)

Usar buscas, Fusões e Malicious para gerar corpos, alternando Dark Law, Dystopia e Plasma conforme a partida; preservar reciclagem por Wonder Driver.

- Fusão e continuação com Malicioso
- Mudar a Máscara e manter recursos
- Três corpos para Plasma
- Dynatag habilita a destruição de Dystopia
- Wonder Driver recupera a magia usada
- Destiny Draw transforma Malicious em desenvolvimento
- Celestial recompensa um turno de recursos esgotados
- Drilldark amplia a rota de Wonder Driver

### Decks de Heróis Lendários — Phantom Knights (`tcg-lehd-phantom-knights`)

Usar o Cemitério como motor de buscas e reanimação; Broken Sword abre Classe 4 e Bardiche transforma Xyz de TREVAS em remoção.

- Sua primeira Espada Quebrada
- Bardiche Enferrujado prepara sua defesa
- O Cemitério também é sua mão
- Espada Quebrada abre o Classe 4
- Rebelião sem materiais vira Réquiem
- A seta de Bardiche transforma Xyz em remoção
- Fog Blade tem duas funções em turnos diferentes
- Ragged Gloves prepara a Armadilha certa

### Decks Lendários 5D's — Akiza (`tcg-l5dd-akiza`)

Roxrose encontra Basal Rose Shoot e Red Rose desenvolve materiais quando usada em Sincro; Black Rose limpa e Moonlight devolve ameaças.

- Roxrose encontra a reanimação
- Red Rose deixa material após a Sincro

### Decks Lendários 5D's — Crow (`tcg-l5dd-crow`)

Whirlwind transforma Invocações-Normais Blackwing em buscas; Sudri e Vata preparam Sincros e Black-Winged Dragon.

- Whirlwind recompensa a Invocação-Normal
- Vata chega a Black-Winged Dragon

### Decks Lendários 5D's — Yusei (`tcg-l5dd-yusei`)

Junk Converter encontra Synchron e prepara o Cemitério; Junk Speeder transforma a primeira Sincro em Reguladores de níveis distintos.

- Converter e um Regulador chegam a Speeder
- Doppelwarrior acompanha a reanimação

### Decks Lendários ARC-V — Lunalight (`tcg-lavd-lunalight`)

Kaleido Chick ajusta o nome do material e Tiger/Yellow Marten reciclam corpos; as Fusões Lunalight convertem esse motor em finalização por batalha.

- Chick prepara o nome, não invoca a Fusão
- Tiger e Marten reabrem desenvolvimento

### Decks Lendários ARC-V — Odd-Eyes (`tcg-lavd-odd-eyes`)

Usar buscas Performapal e escalas Odd-Eyes para reunir materiais; Absolute/Vortex e Rebellion oferecem interação ou finalização.

- Joker encontra a escala que falta
- Dois TREVAS de Nível 4 abrem Arc Rebellion

### Decks Lendários ARC-V — Speedroid (`tcg-lavd-speedroid`)

Terrortop encontra Taketomborg e Red-Eyed Dice ajusta os níveis; Sincros e Rubber Band Shooter ampliam as opções dentro da restrição VENTO.

- Terrortop e Dice fazem Cork Shooter
- Kitedrake escolhe limpar ou negar

### Decks Lendários Modern 2026 — Mitsurugi (`tcg-l26d-mitsurugi`)

Ritualizar usando os Reptiles como Tributos permite buscas e reposição; os chefes Mitsurugi podem voltar depois de servir para outro Ritual.

- Saji e Kusanagi pagam o Ritual e repõem recursos
- O Ritual anterior pode retornar

### Decks Lendários Modern 2026 — Sky Striker (`tcg-l26d-sky-striker`)

Manter a Zona de Monstros Principal livre para as Magias Sky Striker, acumular três Magias no Cemitério e reciclar recursos por Kagari e Shizuku.

- Area Zero e Raye preservam a busca
- Kagari recupera a Magia do turno

### Decks Lendários Modern 2026 — X-Saber (`tcg-l26d-x-saber`)

Boggart Knight desenvolve o segundo X-Saber, Faultroll entra com dois corpos e Gottoms converte presença em pressão sobre a mão adversária.

- Dois X-Sabers liberam Faultroll
- Gottoms transforma corpos em descarte

### Coleção Nobre Cavaleiros da Tavola Redonda (`tcg-nkrt`)

Equipar Noble Arms habilita Medraut e Borz; os Equipamentos voltam após destruição e alimentam os Xyz Artorigus.

- Medraut transforma um Equipamento em segundo Cavaleiro
- Borz prepara três Noble Arms

### O DECK DAS CRÔNICAS: O Caído e A Virtuosa (Edição Totalmente Metalizada) (`tcg-ch01`)

Branded com Aluber, Quem e Cartesia amplia as rotas de Albaz; usar as Fusões para interromper e recuperar recursos na Fase Final.

- Aluber acessa Branded Fusion sem devolver carta
- Cartesia vira Granguignol e prepara outra peça

### O DECK DAS CRÔNICAS: Encantadoras Espirituais (Edição Totalmente Metalizada) (`tcg-ch02`)

Combinar Charmers/Channelers e Atributos variados com Possessed para acumular recursos; os Links desta edição ampliam recuperação e finalização.

- Possessed mantém o plano de Atributos
- Um Charmer Link pode alimentar Selene

## Exclusões

- `tcg-sdk` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sdy` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sdj` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sdp` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-ske` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sye` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-ysd` — fundamentals-only: Lista introdutória de combate e Tributos, sem motor estratégico coeso suficiente para uma trilha própria.
- `tcg-ysdj` — fundamentals-only: O produto não inclui Extra Deck de Fusões; não atribuir a esta lista as linhas de HERO dos produtos posteriores.
- `tcg-ys14` — fundamentals-only: A dupla de escalas apresenta Pêndulo, mas a lista é principalmente introdutória; não importar combos de Magician que não estão nela.
- `tcg-ys15-dark-legion-starter-deck` — fundamentals-only: Lista introdutória em torno de Pendragon, sem o motor D/D dos produtos completos.
- `tcg-ys15-saber-force-starter-deck` — fundamentals-only: Lista introdutória de monstros de Tributo, sem um motor Odd-Eyes completo.
- `tcg-sd3` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sd1` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sd4` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-sd2` — goat-counterpart: Produto também disponível na coleção GOAT; fora do recorte solicitado, inclusive sua cópia TCG.
- `tcg-stas-synchro` — fundamentals-only: Deck do tutorial roteirizado para dois jogadores; receitas de Sincro isoladas não justificam uma trilha estratégica nesta base.
- `tcg-stax-xyz` — fundamentals-only: Deck do tutorial roteirizado para dois jogadores; a presença de ZEUS não transforma a lista inteira em um motor Xyz coeso.
- `tcg-ygld-exodia` — insufficient-engine: Contém uma condição de vitória real, mas é uma lista comemorativa dispersa sem motor de compra/busca de Exodia. Não inventar um combo consistente para ela.

## Promover uma estratégia a exercício na mesa

1. Conferir o preset e as fontes oficiais atuais, incluindo limites, custos e restrições; revisar o texto editorial.
2. Declarar mão e mesa iniciais possíveis, quantidades e recursos do adversário quando necessários.
3. Preencher practice com objetivos, etapas e condições observáveis.
4. Reproduzir cada sequência no motor com a lista completa e verificar recursos, estados finais e restrições.
5. Revisar fontes e conteúdo; somente então publicar a prática executável no
   guia e executar suas verificações de conteúdo e navegador. A leitura já
   publicada não deve ser rotulada como exercício antes dessa validação.

## Pendências de empacotamento

Nenhuma pendência de resolução de nomes ou evidências na geração atual.
