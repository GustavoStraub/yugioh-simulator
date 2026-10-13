/**
 * Aprender jogando, pela tela (Fase 12): dicas, glossário e o modo espectador
 * num Chrome de verdade.
 *
 *   1. Dicas: aparecem num perfil novo e "Entendi" troca/fecha a dica.
 *   2. Glossário: o "alvo" do Tufão (na mão, posto pela mesa de teste)
 *      aparece sublinhado e a definição abre num clique.
 *   3. Dicas: a vista não volta (nem depois de recarregar), e desligar na
 *      engrenagem cala todas.
 *   4. Bot × bot: o duelo anda sozinho, ninguém é perguntado, e o aviso de
 *      turno diz de quem é a vez (nunca "SEU TURNO" para quem só assiste).
 *
 * Uso: APP_URL=http://127.0.0.1:3000 npm run test:browser-learning [-- --headed]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";

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

const CELTIC_GUARDIAN = 91152256;
const MST = 5318639;
const MAO = 0x02;

/** Duelo contra o bot com o Tufão na mão — a mesa de teste do `sessionStorage`. */
const SETUP = {
  playerName: "Aprendiz",
  playerDeck: { main: Array(40).fill(CELTIC_GUARDIAN), extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(CELTIC_GUARDIAN), extra: [], side: [] },
  format: "goat",
  scenario: [{ player: 0, location: MAO, code: MST }],
};

/** Abre um duelo novo (sessão nova do engine) e espera a Main Phase 1. */
async function abrirDuelo(page) {
  await page.evaluate(`sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(SETUP))}); return true;`);
  await page.goto(`${BASE}/duel/play`);
  return ate(page, `return document.querySelector('[data-zone^="0:2:"] .tf-slot-active') ? true : null;`, {
    tentativas: 80,
    intervalo: 500,
  });
}

async function main() {
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/duel`);
    await page.evaluate(`
      localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(JSON.stringify({ id: "harnesslearn01", name: "Aprendiz" }))});
      localStorage.removeItem("yugioh-goat-tips-v1");
      localStorage.removeItem("yugioh-goat-duel-prefs-v1");
      return true;
    `);

    // ---- 1. Dicas de primeira vez (perfil sem dicas vistas) -------------
    console.log("1. Dicas");
    conferir(Boolean(await abrirDuelo(page)), "o duelo abre com a mão jogável");
    const dica1 = await ate(page, `return document.querySelector("[data-tip]")?.dataset.tip ?? null;`, { tentativas: 20 });
    conferir(Boolean(dica1), `uma dica de primeira vez aparece (${dica1})`);
    await page.clickText("Entendi");
    await espera(300);
    const dica2 = await page.evaluate(`return document.querySelector("[data-tip]")?.dataset.tip ?? null;`);
    conferir(dica2 !== dica1, `'Entendi' troca/fecha a dica (${dica1} → ${dica2 ?? "nenhuma"})`);

    // ---- 2. Glossário ---------------------------------------------------
    console.log("2. Glossário");
    const leu = await ate(page, `
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')].find((el) => /Tuf|Typhoon/i.test(el.querySelector("img")?.alt ?? ""));
      if (!slot) return null;
      slot.querySelector(".tf-touch-card").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return document.querySelector('[data-glossary-term="target"]') ? true : null;
    `, { tentativas: 20 });
    conferir(Boolean(leu), "o 'alvo' do Tufão aparece sublinhado na leitura da carta");
    await page.evaluate(`document.querySelector('[data-glossary-term="target"]')?.click(); return true;`);
    await espera(150);
    conferir(
      Boolean(await page.evaluate(`return document.querySelector('[data-glossary-definition="target"]')?.innerText.length > 20;`)),
      "um clique abre a definição",
    );

    // ---- 3. Dicas: não voltam, e desligam ---------------------------------
    console.log("3. Dicas guardadas");
    const vistas = await page.evaluate(`return JSON.parse(localStorage.getItem("yugioh-goat-tips-v1") ?? "{}").seen ?? [];`);
    conferir(vistas.includes(dica1), `a dica vista fica guardada (${vistas.join(", ")})`);
    // Uma página nova do zero (outro duelo): o estado vem do navegador.
    await abrirDuelo(page);
    await espera(800);
    const depois = await page.evaluate(`return document.querySelector("[data-tip]")?.dataset.tip ?? null;`);
    conferir(depois !== dica1, `depois de recarregar ela não volta (agora: ${depois ?? "nenhuma"})`);
    await page.evaluate(`document.querySelector("[data-duel-settings]")?.click(); return true;`);
    await espera(200);
    const desligou = await page.evaluate(`
      const caixa = document.querySelector("[data-tips-toggle]");
      if (!caixa) return false;
      caixa.click();
      return caixa.checked === false;
    `);
    conferir(desligou, "a engrenagem tem a caixa 'Mostrar dicas', e ela desmarca");
    // Fecha a engrenagem: a dica não pode estar só escondida atrás dela.
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true;`);
    await espera(250);
    conferir(!(await page.evaluate(`return Boolean(document.querySelector("[data-tip]"));`)), "desligar na engrenagem cala as dicas");

    // ---- 4. Bot × bot ---------------------------------------------------
    console.log("4. Bot × bot");
    const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
    const agrupar = (l) => { const m = new Map(); for (const c of l) m.set(c, (m.get(c) ?? 0) + 1); return [...m].map(([passcode, quantity]) => ({ passcode, quantity })); };
    await page.evaluate(`localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify({ id: "learn", name: "Aprendiz", format: "goat", main: agrupar(presets[0].main), extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z" }))}); return true;`);
    await page.goto(`${BASE}/duel`);
    await ate(page, `return document.querySelector("[data-spectate]:not([disabled])") ? true : null;`, { tentativas: 60, intervalo: 500 });
    // O aviso de turno dura ~1 s: um observador anota todo aviso que aparecer.
    // A navegação do lobby para a mesa é do lado do cliente, então ele
    // continua vivo na mesa.
    await page.evaluate(`
      window.__avisos = [];
      new MutationObserver((mudancas) => {
        for (const m of mudancas) for (const no of m.addedNodes) {
          const t = no.textContent ?? "";
          const achado = t.match(/SEU TURNO|TURNO DO OPONENTE|VEZ DE [^\\n]{1,40}/);
          if (achado) window.__avisos.push(achado[0]);
        }
      }).observe(document.body, { subtree: true, childList: true });
      document.querySelector("[data-spectate]").click();
      return true;
    `);
    const andou = await ate(
      page,
      `const log = document.querySelector("[data-duel-log]")?.innerText ?? ""; return /Turno 3/i.test(log) ? true : null;`,
      { tentativas: 120, intervalo: 500 },
    );
    conferir(Boolean(andou), "o duelo anda sozinho (chegou ao turno 3)");
    conferir(!(await page.evaluate(`return Boolean(document.querySelector("[data-decision-dialog]"));`)), "e ninguém é perguntado");
    conferir(!/Sua vez/i.test(await page.evaluate(`return document.querySelector(".tf-playmat")?.innerText ?? "";`)), "o selo não diz 'Sua vez' a quem só assiste");
    const avisos = await page.evaluate(`return [...new Set(window.__avisos ?? [])];`);
    conferir(
      avisos.length > 0 && avisos.every((a) => a.startsWith("VEZ DE")),
      "o aviso de turno diz de quem é a vez, nunca 'SEU TURNO'",
      JSON.stringify(avisos),
    );

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
    console.log("\nAprender jogando pela tela: tudo certo.");
  }
}

await main();
