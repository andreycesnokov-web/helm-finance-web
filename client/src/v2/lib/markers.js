// Technical tags inside stored text, such as "[CFO_AI_DEMO_PACK_V1]" that demo/import packs
// append to descriptions, are not for people. The v2 read layer (data.jsx) removes them from
// every string before a screen sees it. Display only: the database keeps the tag.
// A tag is square brackets around UPPER_CASE words joined by "_" (at least one "_"), so
// ordinary text in brackets ("[draft]", "[PT ABC]", "[Q3]") is left alone.
// Pure; tested in tests/design/v2Markers.test.mjs.
const TAG = /\s*\[[A-Z0-9]+(?:_[A-Z0-9]+)+\]/g

export function stripMarkers(s) {
  if (typeof s !== 'string' || s.indexOf('[') < 0) return s
  const out = s.replace(TAG, '')
  return out === s ? s : out.replace(/\s+([,.;:)])/g, '$1').replace(/^\s*[·—-]\s*|\s*[·—-]\s*$/g, '').trim()
}

/** A copy of `v` (JSON from the API) with tags removed from every string, keys untouched. */
export function scrubMarkers(v) {
  if (typeof v === 'string') return stripMarkers(v)
  if (Array.isArray(v)) return v.map(scrubMarkers)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = scrubMarkers(v[k])
    return o
  }
  return v
}
