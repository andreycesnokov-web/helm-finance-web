# graph/

Machine-readable knowledge graph derived from the Indonesia Official KB.

| File | What it is |
|---|---|
| `knowledge_graph_v1.json` | The graph. 207 nodes, 320 edges. Generated, not hand-written. |
| `knowledge_graph_v1.md` | Human-readable companion: node/edge types, high-value paths, gaps. |

## Generated, not authored

The graph is built **from** `source_registry.json`, the three `rule_candidates/*.json` files and
`invoice_review_matrix_v1.json`. Do not hand-edit `knowledge_graph_v1.json` — change the underlying
KB and regenerate, or the validator's consistency checks will fail.

## Precedence

Unchanged from the rest of the KB:

- `raw_sources/` + `MANIFEST.json` SHA-256 = **authoritative evidence**
- `summaries/_extracted/` = derived review text, **never** a source of truth
- graph `source_ids` = **registry source ids only**

## Status

`under_review` throughout. `active: false`, `legal_verified: false` on every node and edge. Nothing
here is wired to product code, RAG, Supabase or AI Invoice Review, and nothing here may be used to
activate a tax rule.
