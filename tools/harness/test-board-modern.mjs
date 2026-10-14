/**
 * A mesa moderna (TCG) no navegador: o que o engine põe em campo aparece?
 *
 * Abre um duelo TCG com uma **mesa de teste** já montada (`scenario` do
 * `DuelSessionConfig`, gravado direto no `sessionStorage` — a mesma porta que
 * a tela usa para começar um duelo local) e confere no DOM:
 *
 * - a fileira das Zonas de Monstro Extra existe, com um Link de cada lado (o
 *   do oponente na zona compartilhada, de pé, com as setas giradas);
 * - as setas do Link chegam à carta, e as zonas para onde elas apontam ficam
 *   marcadas — pela geometria certa, inclusive a do Link do oponente;
 * - as escalas de Pêndulo aparecem nas zonas 1 e 5 da fileira de magias;
 * - Rank e Nível aparecem nos monstros em campo;
 * - o Extra Deck do oponente mostra só o Pêndulo virado para cima.
 *
 * E tira as fotos em `.cache/shots/` — ler o DOM diz se a mesa funciona; só
 * olhando dá para dizer se ela está boa.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-board-modern.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation, OcgPosition } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

const C = {
  ox: 5053103,
  elf: 15025844,
  linkSpider: 98978921, // Link-1, seta para baixo
  decodeTalker: 1861629, // Link-3, setas 0x85
  utopia: 84013237, // Xyz Rank 4
  oddEyes: 16178681, // Pêndulo 4/4
  timegazer: 20409757, // Pêndulo 8/8
  stargazer: 94415058, // Pêndulo 1/1
  raigeki: 12580477, // destrói os monstros do oponente
  breaker: 71413901, // ganha 1 Marcador de Magia ao ser Invocado-Normal
  // Ficha sem arte na YGOPRODeck: a rota de imagem desenha a face.
  fiendsmithToken: 35552986,
};

const M = OcgLocation.MZONE;
const S = OcgLocation.SZONE;

/** A mesa: um Link em cada Zona Extra, um Xyz, escalas e Extra Deck público. */
const SCENARIO = [
  { player: 0, location: M, sequence: 5, code: C.linkSpider }, // Zona Extra esquerda (minha)
  { player: 0, location: M, sequence: 2, code: C.utopia },
  { player: 0, location: M, sequence: 0, code: C.elf },
  { player: 0, location: M, sequence: 4, code: C.fiendsmithToken },
  { player: 0, location: S, sequence: 0, position: OcgPosition.FACEUP, code: C.oddEyes },
  { player: 0, location: S, sequence: 4, position: OcgPosition.FACEUP, code: C.timegazer },
  // Zona 5 do oponente = a Zona Extra da DIREITA na minha tela.
  { player: 1, location: M, sequence: 5, code: C.decodeTalker },
  { player: 1, location: M, sequence: 1, code: C.ox },
  // Pêndulo destruído vai para o Extra Deck VIRADO PARA CIMA — e é o único
  // jeito de ele chegar lá: o core manda para o Deck a carta de Main Deck
  // criada direto no Extra. O Raigeki na mão é quem faz isso durante o teste.
  { player: 1, location: M, sequence: 3, code: C.stargazer },
  { player: 1, location: OcgLocation.EXTRA, code: C.utopia },
  { player: 0, location: OcgLocation.HAND, code: C.raigeki },
  { player: 0, location: OcgLocation.HAND, code: C.breaker },
];

const setup = {
  playerName: "Testador",
  playerDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
  format: "tcg",
  scenario: SCENARIO,
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const LER_MESA = `
  const zona = (k) => document.querySelector('[data-zone="' + k + '"]');
  const texto = (k) => zona(k)?.innerText ?? "";
  return {
    fileiraExtra: Boolean(document.querySelector('[data-row="extra-monster-zones"]')),
    linkMeu: zona("0:4:5")?.querySelector("[data-link-markers]")?.dataset.linkMarkers ?? null,
    linkDele: zona("1:4:5")?.querySelector("[data-link-markers]")?.dataset.linkMarkers ?? null,
    setasAcesasMeu: zona("0:4:5")?.querySelectorAll("[data-arrow-on]").length ?? 0,
    linkDeleGirado: (zona("1:4:5")?.querySelector("[style*='rotate(180deg)']")) != null,
    apontadas: [...document.querySelectorAll(".tf-slot-linked")].map((el) => el.closest("[data-zone]")?.dataset.zone).sort(),
    escalaEsq: texto("0:8:0"),
    escalaDir: texto("0:8:4"),
    // O selo do MD no pé da carta: o ícone (estrela, estrela escura do Rank,
    // o do Link) vem por CSS; o texto é só o número.
    rankUtopia: (() => { const b = zona("0:4:2")?.querySelector("[data-level-badge]"); return b ? b.dataset.levelBadge + ":" + b.innerText.trim() : ""; })(),
    nivelElf: (() => { const b = zona("0:4:0")?.querySelector("[data-level-badge]"); return b ? b.dataset.levelBadge + ":" + b.innerText.trim() : ""; })(),
    extraDele: [...document.querySelectorAll("[title*='Pêndulos virados para cima']")].map((el) => el.innerText),
    rolagemHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/duel`);
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessboardtcg1", name: "Testador" }),
      )});
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);

    // Espera a mesa existir E o Link do oponente ter sido desenhado.
    let mesa = null;
    for (let i = 0; i < 90; i += 1) {
      mesa = await page.evaluate(LER_MESA).catch(() => null);
      if (mesa?.linkDele) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
    mesa = await page.evaluate(LER_MESA);
    writeFileSync(join(OUT, "tcg-mesa.png"), Buffer.from((await page.screenshot()).data, "base64"));

    console.log("Mesa TCG — Zonas Extra, Link, Pêndulo, Xyz");
    conferir(mesa.fileiraExtra, "a fileira das Zonas de Monstro Extra existe");
    conferir(mesa.linkMeu === "2", "o meu Link Spider está na Zona Extra, com a seta para baixo", String(mesa.linkMeu));
    conferir(mesa.setasAcesasMeu === 1, "uma seta acesa no Link Spider", String(mesa.setasAcesasMeu));
    conferir(mesa.linkDele === "133", "o Decode Talker do oponente aparece na Zona Extra compartilhada", String(mesa.linkDele));

    // Ficha sem arte na YGOPRODeck: imagem carregada (a face desenhada) e o
    // nome certo — antes era imagem quebrada com o nome "Carta".
    const ficha = await page.evaluate(`
      const img = document.querySelector('[data-zone="0:4:4"] img');
      if (!img) return null;
      return new Promise((resolve) => {
        const pronto = () => resolve({ largura: img.naturalWidth, nome: img.alt });
        img.complete ? pronto() : (img.onload = pronto, img.onerror = pronto);
      });
    `);
    conferir(
      ficha && ficha.largura > 0 && /Fiendsmith Token/.test(ficha.nome),
      "a ficha sem arte aparece com imagem e com o nome",
      JSON.stringify(ficha),
    );
    // Na mesa do MD a carta do oponente fica de pé; as setas do Link dele
    // giram meia volta (apontam para casas da mesa, e a "de cima" dele aponta
    // para o seu lado).
    conferir(mesa.linkDeleGirado, "e as setas do Link dele giram meia volta, como carta do oponente");
    // Link Spider (Zona Extra esquerda, seta para baixo) → minha zona 2 (índice 1).
    // Decode Talker do oponente (zona 5 dele = Zona Extra direita na minha
    // tela; setas cima, baixo-esq., baixo-dir. NA ÓTICA DELE) → minha zona 4
    // (índice 3) e as zonas 1 e 3 dele (índices 0 e 2).
    conferir(
      JSON.stringify(mesa.apontadas) === JSON.stringify(["0:4:1", "0:4:3", "1:4:0", "1:4:2"]),
      "as zonas apontadas pelos Links ficam marcadas, pela geometria certa",
      JSON.stringify(mesa.apontadas),
    );
    conferir(mesa.escalaEsq.includes("◂4"), "a escala esquerda (Odd-Eyes, 4) aparece na zona 1", mesa.escalaEsq);
    conferir(mesa.escalaDir.includes("8▸"), "a escala direita (Timegazer, 8) aparece na zona 5", mesa.escalaDir);
    conferir(mesa.rankUtopia === "rank:4", "o Utopia mostra Rank 4", mesa.rankUtopia);
    conferir(mesa.nivelElf === "level:4", "o Mystical Elf mostra Nível 4", mesa.nivelElf);
    conferir(!mesa.rolagemHorizontal, "sem rolagem horizontal");

    // A leitura da carta diz o número antes dos símbolos — Nível, Rank e Link.
    const lerLeitura = async (zona, attr) => {
      await page.evaluate(`
        document.querySelector('[data-zone="${zona}"] .tf-slot')
          ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return true;
      `);
      await new Promise((r) => setTimeout(r, 300));
      // O número e o tipo (na dica): a leitura do MD é o ícone e o número.
      return page.evaluate(
        `const el = document.querySelector("[${attr}]");
         return el ? (el.getAttribute("title") ?? "") + " | " + el.innerText.replace(/\\s+/g, " ").trim() : "";`,
      );
    };
    const leituraElf = await lerLeitura("0:4:0", "data-preview-level");
    conferir(/^Nível 4 \| 4$/.test(leituraElf), "a leitura do Mystical Elf mostra o Nível 4 em número", leituraElf);
    const leituraUtopia = await lerLeitura("0:4:2", "data-preview-rank");
    conferir(/^Rank 4 \| 4$/.test(leituraUtopia), "a do Utopia mostra o Rank 4 em número", leituraUtopia);
    const leituraSpider = await lerLeitura("0:4:5", "data-preview-link");
    conferir(/^Link 1 \| LINK-1/.test(leituraSpider), "a do Link Spider diz \"LINK-1\" antes das setas", leituraSpider);

    // Marcas: o Breaker invocado ganha o Marcador de Magia, e ele aparece no
    // slot (selo) e na leitura da carta (frase).
    console.log("\nMarcas na carta");
    const invocou = await page.evaluate(`
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')]
        .find((el) => /Breaker/.test(el.querySelector("img")?.alt ?? ""));
      if (!slot) return false;
      slot.querySelector('[role="button"]')?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    await page.clickAction("Invocar");
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(`document.querySelector('[data-zone="0:4:1"] [role="button"]')?.click(); return true;`);
    let selo = null;
    for (let i = 0; i < 30 && !selo; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      await page.clickText("Não responder");
      selo = await page.evaluate(
        `return document.querySelector('[data-zone="0:4:1"] [data-marks]')?.innerText ?? null;`,
      );
    }
    conferir(invocou, "o Breaker está na mão e foi invocado pela tela");
    conferir(/✦1/.test(selo ?? ""), "o slot do Breaker mostra o selo do Marcador de Magia", String(selo));
    await page.evaluate(`
      const alvo = document.querySelector('[data-zone="0:4:1"] .tf-slot');
      alvo?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    const leitura = await page.evaluate(`return document.querySelector("[data-preview-marks]")?.innerText ?? "";`);
    conferir(/Marcador de Magia ×1/.test(leitura), "a leitura da carta diz \"Marcador de Magia ×1\"", leitura);
    writeFileSync(join(OUT, "tcg-marcas.png"), Buffer.from((await page.screenshot()).data, "base64"));

    // Raigeki: o Stargazer do oponente é destruído e volta para o Extra Deck
    // dele virado para cima.
    console.log("\nPêndulo destruído vai para o Extra Deck, à vista");
    const ativou = await page.evaluate(`
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')]
        .find((el) => el.querySelector("img")?.alt === "Raigeki");
      if (!slot) return false;
      slot.querySelector('[role="button"]')?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 300));
    await page.clickAction("Ativar");
    await new Promise((r) => setTimeout(r, 600));
    // Com várias zonas livres, o engine pergunta onde a Magia vai.
    await page.evaluate(`document.querySelector('[data-zone="0:8:1"] [role="button"]')?.click(); return true;`);
    let extraDele = [];
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      // Responde "não" a qualquer pergunta que o efeito faça no caminho.
      await page.clickText("Não responder");
      extraDele = await page.evaluate(
        `return [...document.querySelectorAll("[title*='Pêndulos virados para cima']")].map((el) => el.innerText);`,
      );
      if (extraDele.some((t) => t.includes("↑1"))) break;
    }
    conferir(ativou, "o Raigeki está na mão e foi clicado");
    conferir(extraDele.some((t) => t.includes("↑1")), "o Extra Deck do oponente diz que há 1 carta para cima", JSON.stringify(extraDele));

    // O Extra Deck do oponente abre — e só com o Pêndulo virado para cima.
    await page.evaluate(`document.querySelector("[title*='Pêndulos virados para cima']")?.click(); return true;`);
    await new Promise((r) => setTimeout(r, 400));
    const modal = await page.evaluate(`
      const titulo = [...document.querySelectorAll("h3")].find((h) => h.innerText.includes("Extra Deck do oponente"));
      const caixa = titulo?.closest(".tf-panel");
      return {
        aberto: Boolean(titulo),
        cartas: caixa ? [...caixa.querySelectorAll("img")].map((img) => img.alt) : [],
      };
    `);
    writeFileSync(join(OUT, "tcg-extra-oponente.png"), Buffer.from((await page.screenshot()).data, "base64"));
    conferir(modal.aberto, "o Extra Deck do oponente abre");
    conferir(
      modal.cartas.length === 1 && /Stargazer|Mago Observador|Mágico/i.test(modal.cartas[0] ?? ""),
      "e mostra só o Pêndulo virado para cima",
      JSON.stringify(modal.cartas),
    );

    conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));

    // Telas menores: a mesa TCG tem uma fileira de cartas a mais que a Goat
    // (as Zonas Extra), então é ela que aperta primeiro.
    console.log("\nTelas menores");
    for (const [w, h] of [[1280, 720], [1024, 640]]) {
      const tela = await openPage(port);
      await tela.setViewport(w, h);
      await tela.goto(`${BASE}/duel`);
      await tela.evaluate(
        `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
          JSON.stringify({ id: "harnessboardtcg1", name: "Testador" }),
        )});
         sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
         return true;`,
      );
      await tela.goto(`${BASE}/duel/play`);
      let medida = null;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        medida = await tela.evaluate(`
          const emz = document.querySelector('[data-zone="0:4:5"]');
          const doc = document.documentElement;
          return {
            pronta: Boolean(emz?.querySelector("img")),
            altura: emz ? Math.round(emz.getBoundingClientRect().height) : 0,
            rolagem: doc.scrollWidth > doc.clientWidth + 1,
          };
        `);
        if (medida.pronta) break;
      }
      await new Promise((r) => setTimeout(r, 800));
      writeFileSync(join(OUT, `tcg-mesa-${w}x${h}.png`), Buffer.from((await tela.screenshot()).data, "base64"));
      conferir(
        medida.pronta && medida.altura >= 40 && !medida.rolagem,
        `${w}x${h}: Zona Extra desenhada (${medida.altura}px de altura), sem rolagem horizontal`,
      );
      await tela.close();
    }
  } finally {
    child.kill();
  }

  if (falhas.length) {
    console.log(`\n${falhas.length} falha(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\nMesa moderna: tudo certo. Fotos em ${OUT}`);
  }
}

await main();
