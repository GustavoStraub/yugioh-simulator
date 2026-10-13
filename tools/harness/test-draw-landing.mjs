/**
 * Verifica que a carta comprada pousa na posição certa da mão.
 *
 * Uma foto não prova isso — o voo dura ~380 ms e termina exatamente onde a
 * carta já está desenhada. Então em vez de olhar, o teste mede: intercepta o
 * `Element.animate` do fantasma da compra, lê o `translate` do último quadro,
 * calcula onde ele termina e compara com o centro do slot real da mão.
 *
 * É a diferença entre "o código mira no slot certo" e "o voo termina no slot
 * certo" — que era justamente a reclamação (a carta ia para o meio da mão).
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-draw-landing.mjs
 */
import { launchChrome, openPage } from "./browser.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
/** Folga aceitável entre o fim do voo e o centro do slot, em pixels. */
const TOLERANCIA_PX = 6;

function deck() {
  const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const contagem = new Map();
  for (const code of presets[0].main) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return {
    id: "draw", name: "Draw", format: "goat",
    main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
    extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Instala o grampo antes de qualquer compra acontecer.
 *
 * O fantasma da compra é um `div.tf-card-back` posicionado em absoluto que
 * chama `animate()` uma vez e some. Envolvendo `Element.prototype.animate`
 * dá para guardar, para cada voo, de onde saiu e o deslocamento final.
 */
const GRAMPO = `
  // Idempotente: instalar duas vezes envolveria o animate duas vezes e cada
  // voo apareceria em duplicata, inflando a contagem sem medir nada a mais.
  if (window.__grampoInstalado) return true;
  window.__grampoInstalado = true;
  window.__voos = [];
  const original = Element.prototype.animate;
  Element.prototype.animate = function (quadros, opcoes) {
    try {
      const ehFantasmaDeCompra =
        this instanceof HTMLElement && this.classList.contains("tf-card-back");
      if (ehFantasmaDeCompra && Array.isArray(quadros)) {
        const ultimo = quadros[quadros.length - 1];
        const m = /translate\\((-?[\\d.]+)px,\\s*(-?[\\d.]+)px\\)/.exec(ultimo?.transform ?? "");
        if (m) {
          window.__voos.push({
            left: parseFloat(this.style.left),
            top: parseFloat(this.style.top),
            w: parseFloat(this.style.width),
            h: parseFloat(this.style.height),
            dx: parseFloat(m[1]),
            dy: parseFloat(m[2]),
          });
        }
      }
    } catch {}
    return original.call(this, quadros, opcoes);
  };
  return true;
`;

/**
 * Centro de cada slot das DUAS mãos, em coordenadas do campo.
 *
 * O oponente também compra, e o voo dele vai para a mão dele. Comparar tudo
 * contra a mão do jogador marcaria as compras do oponente como erro — o teste
 * precisa saber de quem é cada voo antes de julgar.
 */
const SLOTS_DAS_MAOS = `
  const mesa = document.querySelector("[data-hand='0']")?.closest("div[class*='relative']");
  if (!mesa) return null;
  const caixaCampo = mesa.getBoundingClientRect();

  const ler = (dono) => {
    const mao = document.querySelector("[data-hand='" + dono + "']");
    if (!mao) return [];
    return [...mao.children]
      .filter((n) => n.getBoundingClientRect && n.getBoundingClientRect().width > 20)
      .map((n) => {
        const b = n.getBoundingClientRect();
        return {
          dono,
          zone: n.getAttribute ? (n.getAttribute("data-zone") ?? "verso") : "verso",
          x: b.left - caixaCampo.left + b.width / 2,
          y: b.top - caixaCampo.top + b.height / 2,
        };
      });
  };

  return { jogador: ler("0"), oponente: ler("1") };
`;

async function main() {
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.goto(`${BASE}/duel`);
    // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`)
    // segura a aplicação na pergunta "como você quer ser chamado?".
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessdrawlandi", name: "Testador" }),
      )});
       localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deck()))}); return true;`,
    );
    await page.goto(`${BASE}/duel`);
    for (let i = 0; i < 60; i += 1) {
      const t = await page.evaluate("return document.body.innerText");
      if (!t.includes("Carregando catálogo")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Espera o botão existir: o catálogo (TCG inteiro) e a biblioteca de decks
    // carregam antes, e clicar cedo demais não acha nada.
    await page.waitForText("Iniciar duelo", { timeout: 60000 }).catch(() => {});
    if (!(await page.clickText("Iniciar duelo"))) throw new Error("não iniciou o duelo");

    // O grampo precisa entrar já na mesa: o lobby e o duelo são páginas
    // diferentes, e instalar antes da navegação perderia o wrapper.
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(GRAMPO);

    let medidas = [];
    /**
     * Compras de TURNO, feitas sobre uma mão que já existe.
     *
     * A mão de abertura enche uma mão vazia e acerta o alvo mesmo com a
     * lógica antiga; o caso que estava quebrado é a compra de cada turno,
     * que entrava numa mão já povoada. É essa que precisa ser medida.
     */
    let comMaoCheia = 0;
    const TAMANHO_DA_MAO_INICIAL = 5;
    const prazo = Date.now() + 1000 * 180;

    while (Date.now() < prazo && comMaoCheia < 2) {
      const voos = await page.evaluate("return window.__voos ?? []");
      if (voos.length > 0) {
        const maos = await page.evaluate(SLOTS_DAS_MAOS);
        const slots = maos ? [...maos.jogador, ...maos.oponente] : null;
        if (slots && slots.length) {
          // Compara cada voo registrado com o slot mais próximo do seu destino.
          for (const voo of voos) {
            const destino = { x: voo.left + voo.w / 2 + voo.dx, y: voo.top + voo.h / 2 + voo.dy };
            let melhor = null;
            for (const slot of slots) {
              const d = Math.hypot(slot.x - destino.x, slot.y - destino.y);
              if (!melhor || d < melhor.d) melhor = { d, slot };
            }
            // A compra de abertura enche uma mão vazia; a de cada turno chega
            // numa mão que já tem cartas, e é aí que o destino "meio da mão"
            // ficava visivelmente errado. Distinguir os dois casos evita que
            // o teste passe só pelo caso fácil.
            // Só as compras do JOGADOR são julgadas: as do oponente vão para
            // a mão dele, e ele nem tem slots identificáveis (são só versos).
            const doJogador = melhor.slot.dono === "0";
            const tamanhoDaMao = maos.jogador.length;
            const maoCheia = doJogador && tamanhoDaMao > TAMANHO_DA_MAO_INICIAL;
            if (maoCheia) comMaoCheia += 1;
            medidas.push({ destino, melhor, doJogador, maoCheia, tamanhoDaMao });
          }
          await page.evaluate("window.__voos = []; return true;");
        }
      }

      // Toca o jogo para o turno passar e novas compras acontecerem.
      const estado = await page.evaluate(`
        const util = (b) => !b.disabled && b.offsetParent !== null && !b.closest("[data-table-control]") && !b.innerText.includes("\\u{1F50A}") && !b.closest('[aria-label="Idioma das cartas"]');
        return {
          botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean),
          cartas: document.querySelectorAll(".tf-slot-active").length,
        };
      `);
      // PASSAR o turno, não jogar: o caso que importa é a compra de turno
      // chegando numa mão que já tem mais de 5 cartas. Jogando cartas (como
      // o teste fazia), a mão ficava em 5 ou menos e o caso dependia de
      // sorte — duas rodadas em três terminavam sem medi-lo. Carta só quando
      // o jogo obriga (descarte no limite de mão, escolha forçada).
      const passar =
        estado.botoes.find((b) => b.includes("Encerrar turno")) ??
        estado.botoes.find((b) => b === "EP") ??
        estado.botoes.find((b) => b.startsWith("Não"));
      if (passar) {
        await page.clickAction(passar);
      } else if (estado.cartas > 0) {
        await page.evaluate(`const c=[...document.querySelectorAll(".tf-slot-active")]; if(c.length)c[0].click(); return true;`);
        await new Promise((r) => setTimeout(r, 150));
        const depois = await page.evaluate(`return [...document.querySelectorAll("button")].filter(b=>!b.disabled&&b.offsetParent&&!b.closest("header, nav")).map(b=>b.innerText.trim()).filter(Boolean)`);
        const acao = depois.find((b) => /^(Confirmar|Descartar|Baixar|Invocar|Ativar)/.test(b));
        if (acao) await page.clickAction(acao);
      } else if (estado.botoes[0]) {
        await page.clickAction(estado.botoes[0]);
      }
      await new Promise((r) => setTimeout(r, 220));
    }

    if (medidas.length === 0) {
      process.stdout.write("nenhuma compra observada — teste inconclusivo\n");
      process.exitCode = 1;
      return;
    }

    let falhas = 0;
    for (const [i, m] of medidas.entries()) {
      if (!m.doJogador) {
        process.stdout.write(`voo ${i + 1}: compra do oponente — não avaliado\n`);
        continue;
      }
      const ok = m.melhor.d <= TOLERANCIA_PX;
      if (!ok) falhas += 1;
      process.stdout.write(
        `voo ${i + 1}: destino (${m.destino.x.toFixed(0)}, ${m.destino.y.toFixed(0)}) ` +
        `→ slot ${m.melhor.slot.zone} a ${m.melhor.d.toFixed(1)}px ` +
        `[mão com ${m.tamanhoDaMao}] ${ok ? "OK" : "FORA"}\n`,
      );
    }
    process.stdout.write(
      `\nvoos do jogador: ${medidas.filter((m) => m.doJogador).length} ` +
      `(${medidas.filter((m) => m.maoCheia).length} sobre mão já povoada) | ` +
      `fora da tolerância (${TOLERANCIA_PX}px): ${falhas}\n`,
    );
    if (falhas > 0) process.exitCode = 1;
    if (!medidas.some((m) => m.maoCheia)) {
      process.stdout.write(
        "⚠ nenhuma compra de turno (mão já povoada) foi observada — o caso " +
        "que estava quebrado ficou sem medição.\n",
      );
      process.exitCode = 1;
    }
  } finally {
    child.kill();
  }
}

await main();
