import { describe, expect, it } from 'vitest';
import { fill } from '../../src/i18n';

describe('fill', () => {
  it('substitutes every named slot in one pass', () => {
    expect(fill('refused {n} of {total}', { n: 3, total: 7 })).toBe('refused 3 of 7');
  });

  it('leaves a slot with no matching parameter visible', () => {
    // Silently deleting it would turn "3 of 5 failed" into "of failed": a missing
    // value has to look wrong on screen instead of reading like a sentence.
    expect(fill('refused {n} of {total}', { n: 3 })).toBe('refused 3 of {total}');
  });

  it('takes numbers because callers count things', () => {
    expect(fill('{count} topics', { count: 12 })).toBe('12 topics');
  });

  it('treats $ as a literal character', () => {
    // String.prototype.replace interprets $&, $1, $' in a *string* replacement, so a
    // payload containing them used to corrupt the sentence. The function form does not.
    expect(fill('sent {n}', { n: '$&$1$`\'' })).toBe("sent $&$1$`'");
  });

  it('fills the same slot more than once', () => {
    expect(fill('{x} and {x} again', { x: 'secret/#' })).toBe('secret/# and secret/# again');
  });

  it('returns a plain string untouched', () => {
    expect(fill('No slots here', { n: 1 })).toBe('No slots here');
  });
});
