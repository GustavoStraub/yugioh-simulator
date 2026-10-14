import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { randomId } from "@/lib/random-id";
import type { DeckList } from "@/lib/types";

/**
 * Biblioteca de decks em arquivos JSON, no disco de quem roda o servidor.
 *
 * Sem banco de dados de propósito. Um deck é um punhado de números; o que se
 * quer dele é sobreviver a uma limpeza de dados do navegador e poder ser
 * copiado, versionado e lido por um humano quando algo der errado. Um arquivo
 * JSON por perfil entrega as três coisas e não traz migração nenhuma junto.
 *
 * Fica em `.data/` (fora do controle de versão): fazer backup é copiar a
 * pasta, e apontá-la para um diretório sincronizado dá o mesmo deck em outro
 * computador sem nada além disso.
 */
/**
 * Trocável por env para apontar para uma pasta sincronizada (iCloud, Dropbox)
 * e ter os mesmos decks em outro computador sem banco nenhum.
 *
 * A partir de `process.cwd()` e não de `import.meta.url`: além de não depender
 * de quantos níveis o arquivo está do topo, é o que o Turbopack consegue
 * analisar — com um caminho que ele não resolve, ele passa a rastrear o
 * projeto inteiro para o bundle do servidor.
 *
 * Mesmo assim o `DECKS_DIR` trocável por env é dinâmico, e o `readdir` dele
 * fazia o build avisar "Dynamic filesystem access causes tracing of the whole
 * project" (visto no `npm run public`). Por isso todo acesso a esta pasta leva
 * `turbopackIgnore`: ela é dado do usuário, gravado em tempo de execução —
 * nada aqui deve ir para o pacote do servidor, que é justamente o que o
 * rastreamento faria.
 */
const DECKS_DIR = process.env.DECKS_DIR ?? join(process.cwd(), ".data", "decks");

/** O arquivo guarda o perfil junto — assim ele se explica sozinho. */
interface ProfileFile {
  profile: { id: string; name: string };
  decks: DeckList[];
}

/**
 * Um id de perfil vira nome de arquivo, então precisa ser inofensivo.
 *
 * Sem esta peneira, um `profile=../../etc/passwd` vindo da rede escreveria
 * onde bem entendesse — é o caminho mais curto entre "app de LAN" e "problema".
 */
const ID_VALIDO = /^[A-Za-z0-9_-]{4,64}$/;

export function isProfileId(value: string): boolean {
  return ID_VALIDO.test(value);
}

function fileFor(profileId: string): string {
  return join(DECKS_DIR, `${profileId}.json`);
}

async function readProfile(profileId: string): Promise<ProfileFile | null> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ fileFor(profileId), "utf8");
    const parsed = JSON.parse(raw) as ProfileFile;
    if (!Array.isArray(parsed.decks)) return null;
    return parsed;
  } catch {
    // Perfil que ainda não existe é o caso normal na primeira visita.
    return null;
  }
}

/**
 * Grava o arquivo inteiro de uma vez.
 *
 * Escreve num temporário e renomeia: `rename` é atômico no mesmo sistema de
 * arquivos, então uma queda no meio da gravação não deixa um JSON pela metade
 * — que seria a biblioteca inteira perdida, não um deck.
 */
async function writeProfile(file: ProfileFile): Promise<void> {
  await mkdir(/*turbopackIgnore: true*/ DECKS_DIR, { recursive: true });
  const destino = fileFor(file.profile.id);
  const temporario = `${destino}.${randomId().slice(0, 8)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ temporario, JSON.stringify(file, null, 2), "utf8");
  await rename(/*turbopackIgnore: true*/ temporario, destino);
}

/**
 * Uma fila por perfil — o arquivo é lido e reescrito inteiro.
 *
 * Sem isto, duas abas salvando decks diferentes ao mesmo tempo se atropelam:
 * as duas leem o arquivo antigo (o `await` da leitura cede a vez), as duas
 * escrevem o que leram, e a alteração da primeira some. É perda de dado
 * silenciosa, e o Node ser de uma thread só não protege — o que protege é
 * serializar as operações.
 */
const filas = new Map<string, Promise<unknown>>();

function emFila<T>(profileId: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filas.get(profileId) ?? Promise.resolve();
  const proxima = anterior.then(tarefa, tarefa);
  // A fila não pode morrer numa rejeição, senão o perfil trava para sempre.
  filas.set(
    profileId,
    proxima.catch(() => undefined),
  );
  return proxima;
}

export async function listDecks(profileId: string): Promise<DeckList[]> {
  const file = await readProfile(profileId);
  return file?.decks ?? [];
}

/**
 * Grava a biblioteca sob um id novo e recolhe os arquivos de origem.
 *
 * Os antigos saem só DEPOIS de o novo estar no disco, e saem como `.bak` em vez
 * de serem apagados: mover coleção é a única operação daqui que pode custar
 * deck de alguém, e um arquivo a mais na pasta é preço baixo por poder desfazer
 * à mão. O sufixo não termina em `.json` de propósito — assim a varredura por
 * apelido nunca reencontra o que já foi recolhido.
 */
async function moverPara(
  paraId: string,
  nome: string,
  origens: ProfileFile[],
  decks: DeckList[],
): Promise<void> {
  await writeProfile({
    profile: { id: paraId, name: nome || origens[0]?.profile.name || "Duelista" },
    decks,
  });
  for (const origem of origens) {
    if (origem.profile.id === paraId) continue;
    await rename(
      /*turbopackIgnore: true*/ fileFor(origem.profile.id),
      `${fileFor(origem.profile.id)}.absorvido.bak`,
    ).catch(() => {});
  }
}

/** Junta bibliotecas sem repetir deck — a identidade do deck é o `id`. */
function juntarDecks(arquivos: ProfileFile[]): DeckList[] {
  const porId = new Map<string, DeckList>();
  for (const arquivo of arquivos) {
    for (const deck of arquivo.decks) {
      if (!porId.has(deck.id)) porId.set(deck.id, deck);
    }
  }
  return [...porId.values()];
}

/**
 * Acha a biblioteca desta pessoa, mesmo que ela esteja gravada sob outro id.
 *
 * O id do perfil passou a sair do apelido (ver `profileIdFromName`), e isso
 * precisa valer para quem já tinha decks salvos sob um id aleatório — inclusive
 * quando o navegador atual nunca viu esse id, que é justamente o caso de abrir
 * o jogo em outra porta ou em outro navegador. A busca é feita em três degraus,
 * do mais barato ao mais caro, e o resultado é sempre **movido** para o id de
 * hoje: na visita seguinte o primeiro degrau resolve.
 *
 * @param name apelido de agora — a comparação ignora caixa e acento.
 * @param from id anterior deste navegador, quando houver.
 */
export function resolveDecks(
  profileId: string,
  name: string,
  from?: string,
): Promise<DeckList[]> {
  return emFila(profileId, async () => {
    // 1. O arquivo do id de hoje.
    const atual = await readProfile(profileId);
    if (atual) {
      // O apelido pode ter mudado de caixa ("straub" → "Straub"): o id é o
      // mesmo, mas o arquivo guarda o nome para se explicar sozinho.
      if (name && atual.profile.name !== name) {
        await writeProfile({ profile: { id: profileId, name }, decks: atual.decks });
      }
      return atual.decks;
    }

    // 2. O id anterior deste navegador (trocou de nome).
    if (from && from !== profileId && isProfileId(from)) {
      const antigo = await readProfile(from);
      if (antigo) {
        await moverPara(profileId, name, [antigo], antigo.decks);
        return antigo.decks;
      }
    }

    // 3. TODOS os arquivos cujo dono se chame assim. É o degrau que adota a
    //    coleção de quem só tinha id aleatório — e o único que varre a pasta,
    //    o que só acontece na primeira visita de cada apelido.
    //
    //    Junta em vez de escolher um: quem jogou em portas diferentes acabou
    //    com a mesma pessoa espalhada em vários arquivos (foi o caso real:
    //    três "Straub", um deles com o único deck de Exodia). Escolher o
    //    "melhor" deixaria os outros órfãos, e órfão aqui significa deck que
    //    o jogador nunca mais vê.
    const candidatos = await candidatosPorNome(name, profileId);
    if (candidatos.length > 0) {
      const decks = juntarDecks(candidatos);
      await moverPara(profileId, name, candidatos, decks);
      return decks;
    }

    return [];
  });
}

/** Compara apelidos como gente: sem caixa, sem acento, sem espaço sobrando. */
function mesmoNome(a: string, b: string): boolean {
  const normal = (valor: string) =>
    valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  return normal(a) === normal(b) && normal(a).length > 0;
}

/**
 * Todo arquivo de quem se chama `name`, fora o do próprio `profileId`.
 *
 * A ordem é estável — mais decks primeiro, e no empate o mexido mais
 * recentemente — porque ela decide qual versão de um deck repetido sobrevive
 * na junção.
 */
async function candidatosPorNome(
  name: string,
  profileId: string,
): Promise<ProfileFile[]> {
  if (!name) return [];

  let arquivos: string[];
  try {
    arquivos = await readdir(/*turbopackIgnore: true*/ DECKS_DIR);
  } catch {
    return [];
  }

  const candidatos: ProfileFile[] = [];
  for (const arquivo of arquivos) {
    if (!arquivo.endsWith(".json")) continue;
    const id = arquivo.slice(0, -".json".length);
    if (id === profileId || !isProfileId(id)) continue;
    const file = await readProfile(id);
    if (file && mesmoNome(file.profile.name, name)) candidatos.push(file);
  }

  const maisRecente = (file: ProfileFile) =>
    file.decks.reduce(
      (maior, deck) => (deck.updatedAt > maior ? deck.updatedAt : maior),
      "",
    );

  return candidatos.sort(
    (a, b) =>
      b.decks.length - a.decks.length ||
      maisRecente(b).localeCompare(maisRecente(a)),
  );
}

/** Cria ou atualiza um deck. Devolve a biblioteca já com a mudança aplicada. */
export function putDeck(
  profileId: string,
  profileName: string,
  deck: DeckList,
): Promise<DeckList[]> {
  return emFila(profileId, async () => {
    const atual = await readProfile(profileId);
    const decks = atual?.decks ?? [];
    const indice = decks.findIndex((candidate) => candidate.id === deck.id);

    if (indice >= 0) decks[indice] = deck;
    else decks.push(deck);

    await writeProfile({
      profile: {
        id: profileId,
        name: profileName || atual?.profile.name || "Duelista",
      },
      decks,
    });
    return decks;
  });
}

export function deleteDeck(
  profileId: string,
  deckId: string,
): Promise<DeckList[]> {
  return emFila(profileId, async () => {
    const atual = await readProfile(profileId);
    if (!atual) return [];

    const decks = atual.decks.filter((deck) => deck.id !== deckId);
    await writeProfile({ ...atual, decks });
    return decks;
  });
}
