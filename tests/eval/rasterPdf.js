// A real scanned page, built from nothing.
//
// The evaluation suite needs a document with NO embedded text — the case the whole
// native-vision argument rests on. It used to use a 52-byte stub, which proves nothing:
// a file that is not a readable page cannot show whether the pipeline reads pages.
//
// Committing an actual customer scan is not an option, and pulling in a PDF library for
// one fixture is not worth the dependency. So this draws the text into a bitmap with a
// 5x7 font, embeds the bitmap as a PDF image, and produces a page that is genuinely
// pixels: pdfText.js finds nothing in it, exactly like a document off a flatbed.
//
// Deliberately imperfect. Real scans are grey, slightly speckled and never quite
// straight, and a fixture that is too clean flatters the model.
'use strict';

const zlib = require('zlib');

/* ── a 5x7 font ────────────────────────────────────────────────────────────
   Written as pictures rather than hex so a wrong pixel is visible in review. */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['#####', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '(': ['..#..', '.#...', '#....', '#....', '#....', '.#...', '..#..'],
  ')': ['..#..', '...#.', '....#', '....#', '....#', '...#.', '..#..'],
  '%': ['##..#', '##.#.', '..#..', '.#...', '#..##', '.#.##', '#....'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

const GW = 5;
const GH = 7;

/** A grayscale canvas. 255 = paper, 0 = ink. */
function canvas(width, height) {
  const px = Buffer.alloc(width * height, 245);   // scanned paper is not white
  return {
    width,
    height,
    px,
    set(x, y, v) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      px[y * width + x] = v;
    },
  };
}

/**
 * Draw one line of text.
 * @param scale  pixels per font pixel. 4 gives ~28px capitals, comfortably legible.
 */
function drawText(c, text, x, y, scale = 4, ink = 25) {
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let row = 0; row < GH; row += 1) {
      for (let col = 0; col < GW; col += 1) {
        if (g[row][col] !== '#') continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            c.set(cx + col * scale + dx, y + row * scale + dy, ink);
          }
        }
      }
    }
    cx += (GW + 1) * scale;
  }
  return cx;
}

function drawRule(c, x1, x2, y, thickness = 2, ink = 90) {
  for (let t = 0; t < thickness; t += 1) {
    for (let x = x1; x <= x2; x += 1) c.set(x, y + t, ink);
  }
}

/** Scanner noise. Without it the page is a screenshot, not a scan. */
function speckle(c, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < c.px.length; i += 1) {
    const n = (rnd() - 0.5) * 18;
    c.px[i] = Math.max(0, Math.min(255, Math.round(c.px[i] + n)));
  }
}

/**
 * Wrap the raster pages into a PDF whose only content is images.
 * No font is embedded and no text operator is used, so there is nothing for a text
 * extractor to find — which is the entire point of the fixture.
 */
function pdfFromCanvases(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };   // 1-based ids

  const catalogId = 1;
  const pagesId = 2;
  objs.push(null, null);            // reserved slots for catalog and pages

  const pageIds = [];
  for (const c of pages) {
    const compressed = zlib.deflateSync(c.px);
    const imgId = add(Buffer.concat([
      Buffer.from(`<</Type/XObject/Subtype/Image/Width ${c.width}/Height ${c.height}`
        + `/ColorSpace/DeviceGray/BitsPerComponent 8/Filter/FlateDecode/Length ${compressed.length}>>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]));
    // A4 at the raster's aspect ratio.
    const w = 595;
    const h = Math.round(595 * (c.height / c.width));
    const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    const contentId = add(Buffer.concat([
      Buffer.from(`<</Length ${content.length}>>\nstream\n`), content, Buffer.from('\nendstream'),
    ]));
    pageIds.push(add(Buffer.from(
      `<</Type/Page/Parent ${pagesId} 0 R/MediaBox[0 0 ${w} ${h}]`
      + `/Resources<</XObject<</Im0 ${imgId} 0 R>>>>/Contents ${contentId} 0 R>>`)));
  }

  objs[catalogId - 1] = Buffer.from(`<</Type/Catalog/Pages ${pagesId} 0 R>>`);
  objs[pagesId - 1] = Buffer.from(
    `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pageIds.length}>>`);

  const chunks = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n`);
    const tail = Buffer.from('\nendobj\n');
    offsets.push(offset);
    chunks.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<</Size ${objs.length + 1}/Root ${catalogId} 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

/**
 * Render a document described as lines into a scanned-looking PDF.
 * @param pages  array of arrays of { text, scale, indent, rule, gap }
 */
function scannedPdf(pages, opts = {}) {
  const width = opts.width || 1240;      // ~150 dpi A4
  const height = opts.height || 1754;
  const canvases = pages.map((lines, pageIndex) => {
    const c = canvas(width, height);
    let y = 90;
    for (const line of lines) {
      if (line.gap) { y += line.gap; continue; }
      if (line.rule) { drawRule(c, 80, width - 80, y, 2); y += 26; continue; }
      const scale = line.scale || 3;
      drawText(c, line.text, 80 + (line.indent || 0), y, scale, line.ink ?? 25);
      y += GH * scale + (line.lead || 14);
    }
    speckle(c, 7 + pageIndex);
    return c;
  });
  return pdfFromCanvases(canvases);
}

module.exports = { scannedPdf, pdfFromCanvases, canvas, drawText, drawRule, GLYPHS };
