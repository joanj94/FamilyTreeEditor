/**
 * The estimate the boxes are sized from.
 *
 * It cannot be exact -- the reader's font is whichever of the stack they have -- so what is
 * asserted is what the layout actually relies on: that it is monotone, that it errs wide rather
 * than narrow, and that an accented name costs what the unaccented one does. A measurement that
 * came in under the truth is the fault this whole module exists to prevent, so that is the corner
 * pinned hardest.
 */
import { describe, expect, it } from 'vitest';

import { fitText, measureText } from './text.js';

const SIZE = 15;

describe('measuring a name', () => {
  it('charges nothing for nothing', () => {
    expect(measureText('', SIZE)).toBe(0);
  });

  it('grows with the text', () => {
    expect(measureText('Mariana', SIZE)).toBeGreaterThan(measureText('Ana', SIZE));
  });

  it('scales with the type size', () => {
    expect(measureText('Ana', 30)).toBeCloseTo(measureText('Ana', 15) * 2, 6);
  });

  it('charges an accented letter what the letter costs', () => {
    // Otherwise every Spanish, French or Portuguese surname is measured by the fallback and the
    // box is sized for a name nobody wrote.
    expect(measureText('Fernández', SIZE)).toBeCloseTo(measureText('Fernandez', SIZE), 6);
  });

  it('charges a wide letter more than a thin one', () => {
    expect(measureText('mmmm', SIZE)).toBeGreaterThan(measureText('llll', SIZE));
  });

  it('adds up the same in pieces as it does whole', () => {
    // `fitText` measures a character at a time against a width measured whole; if those two
    // disagreed it would cut a name that fitted.
    const whole = measureText('Fernández', SIZE);
    const pieces = [...'Fernández'].reduce(
      (total, character) => total + measureText(character, SIZE),
      0,
    );
    expect(pieces).toBeCloseTo(whole, 6);
  });

  it('does not measure a name short', () => {
    /* Read out of `canvas.measureText` in Chromium, for the shell's own font stack at the two
       sizes a box uses. The estimate has to sit at or above each of them: a name measured short
       is a name drawn through the side of its box. */
    const drawn: readonly [string, number, number][] = [
      ['Ana Ruiz', 15, 57.8],
      ['GivenA SurnameB', 15, 118.4],
      ['María del Carmen Fernández', 15, 190.1],
      ['María del Carmen Fernández de la Vega', 15, 263],
      ['Wilhelmina Wolfgang', 15, 142.4],
      ['1901–1978', 12, 57.8],
    ];
    for (const [text, size, width] of drawn) {
      expect(measureText(text, size)).toBeGreaterThanOrEqual(width);
    }
  });

  it('does not measure a name wildly long either', () => {
    // Slack is there to cover the fonts the table was not measured on. Too much of it and every
    // box carries dead space, which is its own kind of unreadable chart.
    expect(measureText('María del Carmen Fernández', 15)).toBeLessThan(190.1 * 1.15);
  });
});

describe('cutting a name that will not fit', () => {
  it('leaves a name that fits alone', () => {
    expect(fitText('Ana Ruiz', 400, SIZE)).toBe('Ana Ruiz');
  });

  it('cuts to inside the width it was given', () => {
    const cut = fitText('María del Carmen Fernández de la Vega', 120, SIZE);
    expect(cut).not.toBe('María del Carmen Fernández de la Vega');
    expect(cut.endsWith('…')).toBe(true);
    expect(measureText(cut, SIZE)).toBeLessThanOrEqual(120);
  });

  it('keeps as much as the width allows', () => {
    const wide = fitText('María del Carmen Fernández de la Vega', 200, SIZE);
    const narrow = fitText('María del Carmen Fernández de la Vega', 120, SIZE);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('does not leave a space hanging before the ellipsis', () => {
    const room = measureText('Ana ', SIZE) + measureText('…', SIZE);
    expect(fitText('Ana Ruiz', room, SIZE)).toBe('Ana…');
  });

  it('draws nothing where there is no room at all', () => {
    expect(fitText('Ana Ruiz', 0, SIZE)).toBe('');
  });
});
