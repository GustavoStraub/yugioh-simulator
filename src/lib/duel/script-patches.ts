/**
 * Correções aplicadas aos scripts base do ProjectIgnis.
 *
 * Os scripts vêm do `master` do repositório de cartas, mas o `ocgcore` que
 * roda aqui é um binário compilado mais antigo. Quando um script passa a usar
 * algo que só existe no core novo, ele quebra — e não há como consertar do
 * lado deles nem do nosso sem tocar no arquivo. Este módulo é esse toque:
 * emendas mínimas, aplicadas ao script logo depois do download.
 *
 * Duas regras que valem para qualquer emenda daqui:
 *
 * 1. **A âncora é uma expressão regular tolerante a espaçamento.** Casar com
 *    um trecho literal significa que qualquer reindentação do upstream faz a
 *    correção evaporar em silêncio.
 * 2. **Se a âncora não casar, isso é reportado** (`patchesNaoAplicados`), e o
 *    duelo avisa. Uma emenda que some sem barulho é pior que emenda nenhuma.
 *
 * Este arquivo é importado tanto pelo app quanto pelo harness de testes, então
 * não usa o atalho `@/...` nem nada de TypeScript além dos tipos.
 */

interface ScriptPatch {
  /** Arquivo a emendar, como o `scriptReader` o pede. */
  file: string;
  /** Identificação curta, usada no diagnóstico. */
  name: string;
  /** Trecho esperado no original, tolerante a espaçamento. */
  from: RegExp;
  /** Substituição. */
  to: string;
  /** Por que a emenda existe — some quando o core for atualizado. */
  why: string;
}

/**
 * Monta uma âncora a partir do código original: cada corrida de espaço em
 * branco vira `\s+`, e o resto é escapado. Assim a emenda sobrevive a
 * reindentação, troca de tabs por espaços e quebras de linha diferentes.
 */
function anchor(code: string): RegExp {
  const escaped = code
    .trim()
    .split(/\s+/)
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(escaped);
}

const PATCHES: ScriptPatch[] = [
  {
    file: "chain.lua",
    name: "chaininfo-flag-desconhecida",
    why:
      "O chain.lua consulta CHAININFO_TRIGGERING_LSCALE (constante 32), que " +
      "entrou nos CardScripts em junho de 2026 e não existe no ocgcore-wasm " +
      "compilado que usamos: o core rejeita a flag e aborta o script com " +
      '"Passed invalid CHAININFO flag". Confirmado com instrumentação Lua ' +
      "(info=32) em Charm of Shabti, Strike Ninja e Last Turn — as três caem " +
      "nesse caminho ao remover a própria carta do campo durante a resolução, " +
      "o que faz o chain.lua sair do atalho rápido e varrer TODAS as " +
      "propriedades da carta que disparou, escala inclusive.\n\n" +
      "A emenda faz APENAS as flags novas devolverem `nil` quando o core não " +
      "as conhece — que é exatamente o que o resto do chain.lua já espera " +
      "(`return_equals_any` e `chain_prop` testam `nil` e seguem adiante). " +
      "Qualquer outra flag continua estourando de verdade: um erro real não " +
      "pode virar silêncio. E quando o core for atualizado, o `pcall` passa a " +
      "ter sucesso e o valor verdadeiro volta sozinho, sem mexer aqui.\n\n" +
      "Com o binding 0.1.4 (core de agosto de 2026) isso já aconteceu: " +
      "`SKIP_SCRIPT_PATCHES=1` com Charm of Shabti resolve sem erro. A emenda " +
      "ficou como rede de segurança para um core mais antigo; pode sair quando " +
      "ninguém mais rodar o 0.1.3.",
    from: anchor(`local function chaininfo_fn(info)
	return function(ch)
		return Duel.GetChainInfo(ch or 0,info)
	end
end`),
    to: `-- PATCH LOCAL (src/lib/duel/script-patches.ts)
-- Flags de CHAININFO que os CardScripts passaram a usar depois deste core.
-- Lidas por nome: se constant.lua renumerar, a emenda acompanha.
local ocgcore_flags_novas={}
for _,nome in ipairs({"CHAININFO_TRIGGERING_LINK","CHAININFO_TRIGGERING_LSCALE","CHAININFO_TRIGGERING_RSCALE"}) do
	local valor=_G[nome]
	if valor then ocgcore_flags_novas[valor]=true end
end

local function chaininfo_fn(info)
	return function(ch)
		if ocgcore_flags_novas[info] then
			-- Só estas podem falhar em silêncio: o core antigo não as conhece
			-- e o formato Goat não tem Pendulum nem Link, então o valor não
			-- teria uso de qualquer forma.
			local ok,res=pcall(Duel.GetChainInfo,ch or 0,info)
			if not ok then return nil end
			return res
		end
		-- Todas as outras seguem como antes: um erro aqui é erro de verdade.
		return Duel.GetChainInfo(ch or 0,info)
	end
end`,
  },
];

/** Emendas que deveriam ter sido aplicadas e não encontraram sua âncora. */
const naoAplicados = new Set<string>();

/**
 * Aplica as emendas conhecidas de um script base.
 *
 * @param file nome do arquivo, como o `scriptReader` o pede.
 * @param source conteúdo original.
 */
export function patchCoreScript(file: string, source: string): string {
  let result = source;

  for (const patch of PATCHES) {
    if (patch.file !== file) continue;
    const chave = `${patch.file}:${patch.name}`;
    if (!patch.from.test(result)) {
      naoAplicados.add(chave);
      continue;
    }
    result = result.replace(patch.from, patch.to);
    naoAplicados.delete(chave);
  }

  return result;
}

/**
 * Emendas que não casaram com o script baixado.
 *
 * Serve para o duelo poder avisar em vez de deixar a correção evaporar quando
 * o upstream reescrever o trecho.
 */
export function patchesNaoAplicados(): string[] {
  return [...naoAplicados];
}

/** Quantas emendas existem — usado nos testes para detectar emenda órfã. */
export function totalDePatches(): number {
  return PATCHES.length;
}
