/**
 * Zona escolhida antes do comando (`zone-first.ts`) — a previsão bate com o
 * que o core pergunta?
 *
 * O core não deixa desistir da escolha de zona (SELECT_PLACE não tem
 * cancelamento), então a tela pergunta a zona ANTES de mandar "Invocar",
 * "Baixar" ou "Ativar" da mão — aí "Cancelar" ainda é possível, porque nada foi
 * enviado. Isso só funciona se as zonas que a tela oferece forem EXATAMENTE as
 * que o core oferece depois: zona a mais e o jogador escolhe uma que o core
 * recusa (a pergunta volta); zona a menos e ele fica sem uma opção legal.
 *
 * Para cada caso, no engine real: monta a mesa, pega o SELECT_IDLECMD, calcula
 * a previsão com a mesma função da tela, escolhe uma zona, manda o comando, e
 * quando o SELECT_PLACE chega confere (1) que as zonas oferecidas são as
 * previstas e (2) que a carta termina na zona escolhida. E os casos em que a
 * tela NÃO deve perguntar antes (Nível 5+, Magia de Campo) devolvem `null`.
 *
 * Uso: node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-zone-first.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
} from "@n1xx1/ocgcore-wasm";

import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { EngineStringsDb } from "@/lib/duel/engine-strings";
import { placeResponseFor, zonesBeforeCommand } from "@/lib/duel/zone-first";

import { REPO } from "./env.mjs";
import { createDuel, STOP, Zone } from "./duel.mjs";

const strings = new EngineStringsDb(
  JSON.parse(readFileSync(join(REPO, "src/data/engine-strings.json"), "utf8")),
);
const cardDb = JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8"));

const C = {
  ox: 5053103, // Battle Ox, Nível 4
  elf: 15025844, // Mystical Elf, Nível 4
  imp: 41392891, // Feral Imp, Nível 4
  skull: 70781052, // Summoned Skull, Nível 6 (tributo)
  swords: 72302403, // Swords of Revealing Light — fica em campo depois de resolver
  mirror: 44095762, // Mirror Force
  pot: 55144522, // Pot of Greed
  sogen: 86318356, // Sogen — Magia de Campo
  oddEyes: 16178681, // Odd-Eyes Pendulum Dragon — escalas 4/4
};

/** O que a tela leria do catálogo, aqui tirado do `card-db` (bits do core). */
function info(code) {
  const [type, , level] = cardDb[code];
  const kind = type & 0x1 ? "monster" : type & 0x2 ? "spell" : type & 0x4 ? "trap" : "other";
  return {
    level,
    kind,
    isFieldSpell: Boolean(type & 0x2 && type & 0x80000),
    isPendulum: Boolean(type & 0x1000000),
  };
}

const ATK = OcgPosition.FACEUP_ATTACK;
const FILLER_DECK = [C.ox, C.elf, C.imp, C.ox, C.elf, C.imp];

const CASOS = [
  {
    nome: "Goat · Invocar Nível 4 (zonas 1 e 3 ocupadas)",
    mode: OcgDuelMode.MODE_GOAT,
    place: [
      { player: 0, zone: Zone.MZONE, code: C.elf, sequence: 1, position: ATK },
      { player: 0, zone: Zone.MZONE, code: C.imp, sequence: 3, position: ATK },
    ],
    card: C.ox,
    label: "Invocar",
    escolha: 4,
    destino: OcgLocation.MZONE,
  },
  {
    nome: "Goat · Baixar monstro Nível 4",
    mode: OcgDuelMode.MODE_GOAT,
    place: [{ player: 0, zone: Zone.MZONE, code: C.elf, sequence: 0, position: ATK }],
    card: C.ox,
    label: "Baixar (monstro)",
    escolha: 2,
    destino: OcgLocation.MZONE,
  },
  {
    nome: "Goat · Baixar Armadilha (zona 0 ocupada)",
    mode: OcgDuelMode.MODE_GOAT,
    place: [{ player: 0, zone: Zone.SZONE, code: C.pot, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE }],
    card: C.mirror,
    label: "Baixar",
    escolha: 3,
    destino: OcgLocation.SZONE,
  },
  {
    nome: "Goat · Ativar Magia da mão (Espadas da Luz Reveladora)",
    mode: OcgDuelMode.MODE_GOAT,
    place: [],
    card: C.swords,
    label: "Ativar",
    escolha: 1,
    destino: OcgLocation.SZONE,
  },
  {
    nome: "MR5 · Invocar Nível 4 (sem Zonas Extra)",
    mode: OcgDuelMode.MODE_MR5,
    place: [{ player: 0, zone: Zone.MZONE, code: C.elf, sequence: 2, position: ATK }],
    card: C.ox,
    label: "Invocar",
    escolha: 0,
    destino: OcgLocation.MZONE,
  },
  {
    nome: "MR5 · Ativar como Escala de Pêndulo",
    mode: OcgDuelMode.MODE_MR5,
    place: [],
    card: C.oddEyes,
    label: "Ativar",
    escala: true,
    escolha: 4,
    destino: OcgLocation.SZONE,
  },
  // A tela NÃO pergunta antes: tributo (libera zona) e Magia de Campo (zona
  // única, o core nem pergunta).
  {
    nome: "Goat · Nível 6 pede tributo → direto ao core",
    mode: OcgDuelMode.MODE_GOAT,
    place: [{ player: 0, zone: Zone.MZONE, code: C.elf, sequence: 0, position: ATK }],
    card: C.skull,
    label: "Invocar",
    semPrevisao: true,
  },
  {
    nome: "Goat · Magia de Campo → direto ao core",
    mode: OcgDuelMode.MODE_GOAT,
    place: [],
    card: C.sogen,
    label: "Ativar",
    semPrevisao: true,
  },
];

const ordenar = (seqs) => [...seqs].sort((a, b) => a - b).join(",");

async function rodar(caso) {
  const duel = await createDuel({
    mode: caso.mode,
    place: [...caso.place, { player: 0, zone: Zone.HAND, code: caso.card }],
    decks: [FILLER_DECK, FILLER_DECK],
  });

  let previstas = null;
  let oferecidas = null;
  let escolhida = null;
  let enviado = false;
  let respondeuZona = false;

  duel.run((message) => {
    if (message.player !== 0) return null;
    if (message.type === OcgMessageType.SELECT_IDLECMD) {
      if (enviado) return STOP;
      const plan = buildPromptPlan(message, strings);
      const acao = [...plan.byCard.values()]
        .flat()
        .find(
          (a) =>
            a.code === caso.card &&
            a.location === OcgLocation.HAND &&
            a.label === caso.label &&
            (caso.escala === undefined || (a.detail === "Como Escala de Pêndulo") === caso.escala),
        );
      if (!acao) return STOP;
      const mesa = {
        seat: 0,
        monsters: duel.query(0, OcgLocation.MZONE).map((c) => (c?.code ? c : null)),
        spells: duel.query(0, OcgLocation.SZONE).map((c) => (c?.code ? c : null)),
        isDisabled: () => false,
      };
      const zonas = zonesBeforeCommand(
        { label: acao.label, detail: acao.detail, response: acao.response, location: acao.location, ...info(caso.card) },
        mesa,
      );
      previstas = zonas;
      if (zonas) {
        escolhida = zonas.find((z) => z.sequence === caso.escolha) ?? null;
        if (!escolhida) return STOP;
      }
      enviado = true;
      return acao.response;
    }
    if (message.type === OcgMessageType.SELECT_PLACE && enviado && !respondeuZona) {
      respondeuZona = true;
      const plan = buildPromptPlan(message, strings);
      oferecidas = plan.places.map(({ place }) => place);
      if (!escolhida) return STOP;
      return placeResponseFor(plan.places, escolhida) ?? STOP;
    }
    // Qualquer outra pergunta (corrente, alvo): a mais simples possível.
    return null;
  });

  // Onde a carta foi parar (a Espada fica em campo; o Pêndulo também).
  let destino = null;
  if (caso.destino !== undefined) {
    const zona = duel.query(0, caso.destino);
    const seq = zona.findIndex((c) => c?.code === caso.card);
    destino = seq >= 0 ? seq : null;
  }
  duel.destroy();
  return { previstas, oferecidas, escolhida, destino, respondeuZona };
}

let falhas = 0;
for (const caso of CASOS) {
  const r = await rodar(caso);
  let ok;
  let detalhe;
  if (caso.semPrevisao) {
    ok = r.previstas === null;
    detalhe = `previsão=${r.previstas === null ? "nenhuma (direto ao core)" : ordenar(r.previstas.map((z) => z.sequence))}`;
  } else {
    const prev = r.previstas ? ordenar(r.previstas.map((z) => z.sequence)) : "nenhuma";
    const ofer = r.oferecidas
      ? ordenar(
          r.oferecidas
            .filter((z) => z.player === 0 && z.location === caso.destino)
            .map((z) => z.sequence),
        )
      : "nenhuma";
    // Nada fora da fileira prevista (zona do oponente, outra fileira).
    const foraDaFileira = (r.oferecidas ?? []).some((z) => z.player !== 0 || z.location !== caso.destino);
    ok = r.previstas !== null && prev === ofer && !foraDaFileira && r.destino === caso.escolha;
    detalhe = `previstas=${prev} oferecidas=${ofer}${foraDaFileira ? " (+fora da fileira)" : ""} escolhida=${caso.escolha} terminou-em=${r.destino}`;
  }
  if (!ok) falhas += 1;
  process.stdout.write(`${ok ? "OK   " : "FALHA"} ${caso.nome.padEnd(52)} ${detalhe}\n`);
}

process.stdout.write(`\nfalhas: ${falhas}\n`);
if (falhas > 0) process.exitCode = 1;
