/**
 * A biblioteca de decks segue o DONO, não o navegador.
 *
 * O id do perfil passou a sair do apelido, e o motivo é prático: `localhost:3000`
 * e `localhost:3100` são origens diferentes, cada uma com o seu `localStorage`.
 * Com id aleatório por navegador, trocar de porta dava uma coleção vazia e os
 * decks ficavam vivos num arquivo de nome ilegível — foi exatamente o que
 * aconteceu na prática.
 *
 * O que este teste protege é a parte que não dá para "consertar depois": a
 * adoção move arquivos. Um erro aqui não mostra deck a menos na tela, ele
 * **apaga** a coleção de alguém. Então cada degrau da busca é exercitado com
 * arquivo de verdade num diretório temporário, e o fim de cada cenário confere
 * o que ficou no disco.
 *
 * Uso: npm run test:deck-library
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ANTES de importar o store: ele lê `DECKS_DIR` na carga do módulo, e a ideia é
// justamente não tocar na pasta de verdade.
const DIR = mkdtempSync(join(tmpdir(), "ygo-decks-"));
process.env.DECKS_DIR = DIR;

const { putDeck, resolveDecks, deleteDeck } = await import("@/server/decks/store");
const { profileIdFromName } = await import("@/lib/domain/profile");

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Um deck mínimo, mas com o formato que a API aceita. */
function deck(id, nome, quando = "2026-01-01T00:00:00.000Z") {
  return {
    id,
    name: nome,
    format: "goat",
    main: [{ passcode: 5053103, quantity: 3 }],
    extra: [],
    side: [],
    updatedAt: quando,
  };
}

const arquivos = () => readdirSync(DIR).filter((nome) => nome.endsWith(".json")).sort();
const lerNome = (id) =>
  JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8")).profile.name;

console.log("\nO apelido é a identidade");
{
  conferir(profileIdFromName("Straub") === "straub", "vira minúscula");
  conferir(profileIdFromName("STRAUB") === "straub", "e ignora a caixa toda");
  conferir(profileIdFromName("José Válido") === "jose-valido", "sem acento e sem espaço");
  conferir(profileIdFromName("Gu") === "gu-goat", "nome curto ainda vira id válido");
  conferir(profileIdFromName("!!!") === "duelista-goat", "e nome sem letra também");
}

console.log("\nColeção antiga, sob id aleatório");
{
  // Como era antes: id aleatório do navegador, apelido dentro do arquivo.
  await putDeck("a1b2c3d4e5f6a7b8", "Straub", deck("d1", "Chaos Control"));
  conferir(arquivos().length === 1, "a coleção antiga está no disco");

  // Outra porta, outro navegador: id novo, derivado do nome.
  const decks = await resolveDecks("straub", "Straub");
  conferir(
    decks.length === 1 && decks[0].name === "Chaos Control",
    "o servidor reconhece a coleção pelo apelido",
    JSON.stringify(decks),
  );
  conferir(
    arquivos().join() === "straub.json",
    "e MOVE o arquivo para o id legível (o antigo sai)",
    arquivos().join(),
  );
}

console.log("\nMesmo apelido, outra caixa");
{
  const decks = await resolveDecks("straub", "STRAUB");
  conferir(decks.length === 1, "continua sendo a mesma coleção");
  conferir(lerNome("straub") === "STRAUB", "o arquivo guarda o nome como foi digitado");
  conferir(arquivos().join() === "straub.json", "sem duplicar arquivo");
}

console.log("\nTrocou de apelido");
{
  const decks = await resolveDecks("gustavo", "Gustavo", "straub");
  conferir(
    decks.length === 1 && decks[0].name === "Chaos Control",
    "os decks vão com ele",
  );
  conferir(
    arquivos().join() === "gustavo.json",
    "e a coleção não fica órfã no id velho",
    arquivos().join(),
  );
}

console.log("\nApelido que ninguém usou");
{
  const decks = await resolveDecks("ninguem", "Ninguém");
  conferir(decks.length === 0, "começa vazia");
  conferir(
    arquivos().join() === "gustavo.json",
    "e não encosta na coleção de outra pessoa",
    arquivos().join(),
  );
}

console.log("\nA mesma pessoa espalhada em vários arquivos");
{
  // O caso real: três "Straub" em portas diferentes, um deles com o único deck
  // de Exodia. Escolher a "melhor" coleção deixaria as outras órfãs.
  await putDeck("velho1111", "Duplo", deck("x1", "Exodia"));
  await putDeck("velho2222", "duplo", deck("y1", "Goat Control", "2026-02-01T00:00:00.000Z"));
  await putDeck("velho2222", "DUPLO", deck("y2", "Chaos", "2026-02-02T00:00:00.000Z"));

  const decks = await resolveDecks("duplo", "Duplo");
  const nomes = decks.map((d) => d.name).sort();
  conferir(
    decks.length === 3 && nomes.join() === "Chaos,Exodia,Goat Control",
    "as coleções são JUNTADAS, não escolhidas",
    JSON.stringify(nomes),
  );
  conferir(
    arquivos().join() === "duplo.json,gustavo.json",
    "só o arquivo novo sobra na varredura",
    arquivos().join(),
  );
  const bak = readdirSync(DIR).filter((n) => n.endsWith(".absorvido.bak"));
  conferir(
    bak.includes("velho1111.json.absorvido.bak") &&
      bak.includes("velho2222.json.absorvido.bak"),
    "e os originais ficam como .bak, para dar para desfazer à mão",
    bak.join(),
  );
}

console.log("\nApagar deck continua funcionando");
{
  const decks = await deleteDeck("gustavo", "d1");
  conferir(decks.length === 0, "o deck sai da biblioteca");
}

console.log("");
console.log(`(pasta do teste: ${DIR})`);
if (falhas.length > 0) {
  console.log(`${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("Biblioteca de decks: tudo certo.");
process.exit(0);
