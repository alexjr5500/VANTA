import { describe, expect, it } from 'vitest';
import { applyMention, mentionAtCaret } from '../components/social/MentionSuggestions';
import { highlightedParts } from '../components/social/MentionTextarea';

describe('shared VANTA mention autocomplete', () => {
  it('opens on one typed character after @', () => {
    expect(mentionAtCaret('Hello @a', 8)).toEqual({ prefixStart: 6, end: 8, query: 'a' });
  });

  it('uses the caret position and does not confuse email addresses or old mentions', () => {
    expect(mentionAtCaret('help@sample.com', 5)).toBeNull();
    expect(mentionAtCaret('@alex hi', 8)).toBeNull();
    expect(mentionAtCaret('hello @alex and @bo later', 18)).toEqual({ prefixStart: 16, end: 18, query: 'b' });
  });

  it('replaces only the active prefix with the selected canonical username', () => {
    const input = 'hello @ali and #VANTA';
    const mention = mentionAtCaret(input, 10)!;
    expect(applyMention(input, mention, 'alice')).toEqual({
      value: 'hello @alice  and #VANTA',
      caret: 13,
    });
  });
});

describe('typing @ and # in VANTA gold', () => {
  it('marks tags but not ordinary words', () => {
    expect(highlightedParts('Hi @alex and #VANTA!')).toEqual([
      { text: 'Hi ', highlighted: false },
      { text: '@alex', highlighted: true },
      { text: ' and ', highlighted: false },
      { text: '#VANTA', highlighted: true },
      { text: '!', highlighted: false },
    ]);
  });

  it('does not recolor email or URL fragments as tags', () => {
    expect(highlightedParts('contact me@email.com')).toEqual([
      { text: 'contact me@email.com', highlighted: false },
    ]);
  });
});
