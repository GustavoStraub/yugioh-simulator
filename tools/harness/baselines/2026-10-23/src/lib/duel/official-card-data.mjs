/**
 * Dados OFICIAIS das cartas — o mesmo `cards.cdb` do ProjectIgnis contra o
 * qual os scripts Lua foram escritos.
 *
 * Por que não dá para derivar da YGOPRODeck: ela publica a carta para humanos
 * ("Quick-Play Spell", "Winged Beast"), não os bitfields que o ocgcore usa. E
 * o `setcode` — o "arquétipo" na visão do engine — simplesmente não existe na
 * YGOPRODeck. Sem ele, todo efeito que faz `IsSetCard(...)` falha calado:
 * Gravekeeper's, Harpie, Amazoness, Toon, Ojama, Archfiend...
 *
 * O arquivo é gerado por `scripts/build-card-db.mjs`.
 */
/** Ordem dos campos no formato posicional do `card-db.json`. */
const CARD_DB_FIELDS = [
    "type",
    "alias",
    "level",
    "race",
    "attribute",
    "atk",
    "def",
    "lscale",
    "rscale",
];
/**
 * Distância máxima entre o passcode de uma arte alternativa e o da carta
 * original. É a mesma constante do ocgcore (`CARD_ARTWORK_VERSIONS_OFFSET`), e
 * é ela que decide se um `alias` é "outra arte da mesma carta" (o core carrega
 * o script do alias) ou "carta diferente tratada como" — caso de Harpie Lady 1,
 * que é tratada como "Harpie Lady" mas tem script próprio.
 */
export const CARD_ARTWORK_VERSIONS_OFFSET = 20;
function decode(row) {
    const data = {};
    CARD_DB_FIELDS.forEach((field, index) => {
        data[field] = row[index] ?? 0;
    });
    data.setcodes = row.slice(CARD_DB_FIELDS.length);
    return data;
}
/** Índice consultável do banco oficial. */
export class OfficialCardDb {
    rows;
    cache = new Map();
    constructor(rows) {
        this.rows = rows;
    }
    /**
     * Dados oficiais de um passcode.
     *
     * A YGOPRODeck às vezes devolve o passcode de uma **arte alternativa** que
     * nem está na `cards.cdb` (é o caso de "Barrel Dragon" 81480461, cuja carta
     * catalogada é a 81480460). Nesses casos procuramos o passcode original na
     * janela de artes alternativas — sem isso a carta cairia no palpite feito a
     * partir das strings da YGOPRODeck.
     */
    get(passcode) {
        const cached = this.cache.get(passcode);
        if (cached !== undefined)
            return cached;
        let found = null;
        const direct = this.rows[String(passcode)];
        if (direct) {
            found = decode(direct);
        }
        else {
            for (let back = 1; back < CARD_ARTWORK_VERSIONS_OFFSET; back += 1) {
                const row = this.rows[String(passcode - back)];
                if (!row)
                    continue;
                const original = decode(row);
                // Só serve se a carta encontrada for de fato "a original desta arte":
                // ou ela não tem alias (é a própria), ou aponta para si mesma.
                if (original.alias === 0 || original.alias === passcode - back) {
                    found = { ...original, alias: passcode - back };
                }
                break;
            }
        }
        this.cache.set(passcode, found);
        return found;
    }
    /**
     * Passcode do script que o core vai pedir para esta carta.
     *
     * O ocgcore carrega o script do `alias` quando ele está dentro da janela de
     * artes alternativas, e o script próprio da carta caso contrário. Precisamos
     * saber disso para pré-carregar o arquivo certo: pedir `c83764719.lua`
     * (Reviver Monstro, arte alternativa) quando o core vai pedir
     * `c83764718.lua` deixava a carta sem efeito nenhum.
     */
    scriptPasscode(passcode) {
        const data = this.get(passcode);
        if (!data || data.alias === 0)
            return passcode;
        return Math.abs(data.alias - passcode) < CARD_ARTWORK_VERSIONS_OFFSET
            ? data.alias
            : passcode;
    }
    get size() {
        return Object.keys(this.rows).length;
    }
    /** Todos os passcodes do banco (cartas, fichas e artes alternativas). */
    passcodes() {
        return Object.keys(this.rows).map(Number);
    }
}
/** Banco vazio — usado quando o download do `card-db` falha. */
export const EMPTY_CARD_DB = new OfficialCardDb({});
/** Busca o banco oficial servido por `/api/card-db`. */
export async function fetchOfficialCardDb() {
    const response = await fetch("/api/card-db");
    if (!response.ok) {
        throw new Error(`Falha ao carregar o banco oficial de cartas (${response.status}).`);
    }
    return new OfficialCardDb((await response.json()));
}
