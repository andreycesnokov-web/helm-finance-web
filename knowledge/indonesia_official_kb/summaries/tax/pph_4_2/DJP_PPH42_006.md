# Source

- **source_id:** `DJP_PPH42_006`
- **title:** Waspadai Salah Tarif PPh Biaya Layanan Gedung
- **authority:** DJP
- **official_url:** https://www.pajak.go.id/index.php/en/node/25637
- **source_type:** official_guidance
- **trust_level:** official_guidance
- **verification_status:** `fetch_verified`
- **retrieved_at:** 2026-09-02
- **local_file:** `knowledge/indonesia_official_kb/raw_sources/tax/pph_4_2/DJP_PPH42_006.html`
- **sha256:** `ed0fc790e22007481ef7a6ac2cd6441e7d4e7071ec350ba1fe06a080ffa8ad15`

# What this source supports

This source appears to support **separating a building service charge from rent** for tax purposes.
**The source states** that where services are supplied by a **third-party provider**, the
arrangement falls within *jasa manajemen*, so the fee the building owner pays that provider is
subject to PPh at **2% under Pasal 23 UU PPh**.

This is the most directly product-relevant source found in this pass.

# Extracted facts

| Fact | Where | Confidence | needs_reviewer |
|---|---|---|---|
| Third-party building services = *jasa manajemen* | archived article body | medium | true |
| Fee to that provider taxed at 2% under Pasal 23 UU PPh | same | medium | true |
| DJP publishes this specifically as a mis-rating warning | article title and framing | high | false |

# Tax Engine relevance

- **Transaction types:** rental bundles where an invoice separates base rent from a service charge —
  exactly the Test Case 2 (Alfamart) shape.
- **Rule candidates:** interacts with both `TAX_ID_PPH42_RENTAL_001` and the PPh 23 candidates.
- **Risk:** applying a single rate to a whole rental invoice may be wrong when the invoice contains
  two differently-taxed components. **The engine must not silently apply one rate to a mixed invoice.**

# What this source does NOT prove

- It does **not** give a general boundary test between PPh 4(2) rent and PPh 23 service charge. It
  describes one scenario (third-party provider) and poses further questions rather than resolving
  them.
- It does not say how an invoice that bundles both should be split.
- It does not confirm the treatment when the landlord itself, not a third party, provides services.
- It is an article — guidance, not regulation.

# Reviewer questions

1. What is the general test for rent versus service charge?
2. If one invoice contains both, must they be split, and on what basis?
3. Does it change when the landlord provides the services directly?
