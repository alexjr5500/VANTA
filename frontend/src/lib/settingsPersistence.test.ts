import {describe,expect,it} from 'vitest';
import {localSettingsValue,settingsScrollKey,isSettingsPage,parseSettingsScrollOffset} from './settingsPersistence';
describe('settings persistence',()=>{
 it('ignores corrupt, unknown and wrongly typed preferences',()=>{
  const defaults={autoplay:true,quality:'auto'};
  expect(localSettingsValue('{"autoplay":false,"quality":"bogus","extra":true}',defaults)).toEqual({autoplay:false,quality:'auto'});
  expect(localSettingsValue('{"autoplay":"false"}',defaults)).toEqual(defaults);
  expect(localSettingsValue('broken',defaults)).toEqual(defaults);
  expect(localSettingsValue('{"speed":"2"}',{speed:'1'})).toEqual({speed:'2'});
 });
 it('treats both settings hubs as scroll pages, not profile viewers',()=>{
  expect(['/settings','/profile/settings','/settings/chat'].every(isSettingsPage)).toBe(true);
  expect(['/profile','/profile/alex','/settings-other'].some(isSettingsPage)).toBe(false);
  expect(parseSettingsScrollOffset('123')).toBe(123);
  for(const raw of [null,'NaN','-1','Infinity'])expect(parseSettingsScrollOffset(raw)).toBe(0);
 });
 it('restores the hub only when returning to the hub, not when opening a subpage',()=>{
  expect(settingsScrollKey('/profile/settings')).toBe(settingsScrollKey('/settings'));
  expect(settingsScrollKey('/settings/chat')).not.toBe(settingsScrollKey('/settings'));
 });
});
