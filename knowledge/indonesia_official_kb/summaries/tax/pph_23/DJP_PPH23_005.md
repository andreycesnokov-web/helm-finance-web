# Source

- **source_id:** `DJP_PPH23_005`
- **title:** Salah Kaprah Pengenaan PPh Pasal 21 dan PPh Pasal 23 atas Jasa
- **authority:** DJP
- **official_url:** https://pajak.go.id/en/artikel/salah-kaprah-pengenaan-pph-pasal-21-dan-pph-pasal-23-atas-jasa
- **source_type:** official_guidance
- **trust_level:** official_guidance
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_23/DJP_PPH23_005.html`
- **sha256:** `ec9c9ece5df39dd7d9304662a6115692a7a83d334a4661bd554592a5df3e82df`

# What this source supports

This source appears to support a **necessary precondition check** before any PPh 23 rule is applied:
whether the service provider is an entity or an individual.

**The source states** that it is a common error to withhold PPh 21 on an honorarium actually received
by a *badan usaha*, and equally common to withhold PPh 23 on a repair service actually performed by
an *orang pribadi*.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Service fees to an *orang pribadi* → PPh 21 territory | article body | medium | true |
| Service fees to a *badan usaha* → PPh 23 territory | article body | medium | true |
| Some objects overlap between PPh 21 and PPh 23 | article body | medium | true |
| DJP treats this confusion as widespread enough to publish about | title and framing | high | false |

# Tax Engine relevance

- **This is a hard gate on the PPh 23 candidates.** Before suggesting PPh 23, the engine must know
  the counterparty is an entity.
- **Our data cannot answer this.** `counterparties` has a free-text `type` field but no legal-form or
  NPWP field. So the engine must ask, not assume.
- Strengthens the case for the counterparty tax-identity migration already proposed.

# What this source does NOT prove

- It does not give a complete decision procedure for the overlapping objects.
- It does not tell us how to determine legal form from data we hold.
- It is an article — guidance, not regulation.

# Reviewer questions

1. What is the practical test for entity vs individual when only a name is on the invoice?
2. Which service objects genuinely overlap between PPh 21 and PPh 23?
