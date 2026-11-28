import {mayShowLabeledContent,sensitiveFilter} from '../services/sensitive-content.service';
jest.mock('../prisma',()=>({prisma:{}}));
describe('sensitive content feed preference',()=>{
  const now=new Date('2026-11-28T00:00:00Z');
  test('default and unknown age remain restrictive',()=>{
    expect(mayShowLabeledContent(null,false,now)).toBe(false);
    expect(mayShowLabeledContent(new Date('1990-01-01'),undefined,now)).toBe(false);
    expect(mayShowLabeledContent(new Date('2009-01-01'),false,now)).toBe(false);
  });
  test('only adults who opt in can see labeled content in supported feeds',()=>{
    expect(mayShowLabeledContent(new Date('2008-11-28'),false,now)).toBe(true);
    expect(mayShowLabeledContent(new Date('2008-11-29'),false,now)).toBe(false);
    expect(sensitiveFilter(true)).toEqual({sensitiveContent:false});
    expect(sensitiveFilter(false)).toEqual({});
  });
});
