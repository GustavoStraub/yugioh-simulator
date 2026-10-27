# Referências imutáveis do bot

`2026-10-23/` foi gerada antes das alterações de evolução, a partir de `3ab76a5`.
Contém o grafo de execução do cérebro, módulos de suporte, imports dinâmicos e JSONs,
mais observação, automação, listas e banco usados na reprodução. Os módulos compilados
só importam caminhos relativos dentro da referência ou dependências externas declaradas.

Não editar nem regenerar essa pasta. `loadBaseline` verifica cada arquivo pelo manifesto.
O core WASM, CardScripts e emendas são o ambiente comum do experimento: seus hashes
são registrados por execução, não simulados como conhecimento da política.

Para criar outra referência, escolha um caminho novo:

```sh
npm run freeze:bot -- tools/harness/baselines/AAAA-MM-DD
```

Replays com observações privadas ficam exclusivamente em `.cache/`; não entram aqui.
