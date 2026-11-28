jest.mock('../prisma',()=>({prisma:{$queryRaw:jest.fn(),$transaction:jest.fn(),uploadedFile:{updateMany:jest.fn()},attachment:{deleteMany:jest.fn()}}}));
jest.mock('../services/upload.service',()=>({uploadService:{purgeExpiredChatAsset:jest.fn()}}));
import {prisma} from '../prisma';
import {uploadService} from '../services/upload.service';
import {sweepExpiredChatMedia} from '../services/chat-media-expiry.service';
describe('expired group chat media cleanup',()=>{
  const now=new Date('2026-11-28T12:00:00Z');
  const file={id:'file',filename:'private.jpg',path:'cloudinary:image:vanta/message/private',url:'https://cdn.example/private',messageId:'message',permissions:'{"autoDeleteSeconds":86400}',createdAt:new Date('2026-11-10T12:00:00Z'),size:123};
  beforeEach(()=>{
    jest.resetAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async fn=>fn(prisma));
    (prisma.uploadedFile.updateMany as jest.Mock).mockResolvedValue({count:1});
    (prisma.attachment.deleteMany as jest.Mock).mockResolvedValue({count:1});
  });
  test('deletes storage before marking metadata and removing the attachment reference',async()=>{
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([file]).mockResolvedValueOnce([]);
    (uploadService.purgeExpiredChatAsset as jest.Mock).mockResolvedValue(undefined);
    expect(await sweepExpiredChatMedia(now)).toEqual({files:1,bytes:123,failed:0});
    expect(uploadService.purgeExpiredChatAsset).toHaveBeenCalledWith(file);
    expect(prisma.uploadedFile.updateMany).toHaveBeenCalledWith({where:{id:'file',category:'message',recordType:'Message',recordId:'message',deletedAt:null},data:{deletedAt:now}});
    expect(prisma.attachment.deleteMany).toHaveBeenCalledWith({where:{messageId:'message',url:file.url}});
    const sql=(prisma.$queryRaw as jest.Mock).mock.calls[0][0].join(' ');
    for(const term of ['FOR UPDATE OF f,m SKIP LOCKED','"ModerationQueue"','"CopyrightClaim"','"ChildSafetyFlag"','"Report"','"PropertyMedia"','"moderationOriginalPath"','c.type=\'GROUP\'','a."messageId"<>m.id'])expect(sql).toContain(term);
  });
  test('provider failure leaves the reference and deletion marker untouched for retry',async()=>{
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([file]).mockResolvedValueOnce([]);
    (uploadService.purgeExpiredChatAsset as jest.Mock).mockRejectedValue(new Error('provider offline'));
    expect(await sweepExpiredChatMedia(now)).toEqual({files:0,bytes:0,failed:1});
    expect(prisma.attachment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.uploadedFile.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.uploadedFile.updateMany).toHaveBeenCalledWith({where:{id:'file',deletedAt:null},data:{updatedAt:now}});
  });
  test('invalid or disabled exact retention never calls storage even if candidate query matched',async()=>{
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{...file,permissions:'{"autoDeleteSeconds":86400,"autoDeleteSeconds":0}'}]).mockResolvedValueOnce([]);
    expect(await sweepExpiredChatMedia(now)).toEqual({files:0,bytes:0,failed:1});
    expect(uploadService.purgeExpiredChatAsset).not.toHaveBeenCalled();
  });
});
