/**
 * A corrente se entende pela tela? O caso que motivou: tomar uma Ash Blossom.
 *
 * Antes, a Ash do oponente ia da mão para o Cemitério e a busca do jogador
 * simplesmente não acontecia — uma linha no histórico e nada mais. Agora cada
 * elo aparece em destaque no centro (quem ativou, de onde, o número do elo), a
 * pilha da corrente fica no trilho esquerdo, e o elo negado volta com o
 * carimbo NEGADO.
 *
 * O cenário: eu tenho Reforço do Exército na mão e um Deck de Guerreiros; o
 * bot tem Ash Blossom na mão. Ativo o Reforço clicando, o bot encadeia a Ash,
 * a Ash resolve e nega o efeito do Reforço. O teste acompanha a tela o tempo
 * todo e confere o que apareceu; as fotos vão para `.cache/shots/corrente-*.png`.
 *
 * Uso: APP_URL=http://127.0.0.1:3000 npm run test:browser-chain [-- --headed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");
const SPEED = process.env.DUEL_TEST_SPEED ?? "normal";

const CELTIC_GUARDIAN = 91152256; // Guerreiro de Nível 4: alvo do Reforço
const REINFORCEMENT = 32807846; // Reforço do Exército
const ASH_BLOSSOM = 14558127;

const setup = {
  playerName: "Testador",
  playerDeck: { main: Array(40).fill(CELTIC_GUARDIAN), extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(CELTIC_GUARDIAN), extra: [], side: [] },
  format: "tcg",
  scenario: [
    { player: 0, location: OcgLocation.HAND, code: REINFORCEMENT },
    { player: 1, location: OcgLocation.HAND, code: ASH_BLOSSOM },
  ],
};

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** O que a tela mostra da corrente agora. */
const LER = `
  const destaque = document.querySelector("[data-chain-spotlight]");
  const pilha = document.querySelector("[data-chain-stack]");
  return {
    destaque: destaque && {
      tipo: destaque.dataset.chainSpotlight,
      elo: Number(destaque.dataset.chainLink),
      texto: destaque.innerText.replace(/\\s+/g, " "),
    },
    pilha: pilha && [...pilha.querySelectorAll("[data-chain-row]")].map((linha) => ({
      elo: Number(linha.dataset.chainRow),
      estado: linha.dataset.chainState,
      texto: linha.innerText.replace(/\\s+/g, " "),
    })),
    botoes: [...document.querySelectorAll("button")]
      .filter((b) => !b.disabled && b.offsetParent !== null && !b.closest("header, nav"))
      .map((b) => b.innerText.trim()),
    // O histórico mora numa gaveta (fechada, mas montada): o texto vem dele
    // mesmo, e não de "o último trilho", que agora é placa de LP e fases.
    log: document.querySelector("[data-duel-log]")?.textContent ?? "",
    // A leitura da esquerda segue a ativação: o cabeçalho do elo e o nome da
    // carta que ele trouxe.
    leitura: (() => {
      const cabecalho = document.querySelector("[data-preview-activation]");
      if (!cabecalho) return null;
      return {
        elo: Number(cabecalho.dataset.previewActivation),
        texto: cabecalho.innerText.replace(/\s+/g, " "),
        nome: cabecalho.parentElement?.querySelector("h4")?.innerText ?? "",
      };
    })(),
    efeitoNoDestaque: document.querySelector("[data-spotlight-effect]")?.innerText ?? null,
    textoNoDestaque: document.querySelector("[data-spotlight-text]")?.innerText ?? null,
    aviso: (() => {
      const el = document.querySelector('[data-effect-notice]');
      return el ? { code: Number(el.dataset.effectNotice), link: Number(el.dataset.effectLink), token: el.dataset.effectToken, duration: el.style.getPropertyValue('--md-spot-ms') } : null;
    })(),
    avisos: document.querySelectorAll('[data-effect-notice]').length,
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
        JSON.stringify({ id: "harnesschain01", name: "Testador" }),
      )});
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
       localStorage.setItem("yugioh-goat-duel-prefs-v1", JSON.stringify({ speed: ${JSON.stringify(SPEED)} }));
       localStorage.setItem("yugioh-goat-tips-v1", JSON.stringify({ off: true, seen: [] }));
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);

    // Espera o Reforço ficar clicável na minha mão (Main Phase 1).
    const acharReforco = `
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')]
        .find((el) => /Refor|Reinforcement/.test(el.querySelector("img")?.alt ?? ""));
      return slot && slot.querySelector(".tf-slot-active") ? slot.dataset.zone : null;
    `;
    let zona = null;
    for (let i = 0; i < 120 && !zona; i += 1) {
      zona = await page.evaluate(acharReforco).catch(() => null);
      if (!zona) await espera(500);
    }
    conferir(Boolean(zona), "o Reforço do Exército está clicável na mão");
    if (!zona) return;

    await page.evaluate(`document.querySelector('[data-zone="${zona}"] [role="button"]').click(); return true;`);
    await espera(250);
    conferir(await page.clickAction("Ativar"), "ativei o Reforço pelo menu da carta");
    // Em MR5 a Magia da mão pergunta em que zona entra: a primeira serve
    // (espera ela acender como escolhível, em vez de um tempo fixo).
    for (let i = 0; i < 25; i += 1) {
      if (await page.evaluate(`return Boolean(document.querySelector('[data-zone="0:8:0"] .tf-slot-place'));`)) break;
      await espera(200);
    }
    await page.evaluate(`document.querySelector('[data-zone="0:8:0"] [role="button"]')?.click(); return true;`);

    // Acompanha a tela: destaques, pilha e respostas ("Não responder").
    const vistos = {
      destaques: new Map(),
      pilhaMax: 0,
      estados: new Map(),
      fotos: new Set(),
      leituras: new Map(),
      textosNoDestaque: new Map(),
      tempos: new Map(),
    };
    const fim = Date.now() + 60_000;
    let estado = null;
    while (Date.now() < fim) {
      estado = await page.evaluate(LER);
      if (estado.leitura && !vistos.leituras.has(estado.leitura.elo)) {
        vistos.leituras.set(estado.leitura.elo, estado.leitura);
      }
      if (estado.aviso && estado.textoNoDestaque) {
        vistos.textosNoDestaque.set(estado.aviso.link, {
          efeito: estado.efeitoNoDestaque,
          texto: estado.textoNoDestaque,
        });
        const tempo = vistos.tempos.get(estado.aviso.link) ?? { inicio: Date.now(), fim: Date.now() };
        tempo.fim = Date.now();
        vistos.tempos.set(estado.aviso.link, tempo);
      }
      if (estado.avisos > 1) vistos.avisosSobrepostos = true;
      if (estado.aviso?.link === 2 && !estado.pilha && vistos.destaques.has("negated:1")) vistos.avancouComAviso = true;
      if (estado.destaque) {
        const chave = `${estado.destaque.tipo}:${estado.destaque.elo}`;
        if (!vistos.destaques.has(chave)) {
          vistos.destaques.set(chave, estado.destaque.texto);
          // A foto espera o destaque terminar de entrar (14% da duração).
          if (SPEED === "normal") {
            await espera(250);
            const { data } = await page.screenshot();
            writeFileSync(join(OUT, `corrente-${estado.destaque.tipo}-${estado.destaque.elo}.png`), Buffer.from(data, "base64"));
          }
        }
      }
      if (estado.pilha) {
        vistos.pilhaMax = Math.max(vistos.pilhaMax, estado.pilha.length);
        for (const linha of estado.pilha) {
          const lista = vistos.estados.get(linha.elo) ?? new Set();
          lista.add(linha.estado);
          vistos.estados.set(linha.elo, lista);
        }
        if (SPEED === "normal" && estado.pilha.length === 2 && !vistos.fotos.has("pilha")) {
          vistos.fotos.add("pilha");
          const { data } = await page.screenshot();
          writeFileSync(join(OUT, "corrente-pilha.png"), Buffer.from(data, "base64"));
        }
      }
      if (SPEED === "normal" && estado.aviso && !estado.destaque && !estado.pilha && !vistos.fotos.has("sem-pausa")) {
        vistos.fotos.add("sem-pausa");
        writeFileSync(join(OUT, "corrente-efeito-sem-pausa.png"), Buffer.from((await page.screenshot()).data, "base64"));
      }
      // A corrente me pergunta se respondo: não.
      if (estado.botoes.includes("Não responder")) await page.clickAction("Não responder");
      if (vistos.tempos.has(2) && vistos.destaques.has("negated:1") && !estado.pilha && !estado.aviso) break;
      await espera(SPEED === "normal" ? 90 : 35);
    }

    const ativou1 = vistos.destaques.get("activate:1") ?? "";
    const ativou2 = vistos.destaques.get("activate:2") ?? "";
    const negou1 = vistos.destaques.get("negated:1") ?? "";
    const primeiro = vistos.tempos.get(1);
    const ultimo = vistos.tempos.get(2);
    conferir(primeiro && ultimo && ultimo.inicio - primeiro.inicio < 2000,
      "#6: a próxima ativação avança sem esperar os quatro segundos", JSON.stringify([primeiro, ultimo]));
    conferir(!vistos.avisosSobrepostos, "#6: o efeito novo substitui a caixa anterior");
    conferir(ultimo && ultimo.fim - ultimo.inicio >= 3700 && ultimo.fim - ultimo.inicio < 5000,
      "#6: a caixa mais recente recebe seus próprios quatro segundos", JSON.stringify(ultimo));
    conferir(vistos.avancouComAviso, "#6: a corrente termina enquanto a caixa ainda está visível");
    conferir(!estado?.aviso, "#6: a caixa sai automaticamente quando termina o tempo");
    // `innerText` devolve o texto como a tela mostra (os rótulos em
    // maiúsculas), e o nome vem no idioma do jogador — daí o `i` e as duas
    // grafias.
    const ASH = /Ash Blossom|Florescer de Cinzas/i;
    conferir(/Você ativou/i.test(ativou1) && /Refor|Reinforcement/i.test(ativou1), "destaque do elo 1: eu ativei o Reforço", ativou1);
    conferir(
      /Oponente ativou/i.test(ativou2) && ASH.test(ativou2) && /da mão/i.test(ativou2),
      "destaque do elo 2: o oponente ativou a Ash Blossom, da mão",
      ativou2,
    );
    // O carimbo segue as faixas do MD, em inglês estilizado ("NEGATED"); o
    // rótulo de cima continua em português.
    conferir(/Efeito negado .*\bNEGATED\b/i.test(negou1), "o elo 1 volta em destaque com EFEITO NEGADO e o carimbo", negou1);

    // O que a carta faz, sem depender do "deseja responder?": o destaque
    // traz o texto, e a leitura da esquerda vai para cada carta ativada.
    const destaque1 = vistos.textosNoDestaque.get(1);
    const destaque2 = vistos.textosNoDestaque.get(2);
    console.log(`  · efeito no destaque: elo 1 = ${destaque1?.efeito ?? "—"} | elo 2 = ${destaque2?.efeito ?? "—"}`);
    conferir(Boolean(destaque1?.texto && destaque2?.texto), "o destaque de cada elo mostra o texto da carta", JSON.stringify([destaque1, destaque2]));
    const leitura1 = vistos.leituras.get(1);
    const leitura2 = vistos.leituras.get(2);
    conferir(
      /Elo 1 — Você ativou/i.test(leitura1?.texto ?? "") && /Refor|Reinforcement/i.test(leitura1?.nome ?? ""),
      "a leitura da esquerda foi para o Reforço com \"Elo 1 — Você ativou\"",
      JSON.stringify(leitura1),
    );
    conferir(
      /Elo 2 — Oponente ativou da mão/i.test(leitura2?.texto ?? "") && ASH.test(leitura2?.nome ?? ""),
      "e depois para a Ash, \"Elo 2 — Oponente ativou da mão\"",
      JSON.stringify(leitura2),
    );
    const leituraFinal = estado?.leitura;
    conferir(
      leituraFinal?.elo === 2 && ASH.test(leituraFinal?.nome ?? ""),
      "terminada a corrente, a Ash continua na leitura (dá tempo de ler)",
      JSON.stringify(leituraFinal),
    );
    conferir(vistos.pilhaMax === 2, "a pilha da corrente mostrou os dois elos", String(vistos.pilhaMax));
    conferir(vistos.estados.get(2)?.has("resolving") ?? false, "o elo 2 apareceu resolvendo", [...(vistos.estados.get(2) ?? [])].join(","));
    conferir(vistos.estados.get(1)?.has("disabled") ?? false, "o elo 1 ficou marcado como efeito negado", [...(vistos.estados.get(1) ?? [])].join(","));
    const log = estado?.log ?? "";
    const historico = log.replace(/\s+/g, " ");
    conferir(
      new RegExp(`Elo 2 — O oponente ativou (${ASH.source}).*\\(da mão\\)`, "i").test(historico),
      "o histórico diz que a Ash veio da mão",
      historico.slice(-300),
    );
    conferir(/Elo 1 — efeito de .* negado/.test(historico), "o histórico diz que o efeito do elo 1 foi negado", historico.slice(-300));

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
    console.log(`\nCorrente pela tela: tudo certo. Fotos em ${OUT}`);
  }
}

await main();
