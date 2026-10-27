import { OcgType } from "@n1xx1/ocgcore-wasm";
import { readIntel } from "./card-intel.mjs";
/**
 * ATK/DEF de uma carta **como o bot tem direito de saber**.
 *
 * O detalhe que faz toda a diferença: a query do core devolve `attack`/`defense`
 * de uma carta virada para baixo do oponente de qualquer jeito. Ler esses
 * números seria o bot enxergando através do verso da carta, e um oponente que
 * sabe o ATK de todo monstro setado não é difícil, é trapaceiro: ele nunca erra
 * um ataque, e a partida deixa de ter blefe. Hoje o `readBoardState` já zera os
 * números de carta oculta (vazavam pelo WebSocket no online); esta checagem
 * fica como segunda trava, para o bot não depender de quem montou o tabuleiro.
 *
 * Por isso: sem `code` visível, sem números. Quem chama recebe `null` e decide
 * sob incerteza, exatamente como um humano decide.
 */
export function knownStats(card) {
    if (card.code === null)
        return null;
    return {
        attack: card.attack ?? 0,
        defense: card.defenseValue ?? 0,
    };
}
/**
 * DEF que o bot assume atrás de um monstro virado.
 *
 * Média grosseira dos monstros que o formato realmente seta: os flip effects
 * ficam entre 400 (Feiticeira da Fé) e 2000 (Jarra Cibernética tem 900, mas
 * Dekoichi 1400, Ceifador Espiritual 200...), e os "muros" de defesa passam de
 * 2000. 1500 erra para os dois lados sem favorecer nenhum, que é o ponto: um
 * palpite honesto no lugar de informação roubada.
 */
export const ASSUMED_SET_DEFENSE = 1500;
/**
 * Penalidade por atacar às cegas um monstro virado.
 *
 * Não é só o risco de bater numa DEF maior: metade dos monstros setados do Goat
 * é flip effect, e virá-los é justamente o que o dono queria (Feiticeira da Fé
 * recupera magia, Assaltante Noturno mata um monstro, Jarra Cibernética
 * reinicia o campo inteiro). O bot ainda ataca quando tem folga de ATK — só
 * deixa de fazer isso de graça.
 */
const FACEDOWN_RISK = 25;
/**
 * Quanto vale bater com `attack` de ATK num defensor.
 *
 * A escala mistura duas coisas de propósito: o **valor posicional** de trocar
 * cartas (matar sem morrer é bom, morrer é ruim) e o **dano** causado, dividido
 * para não dominar a conta. Um bot que só maximiza dano entra em toda troca
 * ruim; um que só evita trocas nunca fecha o duelo.
 */
function scoreAgainst(attack, defender) {
    const stats = knownStats(defender);
    // Monstro virado: o bot não sabe o que tem pela frente.
    if (!stats) {
        const margin = attack - ASSUMED_SET_DEFENSE;
        return margin / 40 - FACEDOWN_RISK;
    }
    if (defender.defense) {
        if (attack > stats.defense)
            return 45 + (attack - stats.defense) / 100;
        // Bater numa DEF maior devolve o excedente como dano no atacante.
        if (attack === stats.defense)
            return -5;
        return -20 - (stats.defense - attack) / 40;
    }
    if (attack > stats.attack) {
        // Mata e ainda passa o excedente como dano — a melhor jogada do jogo.
        return 60 + (attack - stats.attack) / 25;
    }
    // Troca 1-por-1: os dois morrem. Só é boa quando o alvo vale mais, e o bot
    // não sabe medir isso com segurança — evita, sem proibir.
    if (attack === stats.attack)
        return -15;
    return -70 - (stats.attack - attack) / 25;
}
/**
 * Melhor alvo para um atacante, e quanto vale atacar.
 *
 * O core pergunta **quem ataca** (SELECT_BATTLECMD) e só depois **quem apanha**
 * (um SELECT_CARD à parte). Escolher o atacante sem já ter olhado os alvos é o
 * que produz o ataque suicida: o bot marca o monstro, o core pede o alvo e
 * qualquer resposta já é ruim.
 */
export function appraiseAttack(attack, canDirect, opponent) {
    if (canDirect) {
        // Dano direto não tem risco nenhum: só precisa valer mais que passar.
        return { score: 80 + attack / 20, target: null };
    }
    const defenders = opponent.monsters.filter((card) => !!card);
    if (defenders.length === 0)
        return { score: -100, target: null };
    let best = {
        score: -Infinity,
        target: null,
    };
    for (const defender of defenders) {
        const score = scoreAgainst(attack, defender);
        if (score > best.score)
            best = { score, target: defender };
    }
    return best;
}
/**
 * O quanto uma carta do oponente incomoda — usado para escolher alvo de
 * remoção, de roubo e de tributo.
 */
export function threatOf(card, cardDb) {
    const stats = knownStats(card);
    if (!stats) {
        // Virada: o bot não sabe. Um set do oponente é uma incógnita que costuma
        // ser um flip effect — vale remover, mas menos que um monstro grande à
        // vista.
        return ASSUMED_SET_DEFENSE;
    }
    const intel = card.code !== null ? readIntel(card.code, cardDb) : null;
    const base = Math.max(stats.attack, stats.defense);
    // Monstro com efeito faz mais do que os números dizem.
    const comEfeito = intel?.isMonster && (intel.type & OcgType.NORMAL) === 0;
    return comEfeito ? base + 200 : base;
}
/** Valor de manter uma carta minha — quem tem menos vai para o tributo. */
export function ownValue(card, cardDb) {
    const stats = knownStats(card);
    const intel = card.code !== null ? readIntel(card.code, cardDb) : null;
    const base = stats ? Math.max(stats.attack, stats.defense) : (intel?.atk ?? 0);
    // Um flip effect ainda por virar vale mais do que o corpo dele sugere.
    return intel?.isFlip && card.faceDown ? base + 400 : base;
}
