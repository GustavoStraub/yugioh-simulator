import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import type { YgoProDeckCard } from "@/lib/types";

/**
 * Catálogo de cartas do formato Goat, vindo da YGOPRODeck.
 *
 * Mora fora da rota `/api/cards` porque o servidor de duelo online precisa do
 * mesmo catálogo para montar o `cardReader` do engine, e **não pode importar um
 * route handler**: `next/server` só existe dentro do bundler do Next.
 *
 * ⚠️ Importado pelos dois lados (grafo do Next e Node puro), logo existem duas
 * instâncias do módulo e dois caches. Desperdício aceitável — o que não vale é
 * tratar o cache daqui como fonte única de verdade.
 */

const YGOPRODECK_URL =
  "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat&language=pt";

/**
 * O mesmo pool, em inglês.
 *
 * A resposta em português já traz `name_en`, mas **não** traz o texto do
 * efeito em inglês — e é o texto que se lê para decidir a jogada. Uma segunda
 * busca é o preço de poder ler a carta no idioma que se conhece; ela é feita
 * uma vez por hora, junto da primeira.
 */
const YGOPRODECK_URL_EN =
  "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat";

/**
 * Fichas (tokens). Não são cartas jogáveis e não entram em deck, mas o engine
 * PEDE os dados delas quando um efeito cria uma — "Bode Expiatório" faz quatro.
 * Sem elas no catálogo o `cardReader` devolvia null e a carta quebrava.
 */
const YGOPRODECK_TOKENS_URL =
  "https://db.ygoprodeck.com/api/v7/cardinfo.php?type=token";

const CACHE_TTL_MS = 1000 * 60 * 60;

let cachedCards: YgoProDeckCard[] | null = null;
let cacheTimestamp = 0;

/**
 * Alguns passcodes usados nos decks oficiais não voltam no filtro
 * `format=goat` da YGOPRODeck (a carta existe, mas a API não a marca como
 * legal no formato). Sem eles o duelo registra "carta desconhecida" e o
 * engine não consegue criá-la — então buscamos essas faltas por id.
 */
function presetPasscodes(): number[] {
  const codes = new Set<number>();
  for (const preset of PRESET_DECKS) {
    for (const zone of [preset.main, preset.extra, preset.side ?? []]) {
      for (const code of zone) codes.add(code);
    }
  }
  return [...codes];
}

async function fetchIdBatch(
  ids: number[],
  language: "pt" | null,
): Promise<YgoProDeckCard[]> {
  const params = new URLSearchParams({ id: ids.join(",") });
  if (language) params.set("language", language);

  const response = await fetch(
    `https://db.ygoprodeck.com/api/v7/cardinfo.php?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];

  const payload = (await response.json()) as { data?: YgoProDeckCard[] };
  return payload.data ?? [];
}

async function fetchByIds(ids: number[]): Promise<YgoProDeckCard[]> {
  if (ids.length === 0) return [];

  const translated = await fetchIdBatch(ids, "pt");

  // O filtro `language=pt` descarta cartas sem tradução publicada. Elas ainda
  // existem no banco em inglês, e o duelo precisa delas — melhor exibir o nome
  // em inglês do que a carta sumir do deck.
  const found = new Set(translated.map((card) => card.id));
  const untranslated = ids.filter((id) => !found.has(id));

  return [...translated, ...(await fetchIdBatch(untranslated, null))];
}

export async function fetchGoatCards(): Promise<YgoProDeckCard[]> {
  const now = Date.now();
  if (cachedCards && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCards;
  }

  const response = await fetch(YGOPRODECK_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`YGOPRODeck respondeu com status ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: YgoProDeckCard[];
    error?: string;
  };

  if (payload.error || !payload.data) {
    throw new Error(payload.error ?? "Resposta inválida da YGOPRODeck");
  }

  const cards = payload.data;

  // Casa o texto em inglês pelo id. Uma falha aqui não pode derrubar o
  // catálogo: sem ela o app volta a ser só em português, que é o padrão.
  try {
    const englishResponse = await fetch(YGOPRODECK_URL_EN, { cache: "no-store" });
    if (englishResponse.ok) {
      const englishPayload = (await englishResponse.json()) as {
        data?: YgoProDeckCard[];
      };
      const porId = new Map(
        (englishPayload.data ?? []).map((card) => [card.id, card]),
      );
      for (const card of cards) {
        const ingles = porId.get(card.id);
        if (!ingles) continue;
        card.desc_en = ingles.desc;
        card.name_en ??= ingles.name;
      }
    }
  } catch {
    // Sem o inglês o app segue em português.
  }

  // Fichas entram no catálogo para o engine poder criá-las.
  try {
    const tokens = await fetch(YGOPRODECK_TOKENS_URL, { cache: "no-store" });
    if (tokens.ok) {
      const tokenPayload = (await tokens.json()) as { data?: YgoProDeckCard[] };
      cards.push(...(tokenPayload.data ?? []));
    }
  } catch {
    // Sem fichas o duelo ainda roda; só cartas que as criam ficam quebradas.
  }

  const known = new Set(cards.map((card) => card.id));
  const missing = presetPasscodes().filter((code) => !known.has(code));

  if (missing.length > 0) {
    cards.push(...(await fetchByIds(missing)));
  }

  cachedCards = cards;
  cacheTimestamp = now;
  return cachedCards;
}
