/**
 * Gera os hologramas dos monstros — o monstro recortado da arte, em fatias de
 * profundidade — para `.cache/card-images/holo/` (ver `holograms.ts`).
 *
 * Dois modelos de IA, ambos Apache-2.0, rodando no processador com o
 * `onnxruntime-node`:
 *
 * - **Recorte** — ISNet-anime (`skytnt/anime-segmentation`): treinado em
 *   ilustração no estilo anime, que é o que a arte do Yu-Gi-Oh é. Um modelo de
 *   recorte "geral" (feito para fotos) confunde muito mais o fundo pintado com
 *   o monstro. Medido nos 58 monstros dos Baralhos Iniciais de Yugi e Kaiba:
 *   ~45 limpos, ~8 com restos do fundo, 5 que não separaram nada.
 * - **Profundidade** — Depth Anything V2 Small: um "chute" de quão perto está
 *   cada ponto (claro = perto). É ele que vira as fatias.
 *
 * A entrada do ISNet-anime é a imagem em [0, 1] **sem** subtrair a média: com
 * a normalização ImageNet (a do rembg para o modelo geral) a máscara saía
 * quase toda cinza — o Giant Soldier of Stone dava 4% de certeza no máximo.
 *
 * Os modelos (~270 MB) são baixados para `.cache/models/` na primeira vez, de
 * endereços fixos, e conferidos por SHA-256.
 *
 * Uso:
 *   npm run build:holograms                      # monstros dos Baralhos Iniciais de Yugi e Kaiba
 *   npm run build:holograms -- starter-joey      # monstros de outro deck pronto (id)
 *   npm run build:holograms -- 46986414 89631139 # passcodes
 *   npm run build:holograms -- --all             # todo monstro com dado oficial (~9.800, ~2 h)
 *   npm run build:holograms -- --force           # refaz os que já existem
 *   npm run build:holograms -- --cpu             # sem o CoreML (Mac), só o processador
 *   npm run build:holograms -- --all --reverse   # a mesma fila, de trás para frente
 *   npm run build:holograms -- --all --middle    # a mesma fila, a partir do meio
 *   npm run build:holograms -- --gpu             # os dois modelos na GPU (WebGPU)
 *
 * Um processo usa ~5 dos núcleos; para ir mais rápido, rode vários ao mesmo
 * tempo — `--all`, `--all --reverse` e `--all --middle --gpu` — e eles se
 * encontram: cada um pula a carta que outro já fez, e o índice é somado a
 * cada gravação (nenhum apaga o do outro).
 *
 * Com `--all` vão primeiro os monstros dos decks prontos (Goat, depois TCG) —
 * os que aparecem logo numa partida —, depois o resto. O índice é gravado a
 * cada 50 cartas: a mesa já mostra o que ficou pronto (na partida seguinte),
 * e interromper não perde nada — rodar de novo pula o que existe.
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import ort from "onnxruntime-node";
import sharp from "sharp";

import { cardImage } from "@/server/catalog/card-images";
import {
  HOLOGRAM_INDEX_PATH,
  HOLOGRAMS_DIR,
  hologramDepthPath,
  hologramPath,
  readHologramIndex,
} from "@/server/catalog/holograms";

// `fileURLToPath`, não `.pathname`: no Windows o `.pathname` dá "/C:/…" (um
// caminho que não existe), e em qualquer sistema troca espaço por "%20".
const REPO = fileURLToPath(new URL("..", import.meta.url));
const MODELS_DIR = join(REPO, ".cache/models");

/** Endereços fixos (commit/release) e o SHA-256 de cada modelo. */
const MODELS = {
  segment: {
    file: "isnet-anime.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx",
    sha256: "f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99",
  },
  depth: {
    file: "depth-anything-v2-small.onnx",
    url: "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx",
    sha256: "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
  },
};

/**
 * Seis fatias de 320 px. Na mesa o holograma tem ~120 px (1,2 × a largura da
 * carta) — 240 pixels de verdade numa tela retina. Mais fatias suavizam os
 * degraus entre elas, mas cada uma é uma camada a mais para o navegador
 * compor, vezes dez monstros em campo. Com 384 px eram ~150 KB por monstro;
 * vezes ~9.800 monstros, o tamanho importa.
 */
const LAYERS = 6;
const SIZE = 320;

const DEFAULT_DECKS = ["starter-yugi", "starter-kaiba"];

// ---------------------------------------------------------------------------
// Quais cartas.

const args = process.argv.slice(2);
const force = args.includes("--force");
const all = args.includes("--all");
const reverse = args.includes("--reverse");
const middle = args.includes("--middle");
const gpu = args.includes("--gpu");
const pedidos = args.filter((a) => !a.startsWith("--"));

const cardDb = JSON.parse(readFileSync(join(REPO, "src/data/card-db.json"), "utf8"));
const isMonster = (code) => Boolean(cardDb[code] && cardDb[code][0] & 0x1);

const presets = [
  ...JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8")),
  ...JSON.parse(readFileSync(join(REPO, "src/data/preset-decks-tcg.json"), "utf8")),
];

const codes = new Set();
for (const pedido of pedidos.length || all ? pedidos : DEFAULT_DECKS) {
  if (/^\d+$/.test(pedido)) {
    codes.add(Number(pedido));
    continue;
  }
  const deck = presets.find((d) => d.id === pedido);
  if (!deck) {
    console.error(`Deck pronto "${pedido}" não existe (ids em src/data/preset-decks*.json).`);
    process.exit(1);
  }
  for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
    if (isMonster(Number(code))) codes.add(Number(code));
  }
}

if (all) {
  // Os dos decks prontos primeiro (a ordem do Set é a de inserção).
  for (const deck of presets) {
    for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
      if (isMonster(Number(code))) codes.add(Number(code));
    }
  }
  for (const code of Object.keys(cardDb)) if (isMonster(code)) codes.add(Number(code));
}

// ---------------------------------------------------------------------------
// Modelos.

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function ensureModel({ file, url, sha256: esperado }) {
  const path = join(MODELS_DIR, file);
  if (existsSync(path)) return path;
  mkdirSync(MODELS_DIR, { recursive: true });
  console.log(`Baixando ${file}…`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url} respondeu ${response.status}`);
  const parcial = `${path}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(parcial));
  const obtido = await sha256(parcial);
  if (obtido !== esperado) throw new Error(`${file}: SHA-256 ${obtido}, esperava ${esperado}`);
  renameSync(parcial, path);
  return path;
}

/**
 * O recorte roda no CoreML no Mac (GPU/Neural Engine): ~0,2 s por arte contra
 * ~0,45 s no processador — e é a parte mais pesada (1024²). A máscara sai
 * igual: medido em 4 artes, diferença máxima de 2% na transparência e IoU de
 * 0,991 a 0,9998 com a do processador. A profundidade fica no processador: no
 * CoreML ela ficou MAIS lenta (~1 s), mesmo com o tamanho de entrada fixo — o
 * grafo dela cai em pedaços entre CoreML e processador.
 */
const usarCoreML = process.platform === "darwin" && !args.includes("--cpu");
async function sessaoDeRecorte(path) {
  if (usarCoreML) {
    try {
      return await ort.InferenceSession.create(path, { executionProviders: ["coreml", "cpu"] });
    } catch (error) {
      console.warn(`CoreML indisponível (${error instanceof Error ? error.message : error}); recorte no processador.`);
    }
  }
  return ort.InferenceSession.create(path);
}
/**
 * `--gpu`: os dois modelos no WebGPU (Metal no Mac), que o onnxruntime-node
 * traz embutido. Medido com duas gerações rodando: profundidade em ~70 ms
 * (contra ~300 ms no processador) e recorte em ~160 ms (contra ~200 ms no
 * CoreML), com saída idêntica à do processador em 3 artes (diferença zero na
 * quarta casa). Não é o padrão porque só foi medido nesta máquina; se o
 * WebGPU não abrir, cai no caminho de sempre.
 */
async function sessaoNaGpu(path, padrao) {
  try {
    return await ort.InferenceSession.create(path, { executionProviders: ["webgpu"] });
  } catch (error) {
    console.warn(`WebGPU indisponível (${error instanceof Error ? error.message : error}).`);
    return padrao(path);
  }
}
const segment = gpu
  ? await sessaoNaGpu(await ensureModel(MODELS.segment), sessaoDeRecorte)
  : await sessaoDeRecorte(await ensureModel(MODELS.segment));
const depth = gpu
  ? await sessaoNaGpu(await ensureModel(MODELS.depth), (path) => ort.InferenceSession.create(path))
  : await ort.InferenceSession.create(await ensureModel(MODELS.depth));

// ---------------------------------------------------------------------------
// Uma carta.

/** A arte em NCHW float32, no tamanho que o modelo quer. */
async function tensor(art, side, mean, std) {
  const rgb = await sharp(art).removeAlpha().resize(side, side, { kernel: "lanczos3" }).raw().toBuffer();
  const plano = side * side;
  const out = new Float32Array(3 * plano);
  for (let i = 0; i < plano; i++) {
    for (let c = 0; c < 3; c++) out[c * plano + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c];
  }
  return new ort.Tensor("float32", out, [1, 3, side, side]);
}

/**
 * Um canal (bytes) de `side`×`side` redimensionado para SIZE×SIZE.
 *
 * O `extractChannel(0)` não é enfeite: o sharp devolve um canal único como
 * **três** canais depois do `resize`, e ler isso como um canal embaralha a
 * máscara inteira.
 */
async function canal(bytes, side) {
  return sharp(Buffer.from(bytes), { raw: { width: side, height: side, channels: 1 } })
    .resize(SIZE, SIZE, { kernel: "lanczos3" })
    .extractChannel(0)
    .raw()
    .toBuffer();
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function hologramFor(art) {
  // Os dois modelos ao mesmo tempo: o recorte no CoreML e a profundidade no
  // processador não disputam o mesmo hardware.
  //
  // Recorte: 1024², [0, 1] sem média (ver o cabeçalho). A saída já é 0–1.
  // Profundidade: 518² (múltiplo de 14, o passo do modelo), normalização
  // ImageNet. A saída é relativa — normalizada aqui para 0–255.
  const [seg, dep] = await Promise.all([
    tensor(art, 1024, [0, 0, 0], [1, 1, 1]).then((t) => segment.run({ [segment.inputNames[0]]: t })),
    tensor(art, 518, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]).then((t) =>
      depth.run({ [depth.inputNames[0]]: t }),
    ),
  ]);
  const mask = await canal(
    Uint8Array.from(seg[segment.outputNames[0]].data, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)),
    1024,
  );

  const bruto = dep[depth.outputNames[0]].data;
  let mi = Infinity;
  let ma = -Infinity;
  for (const v of bruto) {
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const profundidade = await canal(
    Uint8Array.from(bruto, (v) => Math.round(((v - mi) / (ma - mi || 1)) * 255)),
    518,
  );

  // O recorte deu certo? `cover` é quanto da arte sobrou; `unsure`, quanto
  // ficou meio-transparente (o modelo em dúvida). Sobrou quase tudo — ou
  // muito, e cheio de dúvida — é o fundo que ficou junto: os 5 que falharam
  // nos Baralhos Iniciais tinham 0,81–0,96 (com dúvida ≥ 0,27 abaixo de 0,85),
  // e o recorte aproveitável mais "cheio" tinha 0,85 com dúvida 0,03.
  const n = SIZE * SIZE;
  let cover = 0;
  let unsure = 0;
  for (let i = 0; i < n; i++) {
    const m = mask[i] / 255;
    cover += m;
    if (m > 0.1 && m < 0.9) unsure++;
  }
  cover /= n;
  unsure /= n;
  const kind = cover > 0.85 || (cover > 0.75 && unsure > 0.15) || cover < 0.04 ? "projection" : "cutout";

  // A forma: a máscara, ou um oval esfumado na projeção. As duas somem perto
  // da moldura — o monstro cortado pela borda da arte não pode terminar numa
  // linha reta no ar.
  const forma = new Float32Array(n);
  const borda = SIZE * 0.07;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const perto = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      let a;
      if (kind === "cutout") {
        a = mask[i] / 255;
      } else {
        const r = Math.hypot((x - SIZE / 2) / (SIZE / 2), (y - SIZE / 2) / (SIZE / 2));
        a = 1 - smoothstep(0.55, 0.98, r);
      }
      forma[i] = a * smoothstep(0, borda, perto);
    }
  }

  // A profundidade esticada para 0–1 só dentro do monstro (percentis 5 e 95):
  // o fundo apagado não pode gastar a escala.
  const dentro = [];
  for (let i = 0; i < n; i++) if (forma[i] > 0.5) dentro.push(profundidade[i]);
  dentro.sort((a, b) => a - b);
  const p5 = dentro.length ? dentro[Math.floor(dentro.length * 0.05)] : 0;
  const p95 = dentro.length ? dentro[Math.floor(dentro.length * 0.95)] : 255;

  // As fatias. A de trás é o monstro inteiro; cada uma à frente guarda só o
  // que está mais perto que o seu limiar. Empilhadas assim não abrem buraco
  // quando o holograma gira — atrás de cada degrau sempre há a fatia anterior.
  const rgb = await sharp(art).removeAlpha().resize(SIZE, SIZE, { kernel: "lanczos3" }).raw().toBuffer();
  const sprite = Buffer.alloc(SIZE * SIZE * LAYERS * 4);
  for (let k = 0; k < LAYERS; k++) {
    const limiar = k / LAYERS;
    for (let i = 0; i < n; i++) {
      const d = Math.min(1, Math.max(0, (profundidade[i] - p5) / (p95 - p5 || 1)));
      const a = forma[i] * (k === 0 ? 1 : smoothstep(limiar - 0.06, limiar + 0.06, d));
      const o = (k * n + i) * 4;
      sprite[o] = rgb[i * 3];
      sprite[o + 1] = rgb[i * 3 + 1];
      sprite[o + 2] = rgb[i * 3 + 2];
      sprite[o + 3] = Math.round(a * 255);
    }
  }
  const webp = await sharp(sprite, { raw: { width: SIZE, height: SIZE * LAYERS, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 90, effort: 5 })
    .toBuffer();
  // O mapa de profundidade também, já esticado para 0–255 dentro do monstro:
  // as fatias são uma aproximação em degraus dele, e um desenho contínuo (cada
  // ponto deslocado pela própria profundidade, sem fatias) só precisa dele —
  // guardá-lo agora evita refazer os ~9.800 monstros para tentar isso.
  const mapa = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    mapa[i] = Math.round(Math.min(1, Math.max(0, (profundidade[i] - p5) / (p95 - p5 || 1))) * 255);
  }
  const depthWebp = await sharp(mapa, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .webp({ quality: 90 })
    .toBuffer();
  return { kind, cover: Math.round(cover * 1000) / 1000, webp, depthWebp };
}

// ---------------------------------------------------------------------------
// Todas.

mkdirSync(HOLOGRAMS_DIR, { recursive: true });
const anterior = readHologramIndex();
const index = {
  version: 1,
  layers: LAYERS,
  size: SIZE,
  // A versão das URLs das imagens: muda quando as fatias mudam (do zero ou
  // `--force`), não a cada rodada — dois processos juntos ficariam trocando a
  // versão um do outro, e o navegador baixaria tudo de novo a cada partida.
  generatedAt:
    anterior && anterior.layers === LAYERS && anterior.size === SIZE && !force
      ? anterior.generatedAt
      : new Date().toISOString(),
  // Fatias de outro tamanho não servem: começa do zero.
  cards: anterior && anterior.layers === LAYERS && anterior.size === SIZE ? anterior.cards : {},
};

const fila = [...codes].filter(
  (code) =>
    force || !index.cards[code] || !existsSync(hologramPath(code)) || !existsSync(hologramDepthPath(code)),
);
if (reverse) fila.reverse();
// Do meio para a frente, e depois o começo: um terceiro processo que não
// esbarra nos de `--all` (início) e `--reverse` (fim) até o fim do trabalho.
if (middle) fila.push(...fila.splice(0, Math.floor(fila.length / 2)));
const pulados = codes.size - fila.length;

/**
 * Grava o índice somando o que está no disco: outro processo (`--reverse`)
 * pode ter gravado entradas que este não conhece. Arquivo temporário e
 * `rename`, para a mesa nunca ler um índice pela metade. Se as duas gravações
 * se cruzarem, a próxima de cada um devolve o que faltou — e a última de
 * todas soma as duas.
 */
const gravarIndice = () => {
  const disco = readHologramIndex();
  if (disco && disco.layers === LAYERS && disco.size === SIZE) {
    index.cards = { ...disco.cards, ...index.cards };
  }
  const temporario = `${HOLOGRAM_INDEX_PATH}.${process.pid}.tmp`;
  writeFileSync(temporario, JSON.stringify(index, null, 1));
  // No Windows o `rename` por cima de um arquivo aberto (o servidor lendo o
  // índice, o antivírus olhando) falha com EPERM por um instante: tenta de
  // novo, e na última vez grava direto.
  for (let tentativa = 0; ; tentativa++) {
    try {
      renameSync(temporario, HOLOGRAM_INDEX_PATH);
      return;
    } catch (error) {
      if (tentativa >= 4) {
        writeFileSync(HOLOGRAM_INDEX_PATH, JSON.stringify(index, null, 1));
        rmSync(temporario, { force: true });
        return;
      }
      if (error?.code !== "EPERM" && error?.code !== "EBUSY" && error?.code !== "EACCES") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
};
console.log(`${fila.length} para gerar, ${pulados} já existiam.`);

// As artes vêm da YGOPRODeck na fila de ~14/s de `cardImage`: pedir as
// próximas enquanto o modelo trabalha na atual esconde a espera da rede.
// Poucas: a fila é por processo, e com dois processos juntos uma rajada de
// 2 × 8 pedidos chegava perto do teto de 20/s da YGOPRODeck (passar dele é
// uma hora de bloqueio). O ritmo de verdade é o dos modelos, ~5 cartas/s.
const ADIANTE = 4;
const artes = new Map();
const pedirArte = (i) => {
  const code = fila[i];
  if (code !== undefined && !artes.has(code)) artes.set(code, cardImage("cropped", code).catch(() => null));
};

/**
 * Duas cartas por vez: enquanto uma está nos modelos, a outra monta as fatias
 * e codifica o WebP (JavaScript e sharp) — sem isso, a cada carta o
 * hardware dos modelos ficava parado esperando.
 */
const TRABALHADORES = 2;
let proxima = 0;
let concluidas = 0;
let feitos = 0;
let outro = 0;
const semArte = [];
const falhas = [];
const inicio = Date.now();
const feitaPorOutro = (code) => {
  const profundidade = hologramDepthPath(code);
  return (
    existsSync(hologramPath(code)) &&
    existsSync(profundidade) &&
    statSync(profundidade).mtimeMs >= inicio
  );
};

async function trabalhador() {
  while (proxima < fila.length) {
    const i = proxima++;
    for (let j = i; j <= i + ADIANTE; j++) pedirArte(j);
    const code = fila[i];
    // O outro processo (`--reverse`) já fez esta? Os dois arquivos existem e
    // são desta rodada: pula. (A entrada dele no índice vem na soma.)
    if (!force && feitaPorOutro(code)) {
      artes.delete(code);
      outro++;
      concluidas++;
      continue;
    }
    const art = await artes.get(code);
    artes.delete(code);
    if (!art) {
      semArte.push(code);
    } else {
      try {
        const comeco = Date.now();
        const { kind, cover, webp, depthWebp } = await hologramFor(art);
        writeFileSync(hologramPath(code), webp);
        writeFileSync(hologramDepthPath(code), depthWebp);
        index.cards[code] = { kind, cover };
        feitos++;
        if (fila.length <= 100) {
          console.log(`${code}  ${kind.padEnd(10)} cobre ${cover.toFixed(2)}  ${(webp.length / 1024).toFixed(0)} KB  ${Date.now() - comeco} ms`);
        }
      } catch (error) {
        // Uma arte corrompida não derruba as outras 9.000.
        falhas.push(code);
        console.error(`${code}: ${error instanceof Error ? error.message : error}`);
      }
    }
    concluidas++;
    if (concluidas % 50 === 0) {
      gravarIndice();
      const porCarta = (Date.now() - inicio) / concluidas;
      const resta = Math.round(((fila.length - concluidas) * porCarta) / 60000);
      console.log(`${concluidas}/${fila.length}  (${feitos} gerados${outro ? `, ${outro} pelo outro processo` : ""})  ~${resta} min restantes`);
    }
  }
}

await Promise.all(Array.from({ length: TRABALHADORES }, trabalhador));

gravarIndice();
const projecoes = Object.values(index.cards).filter((c) => c.kind === "projection").length;
console.log(
  `\n${feitos} gerados, ${pulados} já existiam` +
    (semArte.length ? `, ${semArte.length} sem arte na YGOPRODeck (${semArte.slice(0, 40).join(", ")}${semArte.length > 40 ? "…" : ""})` : "") +
    (falhas.length ? `, ${falhas.length} com erro (${falhas.join(", ")})` : "") +
    `. No índice: ${Object.keys(index.cards).length} (${projecoes} como projeção).`,
);
