/**
 * Confere a mesa em telas menores e com "movimento reduzido" ligado.
 *
 * As cartas do tabuleiro têm proporção fixa e crescem a partir da ALTURA da
 * fileira. Numa janela baixa elas encolhem, e a pergunta é se algo estoura:
 * rolagem horizontal, painel espremido, texto ilegível. E o realce da carta
 * acionável é feito com animação — com movimento reduzido ele precisa
 * continuar visível de forma estática, senão o jogador perde a única pista de
 * onde clicar.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-viewports.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

/** Telas de teste: notebook comum, notebook baixo, e uma janela apertada. */
const TELAS = [
  { nome: "1440x900", w: 1440, h: 900 },
  { nome: "1280x720", w: 1280, h: 720 },
  { nome: "1024x640", w: 1024, h: 640 },
  // Mesa estreita (Fase 11): sem trilhos laterais, leitura em folha.
  { nome: "768x1024", w: 768, h: 1024 },
  { nome: "844x390", w: 844, h: 390 },
  { nome: "390x844", w: 390, h: 844 },
  { nome: "320x568", w: 320, h: 568 },
  { nome: "568x320", w: 568, h: 320 },
  { nome: "932x430", w: 932, h: 430 },
  { nome: "1024x768", w: 1024, h: 768 },
];

/**
 * Os dois formatos: a mesa TCG tem a fileira das Zonas Extra e é a que mais
 * aperta na vertical; a Goat, a de 2005.
 */
const FORMATOS = ["goat", "tcg"];

function deck(formato) {
  const arquivo = formato === "tcg" ? "src/data/preset-decks-tcg.json" : "src/data/preset-decks.json";
  const presets = JSON.parse(readFileSync(join(REPO, arquivo), "utf8"));
  const preset = presets.find((p) => p.id === "tcg-lavd-odd-eyes") ?? presets[0];
  const agrupar = (lista) => {
    const contagem = new Map();
    for (const code of lista) contagem.set(code, (contagem.get(code) ?? 0) + 1);
    return [...contagem].map(([passcode, quantity]) => ({ passcode, quantity }));
  };
  return {
    id: "vp", name: "VP", format: formato,
    main: agrupar(preset.main), extra: agrupar(preset.extra ?? []),
    side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const MEDIR = `
  const doc = document.documentElement;
  const mesa = document.querySelector(".tf-playmat");
  const carta = document.querySelector("[data-zone^='0:4:']");
  const realce = document.querySelector(".tf-slot-active");
  const sombra = realce ? getComputedStyle(realce).boxShadow : "";
  return {
    rolagemHorizontal: doc.scrollWidth > doc.clientWidth + 1,
    rolagemVertical: doc.scrollHeight > doc.clientHeight + 1,
    alturaDaCarta: carta ? Math.round(carta.getBoundingClientRect().height) : 0,
    larguraDaCarta: carta ? Math.round(carta.getBoundingClientRect().width) : 0,
    temRealce: Boolean(realce),
    // Com movimento reduzido a animação some; o contorno tem que ficar.
    realceVisivel: Boolean(sombra && sombra !== "none"),
    mesaVisivel: Boolean(mesa && mesa.getBoundingClientRect().height > 200),
    // A navegação do site inteira dentro da janela — no celular ela quebrava
    // linha e empurrava o PT/EN para fora.
    navegacaoCabe: (() => {
      const idioma = document.querySelector('[aria-label="Idioma das cartas"]');
      if (!idioma) return true;
      const r = idioma.getBoundingClientRect();
      // E todo item da navegação à vista: a parte que rola escondia
      // "Online" no celular sem nada indicar que havia mais.
      const itens = [...document.querySelectorAll("header nav a")].every((a) => {
        const caixa = a.parentElement.getBoundingClientRect();
        const ra = a.getBoundingClientRect();
        return ra.left >= caixa.left - 1 && ra.right <= caixa.right + 1 && ra.right <= window.innerWidth + 1;
      });
      return r.right <= window.innerWidth + 1 && r.height <= 48 && itens;
    })(),
    // Algo da barra de LP vazando para fora dela — no celular o selo "Sua
    // vez" passava por cima da barra do oponente.
    barraDeLpVaza: [...document.querySelectorAll("[data-lp-bar]")].some((barra) => {
      const b = barra.getBoundingClientRect();
      return [...barra.children].some((filho) => {
        const r = filho.getBoundingClientRect();
        return r.width > 0 && (r.left < b.left - 1 || r.right > b.right + 1);
      });
    }),
    // Peça da mesa saindo pela borda da janela (as banidas penduradas).
    foraDaJanela: [...document.querySelectorAll(".tf-playmat [data-zone], .tf-playmat [data-pile]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1))
      .map(({ el }) => el.dataset.zone ?? el.dataset.pile),
    // Peça da mesa (zona, pilha) por baixo de um dos trilhos — leitura da
    // carta à esquerda, fases + histórico à direita. Rolagem não acusa isso:
    // a mesa estoura PARA DENTRO dos trilhos, e a trilha de fases (z-50)
    // tampava a coluna de Extra/Cemitério/Deck numa janela de 1024.
    sobreposicoes: (() => {
      if (!mesa) return [];
      const trilhos = [...mesa.querySelectorAll("aside")].map((a) => a.getBoundingClientRect());
      const cruza = (a, b) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      return [...mesa.querySelectorAll("[data-zone], [data-pile]")]
        .filter((el) => !el.closest("aside"))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && trilhos.some((t) => cruza(r, t)))
        .map(({ el }) => el.dataset.zone ?? el.dataset.pile);
    })(),
  };
`;

async function abrirDuelo(page, formato = "goat") {
  await page.goto(`${BASE}/duel`);
  // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`) segura
  // a aplicação na pergunta "como você quer ser chamado?" e o lobby nem
  // renderiza — sem isto o teste morria em "não iniciou o duelo".
  await page.evaluate(
    `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
      JSON.stringify({ id: "harnessviewport1", name: "Medidor" }),
    )});
     localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deck(formato)))}); return true;`,
  );
  await page.goto(`${BASE}/duel`);
  for (let i = 0; i < 60; i += 1) {
    const t = await page.evaluate("return document.body.innerText");
    if (!t.includes("Carregando catálogo")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await page.clickText("Iniciar duelo"))) throw new Error("não iniciou o duelo");
  await new Promise((r) => setTimeout(r, 6000));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: true });
  let falhas = 0;

  try {
    for (const formato of FORMATOS) {
      for (const tela of TELAS) {
        const page = await openPage(port);
        await page.setViewport(tela.w, tela.h, { mobile: tela.w <= 1180, touch: tela.w <= 1180 });
        await abrirDuelo(page, formato);

        const m = await page.evaluate(MEDIR);
        const shot = await page.screenshot();
        writeFileSync(
          join(OUT, `viewport-${formato}-${tela.nome}.png`),
          Buffer.from(shot.data, "base64"),
        );

        // A mesa ocupa a janela inteira: rolagem horizontal quer dizer layout
        // estourado, e não "tela pequena". E nenhuma peça por baixo dos trilhos.
        // No celular a carta do campo é pequena por natureza (a mesa tem 7
        // colunas); o piso de altura lá é o de uma carta ainda tocável.
        const pisoDaCarta = tela.w < 600 || tela.h < 500 ? 30 : 40;
        const ok =
          !m.rolagemHorizontal &&
          m.mesaVisivel &&
          m.alturaDaCarta > pisoDaCarta &&
          m.sobreposicoes.length === 0 &&
          m.foraDaJanela.length === 0 &&
          !m.barraDeLpVaza &&
          m.navegacaoCabe;
        if (!ok) falhas += 1;
        process.stdout.write(
          `${ok ? "OK   " : "FALHA"} ${formato.padEnd(4)} ${tela.nome.padEnd(10)} carta=${m.larguraDaCarta}x${m.alturaDaCarta} ` +
          `rolagem-h=${m.rolagemHorizontal} mesa-visível=${m.mesaVisivel} ` +
          `sob-os-trilhos=${m.sobreposicoes.length ? m.sobreposicoes.join(",") : "nenhuma"} ` +
          `fora-da-janela=${m.foraDaJanela.length ? m.foraDaJanela.join(",") : "nenhuma"} nav-cabe=${m.navegacaoCabe} lp-vaza=${m.barraDeLpVaza}\n`,
        );
      }
    }

    // --- toque: toque longo numa carta abre a leitura (mesa estreita) ---
    {
      const page = await openPage(port);
      await page.setViewport(390, 844, { mobile: true, touch: true });
      await abrirDuelo(page);
      await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      const alvo = await page.evaluate(`
        const el = document.querySelector('[data-hand] [data-zone] .tf-touch-card');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      `);
      let abriu = false;
      if (alvo) {
        await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [alvo] });
        await new Promise((r) => setTimeout(r, 700));
        await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await new Promise((r) => setTimeout(r, 300));
        abriu = await page.evaluate(`return Boolean(document.querySelector("[data-card-sheet] img"));`);
      }
      const temBotoes = await page.evaluate(
        `return Boolean(document.querySelector("[data-open-log]") && document.querySelector("[data-open-card]"));`,
      );
      const shot = await page.screenshot();
      writeFileSync(join(OUT, "toque-leitura.png"), Buffer.from(shot.data, "base64"));
      const okToque = abriu && temBotoes;
      if (!okToque) falhas += 1;
      process.stdout.write(
        `${okToque ? "OK   " : "FALHA"} toque 390x844     toque-longo-abre-a-leitura=${abriu} botões-histórico/carta=${temBotoes}\n`,
      );
    }

    // --- cabeçalho fora da mesa (o grande, com o subtítulo) no celular ---
    {
      const page = await openPage(port);
      await page.setViewport(390, 844);
      await page.goto(`${BASE}/duel/online`);
      await new Promise((r) => setTimeout(r, 1500));
      const m = await page.evaluate(MEDIR);
      const ok = m.navegacaoCabe && !m.rolagemHorizontal;
      if (!ok) falhas += 1;
      process.stdout.write(
        `${ok ? "OK   " : "FALHA"} cabeçalho 390x844 (fora da mesa) nav-cabe=${m.navegacaoCabe} rolagem-h=${m.rolagemHorizontal}\n`,
      );
    }

    // --- movimento reduzido ---
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.setReducedMotion(true);
    await abrirDuelo(page);
    const m = await page.evaluate(MEDIR);
    const shot = await page.screenshot();
    writeFileSync(join(OUT, "movimento-reduzido.png"), Buffer.from(shot.data, "base64"));

    const okReduzido = m.temRealce ? m.realceVisivel : true;
    if (!okReduzido) falhas += 1;
    process.stdout.write(
      `${okReduzido ? "OK   " : "FALHA"} movimento-reduzido  ` +
      `tem-realce=${m.temRealce} realce-visível=${m.realceVisivel}\n`,
    );

    process.stdout.write(`\nfalhas: ${falhas}\nfotos em ${OUT}\n`);
    if (falhas > 0) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

await main();
