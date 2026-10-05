# Rename exceptions

Identifiers kept from Sixonic on purpose. None is shown to users.

| Identifier | Where | Why it stays |
| --- | --- | --- |
| Chat seat ids `orion`, `grimm`, `solara`, `zephyr`, `mira`, `aquila` | API `personaId`, client seat tables | Part of the chat API contract. Display names are now role names ("Risk & Resilience agent") |
| Analysis seat ids `dr_white`, `cmdr_black`, `ms_gold`, `dr_green`, `lt_red`, `col_blue` | API `personaOutputs[].id`, `personaActions` keys, the aggregation prompt's JSON schema | Part of the analysis output contract, and the model is asked to return these keys |
| `emoji` field on chat responses | API response | Kept for contract parity; the UI does not display it |

Everything else was renamed, including package name, storage keys, page titles,
metadata, favicon, social image and log lines. `npm run check:brand` enforces it.
