import { isPublicIPv4, previewUrl, parsePreview, rasterMatches, loadLinkPreview } from '../services/link-preview.service';
import { lookup } from 'node:dns/promises';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

describe('link previews', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','203.0.113.1','198.51.100.1','::1','::ffff:127.0.0.1'])('rejects non-public IP %s', ip => {
    expect(isPublicIPv4(ip)).toBe(false);
  });
  it('accepts ordinary public IPv4', () => expect(isPublicIPv4('8.8.8.8')).toBe(true));
  it.each(['http://127.1/','http://2130706433/','http://0x7f000001/','http://[::1]/','http://localhost/','http://service.internal/','ftp://public.com/','https://name:password@public.com/','https://public.com:444/','https://public.com/?token=abc','https://public.com/?X-Amz-Signature=abc','https://public.com/reset-password/abc'])('does not prefetch %s', value => {
    expect(previewUrl(value)).toBeNull();
  });
  it('preserves an ordinary public query and removes the fragment', () => {
    expect(previewUrl('https://public.com/watch?v=123#fragment')?.href).toBe('https://public.com/watch?v=123');
  });
  it('fails closed on a DNS answer containing private addresses', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(loadLinkPreview('https://public.com/')).rejects.toThrow('Non-public address');
  });
  it('extracts Open Graph, decodes entities and skips comments and scripts', () => {
    const result = parsePreview('<head><!-- <meta property="og:title" content="Fake"> --><script><meta property="og:title" content="Bad"></script><meta content="News &amp; updates" property="og:title"><meta name="description" content="A story"><meta property="og:image" content="/card.png"><meta property="og:site_name" content="News"></head>');
    expect(result).toEqual({ title: 'News & updates', description: 'A story', imageUrl: '/card.png', siteName: 'News' });
  });
  it('uses ordinary title and Twitter metadata, never body markup', () => {
    const result = parsePreview('<head><title>Example</title><meta name="twitter:description" content="Summary"></head><body><meta property="og:image" content="bad"></body>');
    expect(result.title).toBe('Example');
    expect(result.description).toBe('Summary');
    expect(result.imageUrl).toBeUndefined();
  });
  it('bounds long metadata and rejects non-raster content', () => {
    expect(parsePreview('<title>' + 'a'.repeat(1000) + '</title>').title).toHaveLength(180);
    expect(rasterMatches(Buffer.from('<svg/>'), 'image/png')).toBe(false);
    expect(rasterMatches(Buffer.from([255,216,255]), 'image/jpeg')).toBe(true);
    expect(rasterMatches(Buffer.from('<svg/>'), 'image/svg+xml')).toBe(false);
  });
});
