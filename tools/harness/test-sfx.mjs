/**
 * Os efeitos sonoros tocam sem erro, se ouvem e não estouram — medidos, não
 * ouvidos.
 *
 * Os sons são sintetizados (`src/lib/audio/sfx.ts`) e ninguém os ouve num
 * teste: o que dá para conferir é a forma de onda. O módulo é carregado num
 * Chrome de verdade (tipos removidos com o `stripTypeScriptTypes` do Node) e
 * cada som é renderizado num `OfflineAudioContext` — a mesma cadeia do jogo
 * (reverberação, compressor), só que mais rápido que o tempo real. Para cada
 * um sai o pico, o volume médio (RMS) e quanto dura até silenciar:
 *
 * - todo som tem de soar (pico acima de um mínimo) e não pode estourar (pico
 *   abaixo de 1, com folga);
 * - nenhum pode passar muito do tempo (um som de interface com cauda de dois
 *   segundos atrapalha a próxima jogada);
 * - o clique, que toca o tempo todo, tem de ser bem mais baixo que o dano.
 *
 * Uso: npm run test:sfx  (só precisa do Chrome — nem do app no ar)
 */
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const fonte = stripTypeScriptTypes(readFileSync(join(REPO, "src/lib/audio/sfx.ts"), "utf8"));

/**
 * Anexado ao fim do módulo, no mesmo escopo: troca o contexto de áudio por um
 * offline, toca o som e mede o que saiu na saída (já depois do compressor).
 */
const MEDIDOR = `
export async function medir(nome) {
  const taxa = 44100;
  const off = new OfflineAudioContext(2, Math.round(taxa * 4), taxa);
  // O jogo "retoma" o contexto a cada som (o navegador o suspende até haver
  // interação); um contexto offline não começa assim — e não precisa.
  off.resume = () => Promise.resolve();
  context = null;
  master = null;
  reverbSend = null;
  noiseBuffer = null;
  settings = { volume: 0.5, muted: false };
  loaded = true;
  const original = window.AudioContext;
  window.AudioContext = function () { return off; };
  try {
    playSfx(nome);
  } finally {
    window.AudioContext = original;
  }
  const buffer = await off.startRendering();
  let pico = 0;
  let soma = 0;
  let n = 0;
  let ultimo = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const dados = buffer.getChannelData(c);
    for (let i = 0; i < dados.length; i += 1) {
      const a = Math.abs(dados[i]);
      if (a > pico) pico = a;
      if (a > 0.003 && i > ultimo) ultimo = i;
      soma += dados[i] * dados[i];
      n += 1;
    }
  }
  // RMS só da parte com som (até o último ponto audível).
  const ativos = Math.max(1, (ultimo + 1) * buffer.numberOfChannels);
  return { nome, pico, rms: Math.sqrt(soma / ativos), duracao: ultimo / taxa };
}
export const nomes = SFX_PREVIEW.map((s) => s.name).concat(["phase"]);
`;

/** Quanto cada som pode durar (s): a interface é curta; a fanfarra, longa. */
const DURACAO_MAX = {
  click: 0.5,
  open: 0.8,
  draw: 0.8,
  place: 0.8,
  flip: 0.8,
  summon: 2.2,
  specialSummon: 2.5,
  cutIn: 3.5,
  activate: 2.5,
  chain: 2,
  attack: 1.4,
  damage: 2.2,
  destroy: 2.2,
  banish: 2.5,
  recover: 2.5,
  banner: 2,
  phase: 2,
  turn: 2.5,
  finalBlow: 3.2,
  coin: 3,
  dice: 2,
  victory: 3.9,
  defeat: 3.9,
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const { child, port } = await launchChrome({ headless: true });
try {
  const page = await openPage(port);
  await page.goto("about:blank");
  await page.evaluate(`window.__sfxFonte = ${JSON.stringify(fonte + MEDIDOR)}; return true;`);
  const medidas = await page.evaluate(`
    return (async () => {
      const url = URL.createObjectURL(new Blob([window.__sfxFonte], { type: "text/javascript" }));
      const m = await import(url);
      const saida = [];
      for (const nome of m.nomes) saida.push(await m.medir(nome));
      return saida;
    })();
  `);

  console.log("som                 pico    rms     duração");
  for (const m of medidas) {
    console.log(
      `${m.nome.padEnd(18)}  ${m.pico.toFixed(3)}   ${m.rms.toFixed(3)}   ${m.duracao.toFixed(2)} s`,
    );
  }
  console.log("");
  for (const m of medidas) {
    const max = DURACAO_MAX[m.nome] ?? 2;
    conferir(
      m.pico > 0.02 && m.pico < 0.98 && m.duracao > 0.02 && m.duracao <= max,
      `${m.nome}: soa, não estoura e acaba a tempo`,
      `pico ${m.pico.toFixed(3)}, duração ${m.duracao.toFixed(2)} s (máx. ${max} s)`,
    );
  }
  const de = (nome) => medidas.find((m) => m.nome === nome);
  conferir(
    de("click").rms < de("damage").rms * 0.6,
    "o clique (que toca o tempo todo) é bem mais baixo que o dano",
    `clique ${de("click").rms.toFixed(3)} × dano ${de("damage").rms.toFixed(3)}`,
  );
  conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));
} finally {
  child.kill();
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nSons: tudo certo.");
}
