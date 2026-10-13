/**
 * Aprender jogando, pela tela (Fase 12): puzzles, dicas, glossário e o modo
 * espectador num Chrome de verdade.
 *
 *   1. Puzzles: a lista, resolver o "Raio final" só com cliques (o ✓ volta
 *      para a lista), errar o "Mudança de opinião" de propósito e ver o
 *      resultado explicar, a solução a pedido e o "Tentar de novo".
 *   2. Glossário: no "Abra caminho", o "alvo" do Tufão aparece sublinhado e a
 *      definição abre num clique.
 *   3. Dicas: aparecem num perfil novo, "Entendi" não a mostra mais (nem
 *      depois de recarregar), e desligar na engrenagem cala todas.
 *   4. Celular: o objetivo começa fechado num selo e a dica não o cobre.
 *   5. Bot × bot: o duelo anda sozinho, ninguém é perguntado, e o aviso de
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

/** Clica a zona (`data-zone`) — o botão dentro dela. */
const CLICAR_ZONA = (zona) => `
  const el = document.querySelector('[data-zone="${zona}"] [role="button"]');
  el?.click();
  return Boolean(el);
`;

async function jogarPuzzle(page, id) {
  await page.goto(`${BASE}/duel/puzzles`);
  await ate(page, `return Boolean(document.querySelector('[data-play-puzzle="${id}"]'));`);
  await page.evaluate(`document.querySelector('[data-play-puzzle="${id}"]').click(); return true;`);
  return ate(page, `return Boolean(document.querySelector("[data-puzzle-goal]")) && !document.querySelector(".tf-playmat")?.dataset.processing;`, {
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
      localStorage.removeItem("yugioh-goat-puzzles-v1");
      localStorage.removeItem("yugioh-goat-duel-prefs-v1");
      return true;
    `);

    // ---- 1. Puzzles -----------------------------------------------------
    console.log("1. Puzzles");
    await page.goto(`${BASE}/duel/puzzles`);
    const lista = await ate(page, `const n = document.querySelectorAll("[data-puzzle]").length; return n || null;`);
    conferir(lista >= 3, `a lista mostra os problemas (${lista})`);

    conferir(Boolean(await jogarPuzzle(page, "raio-final")), "o 'Raio final' abre com o objetivo à vista");
    const goal = await page.evaluate(`return document.querySelector("[data-puzzle-goal]")?.innerText ?? "";`);
    conferir(/1900 LP/.test(goal), "o objetivo diz o que é vencer", goal.slice(0, 80));
    await page.evaluate(`document.querySelector("[data-puzzle-goal-toggle]")?.click(); return true;`);
    await espera(150);
    const fechado = await page.evaluate(`return document.querySelector("[data-puzzle-goal]")?.innerText ?? "";`);
    await page.evaluate(`document.querySelector("[data-puzzle-goal-toggle]")?.click(); return true;`);
    await espera(150);
    const reaberto = await page.evaluate(`return document.querySelector("[data-puzzle-goal]")?.innerText ?? "";`);
    conferir(
      /Objetivo/.test(fechado) && !/1900 LP/.test(fechado) && /1900 LP/.test(reaberto),
      "o objetivo minimiza num selo e volta",
      `${fechado} | ${reaberto.slice(0, 40)}`,
    );

    // Dica de primeira vez (perfil sem dicas vistas).
    const dica1 = await ate(page, `return document.querySelector("[data-tip]")?.dataset.tip ?? null;`, { tentativas: 20 });
    conferir(Boolean(dica1), `uma dica de primeira vez aparece (${dica1})`);
    await page.clickText("Entendi");
    await espera(300);
    const dica2 = await page.evaluate(`return document.querySelector("[data-tip]")?.dataset.tip ?? null;`);
    conferir(dica2 !== dica1, `'Entendi' troca/fecha a dica (${dica1} → ${dica2 ?? "nenhuma"})`);

    // Resolve: Raigeki, BP, ataque direto com os Elfos.
    const raigeki = await ate(page, `
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')].find((el) => /Raigeki/i.test(el.querySelector("img")?.alt ?? ""));
      return slot && slot.querySelector(".tf-slot-active") ? slot.dataset.zone : null;
    `);
    await page.evaluate(CLICAR_ZONA(raigeki));
    await espera(250);
    await page.clickAction("Ativar");
    const lugar = await ate(page, `return document.querySelector(".tf-slot-place")?.closest("[data-zone]")?.dataset.zone ?? null;`, { tentativas: 20 });
    if (lugar) await page.evaluate(CLICAR_ZONA(lugar));
    await ate(page, `return document.querySelector('[data-phase="BP"]:not([disabled])') ? true : null;`, { tentativas: 60 });
    await page.evaluate(`document.querySelector('[data-phase="BP"]').click(); return true;`);
    await ate(page, `return document.querySelector('[data-zone="0:4:2"] .tf-slot-active') ? true : null;`, { tentativas: 60 });
    await page.evaluate(CLICAR_ZONA("0:4:2"));
    await espera(250);
    await page.clickAction("Atacar direto");
    const venceu = await ate(page, `return /Aprendiz venceu/.test(document.querySelector("[data-result]")?.innerText ?? "") ? true : null;`, { tentativas: 60 });
    conferir(Boolean(venceu), "resolvido só com cliques: Raigeki e ataque direto");
    await page.goto(`${BASE}/duel/puzzles`);
    conferir(
      Boolean(await ate(page, `return document.querySelector('[data-puzzle="raio-final"] [data-puzzle-solved]') ? true : null;`)),
      "a lista marca o problema como resolvido",
    );

    // Errar de propósito: encerrar o turno sem jogar.
    await jogarPuzzle(page, "mudanca-de-opiniao");
    await ate(page, `return document.querySelector('[data-phase="EP"]:not([disabled])') ? true : null;`, { tentativas: 60 });
    await page.evaluate(`document.querySelector('[data-phase="EP"]').click(); return true;`);
    const perdeu = await ate(page, `const t = document.querySelector("[data-result]")?.innerText ?? ""; return /turno acabou sem vencer/i.test(t) ? t : null;`, { tentativas: 60 });
    conferir(Boolean(perdeu), "passar o turno sem vencer encerra o problema com a explicação");
    await page.clickText("Ver a solução");
    await espera(200);
    conferir(
      /Mudança de Opinião/.test(await page.evaluate(`return document.querySelector("[data-puzzle-solution]")?.innerText ?? "";`)),
      "a solução aparece a pedido",
    );
    await page.evaluate(`document.querySelector("[data-rematch]")?.click(); return true;`);
    conferir(
      Boolean(await ate(page, `return !document.querySelector("[data-result]") && document.querySelector("[data-puzzle-goal]") ? true : null;`, { tentativas: 40 })),
      "'Tentar de novo' recomeça o mesmo problema",
    );

    // ---- 2. Glossário ---------------------------------------------------
    console.log("2. Glossário");
    await jogarPuzzle(page, "abra-caminho");
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
    console.log("3. Dicas");
    const vistas = await page.evaluate(`return JSON.parse(localStorage.getItem("yugioh-goat-tips-v1") ?? "{}").seen ?? [];`);
    conferir(vistas.includes(dica1), `a dica vista fica guardada (${vistas.join(", ")})`);
    // Uma página nova do zero (outro problema): o estado vem do navegador.
    await jogarPuzzle(page, "raio-final");
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

    // ---- 4. Celular: objetivo e dica não se tapam -------------------------
    console.log("4. Celular");
    await page.evaluate(`localStorage.removeItem("yugioh-goat-tips-v1"); return true;`);
    await page.setViewport(390, 844);
    await jogarPuzzle(page, "raio-final");
    const celular = await ate(page, `
      const objetivo = document.querySelector("[data-puzzle-goal]");
      const dica = document.querySelector("[data-tip]");
      if (!objetivo || !dica) return null;
      const a = objetivo.getBoundingClientRect();
      const b = dica.getBoundingClientRect();
      const cruza = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return { selo: objetivo.innerText.trim(), cruza };
    `, { tentativas: 40 });
    conferir(celular?.selo === "🧩 Objetivo", "no celular o objetivo começa fechado num selo", JSON.stringify(celular));
    conferir(celular && !celular.cruza, "e a dica não o cobre");
    await page.evaluate(`document.querySelector("[data-puzzle-goal-toggle]")?.click(); return true;`);
    await espera(150);
    conferir(
      /1900 LP/.test(await page.evaluate(`return document.querySelector("[data-puzzle-goal]")?.innerText ?? "";`)),
      "um toque no selo abre o objetivo",
    );
    await page.setViewport(1440, 900);

    // ---- 5. Bot × bot ---------------------------------------------------
    console.log("5. Bot × bot");
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
