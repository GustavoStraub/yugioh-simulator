/**
 * Glossário dos termos que aparecem no texto das cartas.
 *
 * A Duel Academy do Tag Force ensinava "Invocação-Tributo" numa aula; aqui o
 * termo é explicado onde ele aparece — na leitura da carta, sublinhado, com a
 * definição a um toque. Vale para o texto em português e em inglês (o seletor
 * PT/EN da navegação), por isso cada termo tem as duas grafias.
 */
export interface GlossaryTerm {
  id: string;
  /** Nome do termo como a definição o chama. */
  label: string;
  definition: string;
  /** Grafias reconhecidas no texto (PT e EN), sem diferença de caixa. */
  aliases: string[];
  /** Grafias que só valem com esta caixa exata ("Set", e não "set"). */
  exactCase?: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "normal-summon",
    label: "Invocação-Normal",
    definition:
      "Pôr um monstro da mão no campo com a face para cima — uma por turno. Nível 5 ou 6 pede 1 Tributo; Nível 7 ou mais, 2.",
    aliases: ["Invocação-Normal", "Invocado por Invocação-Normal", "Normal Summoned", "Normal Summon"],
  },
  {
    id: "special-summon",
    label: "Invocação-Especial",
    definition:
      "Invocação feita por efeito de carta ou por regra (Fusão, Sincro, Xyz, Link, Ritual, Pêndulo). Não gasta a Invocação-Normal do turno e pode acontecer várias vezes.",
    aliases: [
      "Invocação-Especial",
      "Invocar por Invocação-Especial",
      "Invocado por Invocação-Especial",
      "Special Summoned",
      "Special Summon",
    ],
  },
  {
    id: "tribute",
    label: "Tributo",
    definition:
      "Mandar monstros seus para o Cemitério como custo — para a Invocação-Tributo de um monstro de Nível alto, ou para um efeito que pede Tributo.",
    aliases: ["Invocação-Tributo", "Tributo", "Tributos", "Tribute Summon", "Tribute"],
  },
  {
    id: "set",
    label: "Baixar",
    definition:
      "Pôr uma carta virada para baixo: monstro em Posição de Defesa, ou Magia/Armadilha na fileira de Magias e Armadilhas.",
    aliases: ["Baixar", "baixado", "baixada", "baixados", "baixadas"],
    exactCase: ["Set"],
  },
  {
    id: "flip",
    label: "FLIP",
    definition:
      "Virar para cima um monstro baixado. Efeitos marcados \"FLIP:\" ativam quando o monstro é virado — inclusive ao ser atacado.",
    aliases: ["FLIP", "Flip Summon", "Invocação-Virar"],
  },
  {
    id: "graveyard",
    label: "Cemitério",
    definition:
      "A pilha das cartas destruídas, usadas ou descartadas. É pública: qualquer jogador pode olhar a qualquer hora.",
    aliases: ["Cemitério", "GY", "Graveyard"],
  },
  {
    id: "banish",
    label: "Banir",
    definition:
      "Remover a carta do jogo: ela vai para a pilha de banidas, fora do Cemitério, e a maioria dos efeitos não a alcança mais.",
    aliases: ["banir", "banida", "banido", "banidas", "banidos", "banish", "banished"],
  },
  {
    id: "extra-deck",
    label: "Extra Deck",
    definition:
      "Deck à parte com os monstros de Fusão, Sincro, Xyz e Link (e Pêndulos que voltam com a face para cima). Não se compra dele: invoca-se.",
    aliases: ["Extra Deck"],
  },
  {
    id: "chain",
    label: "Corrente",
    definition:
      "Ativações em resposta umas às outras. Resolve de trás para frente: o último elo ativado é o primeiro a resolver.",
    aliases: ["Corrente", "Elo da Corrente", "Chain Link", "Chain"],
  },
  {
    id: "quick-effect",
    label: "Efeito Rápido",
    definition:
      "Efeito de monstro que pode ser ativado no turno de qualquer jogador e em resposta a outras ativações (velocidade 2).",
    aliases: ["Efeito Rápido", "Quick Effect"],
  },
  {
    id: "quick-play",
    label: "Magia Rápida",
    definition:
      "Magia que pode ser ativada da mão no seu turno, ou baixada e ativada no turno de qualquer jogador (a partir do turno seguinte).",
    aliases: ["Magia Rápida", "Quick-Play Spell", "Quick-Play"],
  },
  {
    id: "counter-trap",
    label: "Armadilha de Resposta",
    definition: "A Armadilha mais rápida (velocidade 3): só outra Armadilha de Resposta pode responder a ela.",
    aliases: ["Armadilha de Resposta", "Counter Trap"],
  },
  {
    id: "continuous",
    label: "Contínua",
    definition: "Magia ou Armadilha que fica no campo depois de ativada e mantém o efeito enquanto estiver lá.",
    aliases: ["Contínua", "Continuous"],
  },
  {
    id: "tuner",
    label: "Regulador",
    definition:
      "Monstro usado na Invocação-Sincro: 1 Regulador + monstros não Reguladores cujos Níveis somados dão o Nível do Sincro.",
    aliases: ["Regulador", "Reguladores", "Tuner", "Tuners"],
  },
  {
    id: "synchro",
    label: "Sincro",
    definition:
      "Monstro do Extra Deck invocado mandando ao Cemitério 1 Regulador + não Reguladores com a soma de Níveis certa.",
    aliases: ["Sincro", "Invocação-Sincro", "Synchro Summon", "Synchro"],
  },
  {
    id: "xyz",
    label: "Xyz",
    definition:
      "Monstro do Extra Deck invocado sobrepondo monstros do mesmo Nível. Eles ficam embaixo como matérias e são desanexados para pagar os efeitos.",
    aliases: ["Xyz", "Invocação-Xyz", "Xyz Summon"],
  },
  {
    id: "material",
    label: "Matéria",
    definition:
      "Carta usada para Invocar um monstro do Extra Deck. No Xyz, as matérias ficam embaixo do monstro (o ◈ na mesa mostra quantas).",
    aliases: ["matéria", "matérias", "material", "materials"],
  },
  {
    id: "link",
    label: "Link",
    definition:
      "Monstro do Extra Deck invocado com monstros cujo total dá o número Link. Não tem DEF; as setas apontam as zonas onde se pode Invocar do Extra Deck.",
    aliases: ["Link", "Invocação-Link", "Link Summon"],
  },
  {
    id: "fusion",
    label: "Fusão",
    definition: "Monstro do Extra Deck invocado combinando as matérias pedidas, em geral com Polimerização.",
    aliases: ["Fusão", "Invocação-Fusão", "Fusion Summon", "Fusion"],
  },
  {
    id: "pendulum",
    label: "Pêndulo",
    definition:
      "Monstro que também é Magia: nas pontas da fileira de Magias vale como escala. Com as duas escalas armadas, Invoca-se por Pêndulo os monstros de Nível entre elas.",
    aliases: ["Pêndulo", "Escala de Pêndulo", "Pendulum Scale", "Pendulum Summon", "Pendulum"],
  },
  {
    id: "ritual",
    label: "Ritual",
    definition: "Monstro invocado por uma Magia de Ritual, oferecendo Tributos cujos Níveis somam (pelo menos) o dele.",
    aliases: ["Ritual"],
  },
  {
    id: "attack-position",
    label: "Posição de Ataque",
    definition: "Monstro em pé: pode atacar, e no combate vale o ATK dele. Perde LP a diferença quando perde a batalha.",
    aliases: ["Posição de Ataque", "Attack Position"],
  },
  {
    id: "defense-position",
    label: "Posição de Defesa",
    definition: "Monstro deitado: não ataca, e quem o ataca compara o próprio ATK com a DEF dele. O dono não perde LP nessa batalha.",
    aliases: ["Posição de Defesa", "Defense Position"],
  },
  {
    id: "battle-damage",
    label: "Dano de batalha",
    definition: "LP perdidos num combate: a diferença entre os ATK (ou ATK × DEF, quando o atacante perde para um monstro em defesa).",
    aliases: ["dano de batalha", "battle damage"],
  },
  {
    id: "once-per-turn",
    label: "Uma vez por turno",
    definition: "O efeito só pode ser usado uma vez a cada turno — e às vezes só uma vez por turno por carta com aquele nome (o \"rígido\").",
    aliases: ["uma vez por turno", "once per turn"],
  },
  {
    id: "target",
    label: "Alvo",
    definition:
      "Carta \"escolhida como alvo\" é apontada já na ativação. Se ela sair do lugar antes de o efeito resolver, o efeito não a alcança.",
    aliases: ["escolha como alvo", "escolhido como alvo", "alvo", "target", "targets"],
  },
  {
    id: "negate",
    label: "Negar",
    definition:
      "Anular. Negar a ATIVAÇÃO faz a carta não ter efeito nenhum; negar o EFEITO cancela só o que ele faria (a carta continua ativada).",
    aliases: ["negue", "negar", "negado", "negada", "negate", "negated"],
  },
  {
    id: "token",
    label: "Ficha",
    definition: "Monstro criado por efeito. Não existe no deck e some quando sai do campo.",
    aliases: ["Ficha", "Fichas", "Token", "Tokens"],
  },
  {
    id: "damage-step",
    label: "Damage Step",
    definition:
      "O passo da batalha em que o dano é calculado. Poucas cartas podem ser ativadas nele — só as que mudam ATK/DEF ou que dizem que podem.",
    aliases: ["Damage Step", "Etapa de Dano"],
  },
  {
    id: "counter",
    label: "Marcador",
    definition: "Contador posto numa carta por um efeito (Marcador de Magia, por exemplo). A mesa mostra a contagem num selo na carta.",
    aliases: ["Marcador de Magia", "Marcador", "Marcadores", "Spell Counter", "Counter"],
  },
];

export interface GlossarySegment {
  text: string;
  term?: GlossaryTerm;
}

const LETRA = "\\p{L}\\p{N}";

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Toda grafia → termo; as mais longas primeiro, para "Invocação-Tributo" ganhar de "Tributo". */
const GRAFIAS = GLOSSARY.flatMap((term) => [
  ...term.aliases.map((alias) => ({ alias, term, exact: false })),
  ...(term.exactCase ?? []).map((alias) => ({ alias, term, exact: true })),
]).sort((a, b) => b.alias.length - a.alias.length);

const PADRAO = new RegExp(
  `(?<![${LETRA}])(${GRAFIAS.map((g) => escapar(g.alias)).join("|")})(?![${LETRA}])`,
  "giu",
);

/**
 * Divide o texto em trechos, marcando a PRIMEIRA ocorrência de cada termo —
 * sublinhar todas transformaria o texto da carta num mar de pontilhado.
 */
export function glossarySegments(text: string): GlossarySegment[] {
  const out: GlossarySegment[] = [];
  const vistos = new Set<string>();
  let ultimo = 0;
  for (const match of text.matchAll(PADRAO)) {
    const encontrado = match[0];
    const minusculo = encontrado.toLowerCase();
    const grafia = GRAFIAS.find((g) =>
      g.exact ? g.alias === encontrado : g.alias.toLowerCase() === minusculo,
    );
    if (!grafia || vistos.has(grafia.term.id)) continue;
    vistos.add(grafia.term.id);
    const inicio = match.index ?? 0;
    if (inicio > ultimo) out.push({ text: text.slice(ultimo, inicio) });
    out.push({ text: encontrado, term: grafia.term });
    ultimo = inicio + encontrado.length;
  }
  if (ultimo < text.length) out.push({ text: text.slice(ultimo) });
  return out;
}
