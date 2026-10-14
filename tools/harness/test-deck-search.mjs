/**
 * A busca dos seletores de deck (`src/lib/domain/deck-search.ts`): "contém",
 * sem acento e sem caixa, palavra por palavra — e o trecho achado destacado
 * certo, inclusive em letra acentuada.
 *
 * Roda nas funções puras que a tela usa, e também contra a lista de decks
 * prontos de verdade: buscar "kaiba" tem de achar o deck do Kaiba, por mais
 * que os ~100 decks TCG cresçam em volta.
 *
 * Uso: npm run test:deck-search
 */
const { casaComBusca, filtrarGrupos, normalizar, termosDaBusca, trechosDestacados } = await import(
  "@/lib/domain/deck-search"
);
const { PRESET_DECKS } = await import("@/lib/data/preset-decks-catalog");
const { kindGroupLabel } = await import("@/lib/domain/preset-decks");

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

console.log("Normalização e casamento");
conferir(normalizar("Dragão Branco de Olhos Azuis") === "dragao branco de olhos azuis", "tira acento e caixa");
conferir(casaComBusca("Dragão Branco de Olhos Azuis", termosDaBusca("dragao")), "'dragao' acha 'Dragão'");
conferir(casaComBusca("Blue-Eyes Structure Deck", termosDaBusca("EYES")), "'EYES' acha 'Blue-Eyes' (no meio, sem caixa)");
conferir(casaComBusca("Baralho Inicial: Kaiba", termosDaBusca("kaiba inicial")), "'kaiba inicial' acha 'Baralho Inicial: Kaiba' (outra ordem)");
conferir(!casaComBusca("Baralho Inicial: Kaiba", termosDaBusca("kaiba yugi")), "'kaiba yugi' não acha (falta uma palavra)");
conferir(casaComBusca("qualquer", termosDaBusca("   ")), "busca vazia (só espaços) acha tudo");

console.log("Grupos");
const grupos = [
  { label: "Meus decks", opcoes: [{ value: "a", label: "Meu Deck Goat (40 cartas)" }] },
  {
    label: "Goat · Decks Iniciais",
    opcoes: [
      { value: "starter-yugi", label: "Baralho Inicial: Yugi (50 cartas)" },
      { value: "starter-kaiba", label: "Baralho Inicial: Kaiba (50 cartas)" },
    ],
  },
  { label: "TCG · Estruturais", opcoes: [{ value: "sd-blue", label: "Olhos Azuis (40 cartas)" }] },
];
conferir(filtrarGrupos(grupos, "") === grupos, "sem busca, a lista inteira (a mesma)");
const kaiba = filtrarGrupos(grupos, "kaiba");
conferir(
  kaiba.length === 1 && kaiba[0].opcoes.length === 1 && kaiba[0].opcoes[0].value === "starter-kaiba",
  "'kaiba' deixa só o deck do Kaiba, e só o grupo dele",
  JSON.stringify(kaiba),
);
const tcg = filtrarGrupos(grupos, "tcg");
conferir(tcg.length === 1 && tcg[0].label === "TCG · Estruturais", "'tcg' casa com o NOME do grupo e traz o grupo inteiro");
conferir(filtrarGrupos(grupos, "xyzzy").length === 0, "sem nada que case, nenhum grupo");

console.log("Destaque do trecho achado");
const marca = (texto, busca) =>
  trechosDestacados(texto, busca)
    .map((t) => (t.achado ? `[${t.texto}]` : t.texto))
    .join("");
conferir(marca("Dragão Branco", "drag") === "[Drag]ão Branco", "'drag' marca 'Drag'", marca("Dragão Branco", "drag"));
conferir(marca("Dragão Branco", "dragao") === "[Dragão] Branco", "'dragao' marca 'Dragão' inteiro (com o til)", marca("Dragão Branco", "dragao"));
conferir(
  marca("Baralho Inicial: Kaiba", "kaiba inicial") === "Baralho [Inicial]: [Kaiba]",
  "duas palavras, dois trechos",
  marca("Baralho Inicial: Kaiba", "kaiba inicial"),
);
conferir(marca("Kaiba", "") === "Kaiba", "sem busca, nada marcado");
conferir(
  trechosDestacados("Dragão Branco", "dragao").map((t) => t.texto).join("") === "Dragão Branco",
  "os trechos remontam o texto original letra por letra",
);

console.log("Com os decks prontos de verdade");
const reais = new Map();
for (const preset of PRESET_DECKS) {
  const grupo = `${preset.format === "tcg" ? "TCG" : "Goat"} · ${kindGroupLabel(preset.kind)}`;
  const lista = reais.get(grupo) ?? [];
  lista.push({ value: preset.id, label: `${preset.namePt} (${preset.main.length} cartas)` });
  reais.set(grupo, lista);
}
const gruposReais = [...reais].map(([label, opcoes]) => ({ label, opcoes }));
const total = gruposReais.reduce((n, g) => n + g.opcoes.length, 0);
const acheiKaiba = filtrarGrupos(gruposReais, "kaiba").flatMap((g) => g.opcoes);
conferir(
  acheiKaiba.length > 0 && acheiKaiba.length < total / 4,
  `'kaiba' acha o(s) deck(s) do Kaiba e corta o resto (${acheiKaiba.length} de ${total})`,
  acheiKaiba.map((o) => o.label).join(" | "),
);
const soTcg = filtrarGrupos(gruposReais, "tcg");
conferir(
  soTcg.length > 0 && soTcg.every((g) => g.label.startsWith("TCG")),
  `'tcg' deixa só os grupos TCG (${soTcg.length} grupos)`,
);

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nBusca de decks: tudo certo.");
}
