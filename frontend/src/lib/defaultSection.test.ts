import {describe,it,expect} from 'vitest';
import {parseDefaultSection} from './defaultSection';
describe('default section preferences', () => {
  it('allows only sections supported by the selected surface', () => {
    expect(parseDefaultSection('timeline','following')).toBe('following');
    expect(parseDefaultSection('explore','homes')).toBe('homes');
    expect(parseDefaultSection('live','popular')).toBe('popular');
    expect(parseDefaultSection('timeline','popular')).toBe('forYou');
    expect(parseDefaultSection('live',null)).toBe('forYou');
  });
});
