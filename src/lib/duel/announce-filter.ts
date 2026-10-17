/**
 * Que nomes de carta podem ser declarados num ANNOUNCE_CARD — a mesma conta
 * que o core faz (`is_declarable` em `playerop.cpp` do ygopro-core).
 *
 * O core manda o filtro como uma pilha RPN de `OcgOpCode` (literais e
 * operadores misturados), avaliada carta a carta contra os dados OFICIAIS:
 * tipo, raça e atributo em bitfield, e os setcodes. Antes a tela avaliava com
 * o que o catálogo da YGOPRODeck tem (o tipo em texto) e liberava tudo quando
 * aparecia setcode, raça ou atributo — "declare 1 'Gadget'" oferecia o pool
 * inteiro, e o core devolvia RETRY para quase toda escolha.
 *
 * Detalhes que vêm do core e que não são intuitivos:
 *
 * - `ISSETCARD` casa o arquétipo pelos 12 bits baixos e exige os bits de
 *   sub-arquétipo (0xf000) do pedido: "Gadget" aceita "Ancient Gear Gadget"?
 *   Só se o setcode da carta tiver os mesmos bits altos que o pedido exige.
 * - Uma carta com `alias` (arte alternativa, ou carta "tratada como" outra)
 *   só é declarável com `ALLOW_ALIASES` — declara-se o nome, não a arte.
 * - Fichas só com `ALLOW_TOKENS`.
 * - Marine Dolphin e Twinkle Moss são declaráveis sempre (exceção do core).
 *
 * Sem atalho `@/`: o harness importa este arquivo por caminho relativo.
 */
import { OcgOpCode } from "@n1xx1/ocgcore-wasm";

/** O que o filtro precisa saber de uma carta — o mesmo do `card_data` do core. */
export interface DeclarableCardData {
  code: number;
  alias: number;
  type: number;
  race: number | bigint;
  attribute: number;
  setcodes: readonly number[];
}

const TYPE_MONSTER = 0x1n;
const TYPE_TOKEN = 0x4000n;
/** Cartas que o core sempre aceita declarar (`CARD_MARINE_DOLPHIN`, `CARD_TWINKLE_MOSS`). */
const ALWAYS_DECLARABLE = new Set([78734254, 13857930]);

const BINARY = new Map<bigint, (a: bigint, b: bigint) => bigint>([
  [OcgOpCode.ADD, (a, b) => a + b],
  [OcgOpCode.SUB, (a, b) => a - b],
  [OcgOpCode.MUL, (a, b) => a * b],
  [OcgOpCode.DIV, (a, b) => (b === 0n ? 0n : a / b)],
  [OcgOpCode.AND, (a, b) => (a !== 0n && b !== 0n ? 1n : 0n)],
  [OcgOpCode.OR, (a, b) => (a !== 0n || b !== 0n ? 1n : 0n)],
  [OcgOpCode.BAND, (a, b) => a & b],
  [OcgOpCode.BOR, (a, b) => a | b],
  [OcgOpCode.BXOR, (a, b) => a ^ b],
  [OcgOpCode.LSHIFT, (a, b) => a << b],
  [OcgOpCode.RSHIFT, (a, b) => a >> b],
]);

const UNARY = new Map<bigint, (a: bigint) => bigint>([
  [OcgOpCode.NEG, (a) => -a],
  [OcgOpCode.NOT, (a) => (a === 0n ? 1n : 0n)],
  [OcgOpCode.BNOT, (a) => ~a],
]);

/** O setcode `set` (pedido) casa com algum setcode da carta? */
function matchesSetcode(set: number, setcodes: readonly number[]): boolean {
  const type = set & 0xfff;
  const subtype = set & 0xf000;
  return setcodes.some((sc) => (sc & 0xfff) === type && (sc & 0xf000 & subtype) === subtype);
}

/**
 * A carta pode ser declarada com este filtro?
 *
 * Espelho de `is_declarable`: operador com pilha insuficiente é ignorado (não
 * derruba a avaliação), qualquer valor que não seja operador vira literal, e o
 * resultado só vale se sobrar exatamente um valor não-zero na pilha.
 */
export function isDeclarable(
  opcodes: readonly bigint[],
  card: DeclarableCardData,
): boolean {
  const stack: bigint[] = [];
  let aliases = false;
  let tokens = false;
  const type = BigInt(card.type);
  const race = BigInt(card.race);
  const attribute = BigInt(card.attribute);

  // O guard de tamanho garante o valor em runtime; o rastreador do build do
  // Next avalia pop() estaticamente como undefined, então mantemos o fallback.
  for (const raw of opcodes) {
    const opcode = BigInt(raw);
    const binary = BINARY.get(opcode);
    if (binary) {
      if (stack.length >= 2) {
        const rhs = stack.pop()!;
        const lhs = stack.pop()!;
        stack.push(binary(lhs, rhs));
      }
      continue;
    }
    const unary = UNARY.get(opcode);
    if (unary) {
      if (stack.length >= 1) stack.push(unary(stack.pop()!));
      continue;
    }
    switch (opcode) {
      case OcgOpCode.ISCODE:
        if (stack.length >= 1) {
          const value = (stack.pop() ?? 0n) & 0xffffffffn;
          stack.push(BigInt(card.code) === value ? 1n : 0n);
        }
        break;
      case OcgOpCode.ISTYPE:
        if (stack.length >= 1) stack.push(type & (stack.pop() ?? 0n));
        break;
      case OcgOpCode.ISRACE:
        if (stack.length >= 1) stack.push(race & (stack.pop() ?? 0n));
        break;
      case OcgOpCode.ISATTRIBUTE:
        if (stack.length >= 1) stack.push(attribute & (stack.pop() ?? 0n));
        break;
      case OcgOpCode.GETCODE:
        stack.push(BigInt(card.code));
        break;
      case OcgOpCode.GETTYPE:
        stack.push(type);
        break;
      case OcgOpCode.GETRACE:
        stack.push(race);
        break;
      case OcgOpCode.GETATTRIBUTE:
        stack.push(attribute);
        break;
      case OcgOpCode.ISSETCARD:
        if (stack.length >= 1) {
          const set = Number(BigInt.asIntN(32, stack.pop()!));
          stack.push(matchesSetcode(set, card.setcodes) ? 1n : 0n);
        }
        break;
      case OcgOpCode.ALLOW_ALIASES:
        aliases = true;
        break;
      case OcgOpCode.ALLOW_TOKENS:
        tokens = true;
        break;
      default:
        stack.push(opcode);
    }
  }

  if (stack.length !== 1 || stack[0] === 0n) return false;
  if (ALWAYS_DECLARABLE.has(card.code)) return true;
  const isToken = (type & (TYPE_MONSTER | TYPE_TOKEN)) === (TYPE_MONSTER | TYPE_TOKEN);
  return (aliases || card.alias === 0) && (tokens || !isToken);
}
