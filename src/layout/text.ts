/**
 * How wide a piece of text will be drawn, with no DOM to ask.
 *
 * The boxes size themselves to the names in them, so the layout has to know how wide a name is
 * *before* anything is rendered -- and `layout/` is a pure function from document to coordinates,
 * with no browser anywhere near it. Measuring through a canvas would put a DOM in the middle of
 * the one seam this project keeps clean, and would answer differently in a test than in the app.
 *
 * So the widths are a table: an advance per character, as a fraction of the font size. The values
 * are not invented -- they were read out of `canvas.measureText` in Chromium for the shell's own
 * font stack, which resolves to Segoe UI on Windows. The other faces in that stack (San
 * Francisco, Roboto) agree with it to within a few percent at these sizes, and `SLACK` is what
 * covers the difference.
 *
 * Accents are measured on the letter underneath. Decomposing and dropping the combining marks
 * means `Ñ` costs what `N` costs -- which is what the font does too, measured -- and it keeps the
 * table to the range it was measured over.
 */

/**
 * Advance widths as a fraction of the font size, measured rather than guessed.
 *
 * Only the characters a name or a pair of years is made of. Anything else falls back below.
 */
const ADVANCE: Readonly<Record<string, number>> = {
  a: 0.509,
  b: 0.588,
  c: 0.462,
  d: 0.589,
  e: 0.523,
  f: 0.313,
  g: 0.589,
  h: 0.566,
  i: 0.242,
  j: 0.242,
  k: 0.497,
  l: 0.242,
  m: 0.861,
  n: 0.566,
  o: 0.586,
  p: 0.588,
  q: 0.589,
  r: 0.348,
  s: 0.424,
  t: 0.339,
  u: 0.566,
  v: 0.479,
  w: 0.723,
  x: 0.459,
  y: 0.484,
  z: 0.452,
  A: 0.645,
  B: 0.573,
  C: 0.619,
  D: 0.701,
  E: 0.506,
  F: 0.488,
  G: 0.686,
  H: 0.71,
  I: 0.266,
  J: 0.357,
  K: 0.58,
  L: 0.471,
  M: 0.898,
  N: 0.748,
  O: 0.754,
  P: 0.56,
  Q: 0.754,
  R: 0.598,
  S: 0.531,
  T: 0.524,
  U: 0.687,
  V: 0.621,
  W: 0.934,
  X: 0.59,
  Y: 0.553,
  Z: 0.57,
  ' ': 0.274,
  '.': 0.217,
  ',': 0.217,
  ':': 0.217,
  ';': 0.217,
  "'": 0.23,
  '!': 0.284,
  '|': 0.239,
  '(': 0.302,
  ')': 0.302,
  '[': 0.302,
  ']': 0.302,
  '{': 0.302,
  '}': 0.302,
  '/': 0.39,
  '\\': 0.39,
  '-': 0.4,
  '–': 0.5,
  '—': 1,
  '"': 0.392,
  '’': 0.23,
};

/** What the table charges for a character it does not name. */
const DIGIT = 0.539;
const OTHER = 0.6;
/** A CJK glyph is square, and half a table's width out if charged as a letter. */
const IDEOGRAPH = 1;

/**
 * Enough slack that the estimate lands wide rather than narrow.
 *
 * One font's metrics stand in for whichever of the stack the reader actually has. Being a few
 * percent generous costs a few pixels of air inside a box; being a few percent mean costs a
 * clipped name, which is the whole complaint this answers.
 */
const SLACK = 1.05;

function advance(character: string): number {
  const known = ADVANCE[character];
  if (known !== undefined) return known;
  if (character >= '0' && character <= '9') return DIGIT;
  /* Everything from the CJK block up. Below it sits Latin, Greek and Cyrillic, all of them
     letter-width. */
  if (character >= '\u2e80') return IDEOGRAPH;
  return OTHER;
}

/** Strip the combining marks, so an accented letter is charged as the letter it sits on. */
function bare(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/** How wide `text` will draw at `size` pixels, near enough, and never much under. */
export function measureText(text: string, size: number): number {
  if (text === '') return 0;
  let ems = 0;
  for (const character of bare(text)) ems += advance(character);
  return ems * size * SLACK;
}

/**
 * The most of `text` that fits in `width`, with an ellipsis where it had to be cut.
 *
 * A box is sized to its name, so almost nothing reaches here -- only a name past the widest box
 * the chart will draw. That cap exists because one absurd name should not stretch a whole row,
 * and this is what keeps the overflow inside the box rather than across its neighbour.
 */
export function fitText(text: string, width: number, size: number): string {
  if (width <= 0) return '';
  if (measureText(text, size) <= width) return text;

  let kept = '';
  let used = measureText('…', size);
  for (const character of text) {
    const next = used + measureText(character, size);
    if (next > width) break;
    kept += character;
    used = next;
  }
  return kept === '' ? '…' : `${kept.trimEnd()}…`;
}
