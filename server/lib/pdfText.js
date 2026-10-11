// Dependency-free extraction of EMBEDDED text from a PDF buffer.
//
// Why hand-rolled: the project has no PDF library, and adding one was not approved for this
// task. This reads only what a PDF already carries as text — it is NOT OCR. A scanned page
// (a photo inside a PDF) has no embedded text and correctly yields nothing, which the caller
// must treat as "no content signal", never as "nothing matched".
//
// Deliberately conservative:
//   * bounded work (byte cap, stream cap, output cap) so a hostile file cannot hang the API;
//   * every failure is swallowed and reported as text_available:false;
//   * output is validated — a PDF with a custom font encoding decodes to garbage, and garbage
//     must not be fed to a classifier, so a low legible-character ratio is rejected.
const zlib = require('node:zlib');

const MAX_INPUT_BYTES = 12 * 1024 * 1024;   // ignore very large files entirely
const MAX_STREAMS = 400;                    // pages/objects to look at
const MAX_TEXT_CHARS = 200000;              // cap the assembled text
const MIN_USABLE_CHARS = 24;                // below this there is no real signal
const MIN_LEGIBLE_RATIO = 0.6;              // reject mojibake from custom encodings

// ── decompression bounds (zip-bomb defence) ─────────────────────────────────
// A few KB of Flate can expand to gigabytes. Three independent limits, any of which
// aborts the WHOLE extraction fail-closed rather than truncating silently:
//   per-stream output, cumulative output across streams, and expansion ratio.
const MAX_STREAM_OUTPUT_BYTES = 4 * 1024 * 1024;      // one stream may not exceed 4 MB
const MAX_TOTAL_OUTPUT_BYTES = 24 * 1024 * 1024;      // all streams together
const MAX_INFLATE_RATIO = 200;                        // output/input per stream
const MAX_ELAPSED_MS = 2000;                          // wall-clock guard for the whole parse

// zlib signals "would exceed maxOutputLength" with ERR_BUFFER_TOO_LARGE / a buffer-size
// message depending on the Node version — treat any of them as a limit breach, not corruption.
const isLimitError = (e) =>
  !!e && (e.code === 'ERR_BUFFER_TOO_LARGE' ||
          /maxOutputLength|buffer.{0,20}(too large|size)|output length/i.test(e.message || ''));

// PDF string escapes: \( \) \\ \n \r \t \b \f and \ddd octal.
function decodePdfString(s) {
  return s.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (m, g) => {
    switch (g) {
      case 'n': return '\n'; case 'r': return '\r'; case 't': return '\t';
      case 'b': return '\b'; case 'f': return '\f';
      case '(': return '('; case ')': return ')'; case '\\': return '\\';
      default: return String.fromCharCode(parseInt(g, 8));
    }
  });
}

const decodeHexString = (hex) => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.substr(i, 2), 16);
    // UTF-16BE text often interleaves NULs; drop them rather than emitting control chars.
    if (code) out += String.fromCharCode(code);
  }
  return out;
};

// Pull the text-showing operators out of one decoded content stream.
function textFromContentStream(content) {
  const parts = [];
  // (literal) Tj / TJ / ' / "   and   <hex> Tj / TJ
  const re = /(?:\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]*)>)\s*(Tj|TJ|'|")?/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) parts.push(decodePdfString(m[1]));
    else if (m[2] !== undefined) parts.push(decodeHexString(m[2]));
    if (parts.length > 40000) break;
  }
  // Line/paragraph operators are lost above; join with spaces so word boundaries survive.
  return parts.join(' ');
}

// Is this plausibly human-readable text rather than decoded binary noise?
function isLegible(text) {
  if (!text) return false;
  const letters = (text.match(/[A-Za-z0-9]/g) || []).length;
  const total = text.replace(/\s/g, '').length;
  if (!total) return false;
  return letters / total >= MIN_LEGIBLE_RATIO;
}

/**
 * Extract embedded text from a PDF buffer.
 * @returns {{ text: string, text_available: boolean, method: 'pdf_text', reason: string|null }}
 */
function extractPdfText(buffer) {
  const fail = (reason) => ({ text: '', text_available: false, method: 'pdf_text', reason });
  try {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return fail('empty_file');
    if (buffer.length > MAX_INPUT_BYTES) return fail('file_too_large_to_scan');
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return fail('not_a_pdf');

    const startedAt = Date.now();
    const latin = buffer.toString('latin1');
    let out = '';
    let streams = 0;
    let totalInflated = 0;
    const re = /stream\r?\n?/g;
    let m;
    while ((m = re.exec(latin)) !== null && streams < MAX_STREAMS && out.length < MAX_TEXT_CHARS) {
      // Wall-clock guard: a pathological file must not hold the request open.
      if (Date.now() - startedAt > MAX_ELAPSED_MS) return fail('extraction_time_limit_exceeded');
      const start = m.index + m[0].length;
      const end = latin.indexOf('endstream', start);
      if (end < 0) break;
      streams += 1;
      // The stream's dictionary sits just before the `stream` keyword.
      const dict = latin.slice(Math.max(0, m.index - 600), m.index);
      if (/\/Image\b|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(dict)) continue;  // scanned page bitmap
      const rawSlice = buffer.subarray(start, end);
      let content = null;
      if (/\/FlateDecode/.test(dict)) {
        // `maxOutputLength` makes zlib itself refuse to allocate past the cap — the buffer is
        // never materialised, so a compression bomb cannot exhaust memory.
        const budget = Math.min(
          MAX_STREAM_OUTPUT_BYTES,
          Math.max(1024, rawSlice.length * MAX_INFLATE_RATIO),
          Math.max(1, MAX_TOTAL_OUTPUT_BYTES - totalInflated),
        );
        const opts = { maxOutputLength: budget };
        let inflated = null;
        try { inflated = zlib.inflateSync(rawSlice, opts); }
        catch (e) {
          if (isLimitError(e)) return fail('decompression_limit_exceeded');
          try { inflated = zlib.inflateRawSync(rawSlice, opts); }
          catch (e2) {
            if (isLimitError(e2)) return fail('decompression_limit_exceeded');
            inflated = null;   // malformed stream — skip it, keep going
          }
        }
        if (inflated) {
          totalInflated += inflated.length;
          if (totalInflated > MAX_TOTAL_OUTPUT_BYTES) return fail('decompression_limit_exceeded');
          content = inflated.toString('latin1');
        }
      } else if (!/\/Filter/.test(dict)) {
        if (rawSlice.length > MAX_STREAM_OUTPUT_BYTES) return fail('decompression_limit_exceeded');
        totalInflated += rawSlice.length;
        if (totalInflated > MAX_TOTAL_OUTPUT_BYTES) return fail('decompression_limit_exceeded');
        content = rawSlice.toString('latin1');
      }
      if (!content) continue;
      if (!/\bTj\b|\bTJ\b|\bBT\b/.test(content)) continue;   // not a text content stream
      out += ' ' + textFromContentStream(content);
      re.lastIndex = end;
    }

    const text = out.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    if (text.length < MIN_USABLE_CHARS) return fail('no_embedded_text');
    if (!isLegible(text)) return fail('text_not_legible');
    return { text, text_available: true, method: 'pdf_text', reason: null };
  } catch {
    return fail('extraction_failed');
  }
}

module.exports = { extractPdfText, MAX_INPUT_BYTES };
