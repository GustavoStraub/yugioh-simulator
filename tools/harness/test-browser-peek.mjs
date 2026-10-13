/**
 * Nenhum popup prende a mesa — pela tela, num Chrome de verdade.
 *
 * A regra (docs/ui-ux-plano.md, Fase 1): todo diálogo de decisão pode ser
 * escondido para o jogador conferir o campo, o Cemitério e o Extra Deck, e
 * volta com o que já tinha sido marcado. Antes só o sim/não tinha esse
 * caminho; escolher uma carta do Deck ou declarar um nome tapava a mesa sem
 * saída. O teste passa por:
 *
 *   1. Seletor de cartas (Reforço do Exército busca no Deck): marca uma carta,
 *      esconde, abre o Cemitério com a decisão pendente, fecha com Esc, volta
 *      com Esc — a marca continua — e confirma clicando de novo na carta.
 *   2. Declarar nome (Proibição): digita, esconde, volta — a busca continua.
 *   3. Engrenagem e botão de modo de resposta: a escolha vale e fica salva.
 *   4. A mesa sem os rótulos de engenharia ("Mon1", "M/A5 · P").
 *   5. Fim de duelo: rendição → "Ver a mesa final" → volta → Revanche começa
 *      um duelo novo.
 *
 * Uso: APP_URL=http://127.0.0.1:3000 npm run test:browser-peek [-- --headed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

const CELTIC = 91152256; // Guerreiro de Nível 4
const CAPTAIN = 2460565; // Marauding Captain — outro Guerreiro, para a busca ter escolha
const REINFORCEMENT = 32807846;
const PROHIBITION = 43711255;
const HORSEMAN = 68516705;

const deckMeu = [...Array(20).fill(CELTIC), ...Array(20).fill(CAPTAIN)];
const setup = {
  playerName: "Testador",
  playerDeck: { main: deckMeu, extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(CELTIC), extra: [], side: [] },
  format: "tcg",
  scenario: [
    { player: 0, location: OcgLocation.HAND, code: REINFORCEMENT },
    { player: 0, location: OcgLocation.HAND, code: PROHIBITION },
    { player: 0, location: OcgLocation.GRAVE, code: HORSEMAN },
    { player: 0, location: OcgLocation.GRAVE, code: CELTIC },
  ],
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ate(page, js, { tentativas = 60, intervalo = 250 } = {}) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = await page.evaluate(js).catch(() => null);
    if (valor) return valor;
    await espera(intervalo);
  }
  return null;
}

const DIALOGO_VISIVEL = `
  const d = document.querySelector("[data-decision-dialog]");
  return Boolean(d && d.offsetParent !== null);
`;
const DIALOGO_MONTADO_OCULTO = `
  const d = document.querySelector("[data-decision-dialog]");
  return Boolean(d && d.offsetParent === null);
`;
const tecla = (key) => `
  window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }));
  return true;
`;
const temBotao = (texto) => `
  return [...document.querySelectorAll("button")].some(
    (b) => b.offsetParent !== null && b.innerText.includes(${JSON.stringify(texto)}),
  );
`;

/** Clica uma carta da minha mão pelo nome e escolhe a ação; depois a zona, se pedir. */
async function ativarDaMao(page, nome) {
  const zona = await ate(
    page,
    `
    const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')]
      .find((el) => ${nome}.test(el.querySelector("img")?.alt ?? ""));
    return slot && slot.querySelector(".tf-slot-active") ? slot.dataset.zone : null;
  `,
    { tentativas: 120, intervalo: 500 },
  );
  if (!zona) return false;
  await page.evaluate(`document.querySelector('[data-zone="${zona}"] [role="button"]').click(); return true;`);
  await espera(250);
  if (!(await page.clickAction("Ativar"))) return false;
  // A Magia da mão pergunta a zona (MR5): a primeira acesa serve.
  const lugar = await ate(
    page,
    `const z = document.querySelector('.tf-slot-place'); return z ? z.closest("[data-zone]")?.dataset.zone ?? "?" : null;`,
    { tentativas: 25, intervalo: 200 },
  );
  if (lugar && lugar !== "?") {
    await page.evaluate(`document.querySelector('[data-zone="${lugar}"] [role="button"]')?.click(); return true;`);
  }
  return true;
}

async function foto(page, nome) {
  const { data } = await page.screenshot();
  writeFileSync(join(OUT, `popup-${nome}.png`), Buffer.from(data, "base64"));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/duel`);
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnesspeek01", name: "Testador" }),
      )});
       localStorage.removeItem("yugioh-goat-duel-prefs-v1");
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);

    // ---- 1. Seletor de cartas ------------------------------------------
    console.log("1. Seletor de cartas (busca no Deck)");
    conferir(await ativarDaMao(page, "/Refor|Reinforcement/"), "ativei o Reforço do Exército");
    conferir(Boolean(await ate(page, DIALOGO_VISIVEL)), "o seletor de cartas abriu");
    const dialogo = await page.evaluate(`
      const d = document.querySelector("[data-decision-dialog]");
      return { role: d?.getAttribute("role"), modal: d?.getAttribute("aria-modal"), rotulo: d?.getAttribute("aria-label") };
    `);
    conferir(dialogo.role === "dialog" && dialogo.modal === "true" && Boolean(dialogo.rotulo), "é um diálogo acessível, com rótulo", JSON.stringify(dialogo));

    const marcada = await page.evaluate(`
      const c = document.querySelector("[data-picker-card]");
      c?.click();
      return c?.dataset.pickerCard ?? null;
    `);
    await espera(150);
    const temMarca = `return Boolean(document.querySelector('[data-picker-card="${marcada}"]')?.innerText.includes("✓"));`;
    conferir(Boolean(await page.evaluate(temMarca)), "marquei uma carta");
    await foto(page, "seletor");

    await page.evaluate(`document.querySelector("[data-peek]")?.click(); return true;`);
    await espera(200);
    conferir(Boolean(await page.evaluate(DIALOGO_MONTADO_OCULTO)), "'Ver a mesa' esconde o seletor (sem desmontar)");
    conferir(Boolean(await page.evaluate(temBotao("Voltar à decisão"))), "a barra 'Voltar à decisão' aparece");
    await foto(page, "seletor-escondido");

    const abriuCemiterio = await page.evaluate(`
      const pilha = [...document.querySelectorAll('[role="button"][title^="Ver Cemit"]')][0];
      pilha?.click();
      return Boolean(pilha);
    `);
    await espera(250);
    conferir(
      abriuCemiterio && Boolean(await page.evaluate(`return Boolean(document.querySelector("[data-pile-modal]"));`)),
      "com a decisão pendente, o Cemitério abre",
    );
    await page.evaluate(tecla("Escape"));
    await espera(150);
    conferir(
      !(await page.evaluate(`return Boolean(document.querySelector("[data-pile-modal]"));`)) &&
        Boolean(await page.evaluate(DIALOGO_MONTADO_OCULTO)),
      "Esc fecha o Cemitério e a decisão continua escondida",
    );
    await page.evaluate(tecla("Escape"));
    await espera(200);
    conferir(Boolean(await page.evaluate(DIALOGO_VISIVEL)), "Esc traz a decisão de volta");
    conferir(Boolean(await page.evaluate(temMarca)), "a carta marcada continua marcada");

    const maoAntes = await page.evaluate(`return document.querySelectorAll('[data-hand="0"] [data-zone]').length;`);
    await page.evaluate(`document.querySelector('[data-picker-card="${marcada}"]')?.click(); return true;`);
    const fechou = await ate(page, `return !document.querySelector("[data-decision-dialog]");`, { tentativas: 40 });
    conferir(Boolean(fechou), "clicar de novo na carta marcada confirma a escolha");
    const maoDepois = await ate(
      page,
      `const n = document.querySelectorAll('[data-hand="0"] [data-zone]').length; return n >= ${maoAntes} ? n : null;`,
      { tentativas: 40 },
    );
    conferir(Boolean(maoDepois), `a carta buscada chegou à mão (${maoAntes} → ${maoDepois})`);

    // ---- 2. Declarar nome ----------------------------------------------
    console.log("2. Declarar nome (Proibição)");
    // Espera a corrente do Reforço terminar e a mão voltar a ser jogável.
    conferir(await ativarDaMao(page, "/Proibi|Prohibition/"), "ativei a Proibição");
    const abriu = await ate(page, `return Boolean(document.querySelector('[data-decision-dialog] input[type="text"]'));`);
    conferir(Boolean(abriu), "a busca de nome abriu");
    await page.evaluate(`
      const campo = document.querySelector('[data-decision-dialog] input[type="text"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(campo, "Dark Magician");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    `);
    await espera(300);
    await page.evaluate(`document.querySelector("[data-peek]")?.click(); return true;`);
    await espera(200);
    conferir(Boolean(await page.evaluate(DIALOGO_MONTADO_OCULTO)), "a declaração também se esconde");
    await page.clickAction("Voltar à decisão");
    await espera(200);
    const valor = await page.evaluate(`return document.querySelector('[data-decision-dialog] input[type="text"]')?.value ?? null;`);
    conferir(valor === "Dark Magician", "a busca digitada sobreviveu à espiada", String(valor));
    await page.evaluate(`
      const alvo = [...document.querySelectorAll('[data-decision-dialog] button')].find((b) => /Dark Magician|Mago Negro/i.test(b.title));
      alvo?.click();
      return true;
    `);
    await espera(200);
    await page.clickAction("Declarar");
    conferir(
      Boolean(await ate(page, `return !document.querySelector("[data-decision-dialog]");`, { tentativas: 40 })),
      "declarei e a decisão fechou",
    );

    // ---- 3. Engrenagem e modo de resposta -------------------------------
    console.log("3. Configurações do duelo");
    await page.evaluate(`document.querySelector("[data-duel-settings]")?.click(); return true;`);
    await espera(200);
    conferir(Boolean(await page.evaluate(`return Boolean(document.querySelector("[data-duel-settings-panel]"));`)), "a engrenagem abre as configurações");
    await page.evaluate(`
      const opcao = [...document.querySelectorAll("[data-duel-settings-panel] label")].find((l) => l.innerText.includes("Nunca perguntar"));
      opcao?.querySelector("input")?.click();
      return true;
    `);
    await espera(200);
    conferir(
      (await page.evaluate(`return document.querySelector("[data-chain-mode]")?.dataset.chainMode;`)) === "never",
      "escolher 'Nunca perguntar' muda o botão da mesa",
    );
    const salvo = await page.evaluate(`return JSON.parse(localStorage.getItem("yugioh-goat-duel-prefs-v1") ?? "{}").chainMode;`);
    conferir(salvo === "never", "a escolha fica salva no navegador", String(salvo));
    await foto(page, "configuracoes");
    await page.evaluate(tecla("Escape"));
    await espera(100);
    conferir(
      !(await page.evaluate(`return Boolean(document.querySelector("[data-duel-settings-panel]"));`)),
      "Esc fecha as configurações",
    );
    await page.evaluate(`document.querySelector("[data-chain-mode]")?.click(); return true;`);
    await espera(150);
    conferir(
      (await page.evaluate(`return document.querySelector("[data-chain-mode]")?.dataset.chainMode;`)) === "auto",
      "o botão da mesa alterna (Nunca → Automático)",
    );

    // ---- 4. Mesa sem jargão --------------------------------------------
    console.log("4. Mesa");
    const textoMesa = await page.evaluate(`return document.querySelector(".tf-playmat").innerText;`);
    conferir(!/\bMon\d\b|M\/A\d/.test(textoMesa), "sem 'Mon1' nem 'M/A5' nas zonas vazias");
    conferir(/Sua vez/i.test(textoMesa), "o selo 'Sua vez' está na barra de LP");

    // ---- 5. Fim de duelo -----------------------------------------------
    console.log("5. Fim de duelo");
    await page.evaluate(`document.querySelector('.tf-playmat [data-pile="deck-0"][role="button"]')?.click(); return true;`);
    await espera(200);
    await page.clickAction("🏳️ Render-se");
    await espera(150);
    await page.clickAction("🏳️ Confirmar rendição?");
    conferir(Boolean(await ate(page, `return Boolean(document.querySelector("[data-result]"));`)), "o resultado aparece");
    await foto(page, "resultado");
    await page.clickText("Ver a mesa final");
    await espera(200);
    conferir(
      !(await page.evaluate(`return Boolean(document.querySelector("[data-result]"));`)) &&
        Boolean(await page.evaluate(temBotao("Voltar ao resultado"))),
      "'Ver a mesa final' encolhe o resultado numa faixa",
    );
    await page.evaluate(tecla("Escape"));
    await espera(200);
    conferir(Boolean(await page.evaluate(`return Boolean(document.querySelector("[data-result]"));`)), "Esc traz o resultado de volta");
    await page.evaluate(`document.querySelector("[data-rematch]")?.click(); return true;`);
    const novo = await ate(
      page,
      `
      const mesa = document.querySelector(".tf-playmat");
      return mesa && !document.querySelector("[data-result]") && /Sua vez/i.test(mesa.innerText) ? true : null;
    `,
      { tentativas: 80, intervalo: 500 },
    );
    conferir(Boolean(novo), "a revanche começa um duelo novo");

    const erros = page.console.filter((c) => c.level === "error");
    conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));
    conferir(erros.length === 0, "sem erros de console", erros.map((e) => e.text).join(" | ").slice(0, 300));
  } finally {
    child.kill();
  }

  if (falhas.length) {
    console.log(`\n${falhas.length} falha(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\nPopups escondíveis: tudo certo. Fotos em ${OUT}/popup-*.png`);
  }
}

await main();
