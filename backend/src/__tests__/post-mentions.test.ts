import { postMentionNames } from '../services/post-mentions';

describe('published mention parsing', () => {
  it('deduplicates repeated case-insensitive names and accepts punctuation', () => {
    expect(postMentionNames('Hey @anime (@ANIME), meet @other!')).toEqual(['anime', 'other']);
  });
  it('does not treat emails, URLs, partial usernames or oversized names as mentions', () => {
    expect(postMentionNames('a@anime.com https://example.com/@anime @x @' + 'a'.repeat(31))).toEqual([]);
  });
  it('caps the number of recipients', () => {
    expect(postMentionNames(Array.from({ length: 60 }, (_, i) => '@user' + i).join(' '))).toHaveLength(50);
  });
});
