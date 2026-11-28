import {parseWebLinkMode,shouldUseSameTab} from './externalLinkPreferences';
describe('external link preference',()=>{
 test('defaults to new tab',()=>{expect(parseWebLinkMode(null)).toBe('new_tab');expect(parseWebLinkMode('unknown')).toBe('new_tab');});
 test('only ordinary external web URLs in browser honor same-tab',()=>{
   expect(shouldUseSameTab('same_tab','https://example.com','https://vanta.test',false)).toBe(true);
   expect(shouldUseSameTab('same_tab','https://vanta.test/chat','https://vanta.test',false)).toBe(false);
   expect(shouldUseSameTab('same_tab','javascript:alert(1)','https://vanta.test',false)).toBe(false);
   expect(shouldUseSameTab('same_tab','https://user:password@example.com','https://vanta.test',false)).toBe(false);
   expect(shouldUseSameTab('same_tab','https://example.com','https://vanta.test',true)).toBe(false);
 });
});
