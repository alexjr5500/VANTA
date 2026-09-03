import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { feedService } from '../src/services/feed.service';
import { giftService } from '../src/services/gift.service';

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  const [sender, receiver, blockedAuthor, moderator] = await Promise.all([
    prisma.user.create({ data: { username: `qa_sender_${suffix}`, status: 'ACTIVE' } }),
    prisma.user.create({ data: { username: `qa_receiver_${suffix}`, status: 'ACTIVE' } }),
    prisma.user.create({ data: { username: `qa_blocked_${suffix}`, status: 'ACTIVE' } }),
    prisma.user.create({ data: { username: `qa_moderator_${suffix}`, status: 'ACTIVE', role: 'MODERATOR' } }),
  ]);
  const post = await prisma.post.create({ data: { authorId: receiver.id, content: `QA comment post ${suffix}` } });

  const first = await feedService.commentOnPost(post.id, sender.id, 'First searchable comment');
  const second = await feedService.commentOnPost(post.id, sender.id, 'Second pagination comment');
  const third = await feedService.commentOnPost(post.id, sender.id, 'Third pagination comment');
  const reply = await feedService.commentOnPost(post.id, receiver.id, 'A real reply', first.comment.id);
  assert.equal(reply.comment.parentId, first.comment.id);

  const newestPage = await feedService.getPostComments(post.id, sender.id, undefined, 2, 'newest');
  assert.equal(newestPage.items.length, 2);
  assert.ok(newestPage.nextCursor);
  const nextPage = await feedService.getPostComments(post.id, sender.id, newestPage.nextCursor, 2, 'newest');
  assert.ok(nextPage.items.length >= 1);

  const searched = await feedService.getPostComments(post.id, sender.id, undefined, 20, 'newest', 'searchable');
  assert.deepEqual(searched.items.map((item: any) => item.id), [first.comment.id]);

  const liked = await feedService.likeComment(first.comment.id, receiver.id);
  assert.deepEqual(liked, { liked: true, likeCount: 1 });
  const top = await feedService.getPostComments(post.id, sender.id, undefined, 20, 'top');
  assert.equal(top.items[0].id, first.comment.id);
  const unliked = await feedService.likeComment(first.comment.id, receiver.id);
  assert.deepEqual(unliked, { liked: false, likeCount: 0 });

  const hidden = await feedService.commentOnPost(post.id, blockedAuthor.id, 'This author is blocked');
  await prisma.blockedUser.create({ data: { userId: sender.id, targetId: blockedAuthor.id } });
  const filtered = await feedService.getPostComments(post.id, sender.id, undefined, 20, 'newest');
  assert.ok(!filtered.items.some((item: any) => item.id === hidden.comment.id));

  const ownDelete = await feedService.deleteComment(second.comment.id, sender.id);
  assert.equal(ownDelete.deleted, true);
  const moderatedDelete = await feedService.deleteComment(hidden.comment.id, moderator.id, 'MODERATOR');
  assert.equal(moderatedDelete.deleted, true);
  assert.equal(await prisma.postComment.count({ where: { postId: post.id } }), moderatedDelete.commentCount);
  assert.equal(await prisma.postCommentLike.count({ where: { commentId: first.comment.id } }), 0);
  assert.ok(await prisma.postComment.findUnique({ where: { id: third.comment.id } }));

  await Promise.all([
    prisma.wallet.create({ data: { userId: sender.id, coinBalance: 1_000_000 } }),
    prisma.wallet.create({ data: { userId: receiver.id } }),
  ]);

  const requiredSlugs = ['heart', 'rose', 'teddy-bear', 'crown', 'diamond', 'yacht'];
  const catalog = await giftService.listGifts();
  const required = requiredSlugs.map(slug => {
    const gift = catalog.find(item => item.slug === slug);
    assert.ok(gift, `Missing active gift: ${slug}`);
    return gift;
  });
  assert.equal((await giftService.listGifts('heart')).some(gift => gift.slug === 'heart'), true);
  assert.equal((await giftService.listGifts('teddy')).some(gift => gift.slug === 'teddy-bear'), true);
  for (const gift of required) {
    assert.equal((await giftService.listGifts(undefined, gift.category)).some(item => item.id === gift.id), true);
  }

  const openingBalance = 1_000_000;
  let expectedBalance = openingBalance;
  for (const gift of required) {
    const sent = await giftService.sendGift(sender.id, receiver.id, gift.id);
    expectedBalance -= gift.price;
    assert.equal(sent.remainingBalance, expectedBalance);
    assert.equal(sent.transaction.status, 'COMPLETED');
    assert.equal(sent.transaction.amount, gift.price);
  }

  const history = await giftService.getGiftHistory(sender.id);
  for (const slug of requiredSlugs) assert.ok(history.some(item => item.gift.slug === slug));
  const senderWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sender.id } });
  const receiverWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: receiver.id } });
  assert.equal(senderWallet.coinBalance, expectedBalance);
  assert.equal(senderWallet.totalGiftsSent, required.length);
  assert.equal(receiverWallet.totalGiftsReceived, required.length);
  assert.equal(await prisma.giftTransaction.count({ where: { senderId: sender.id } }), required.length);
  assert.equal(await prisma.walletTransaction.count({ where: { userId: sender.id, type: 'GIFT_SENT' } }), required.length);
  assert.equal(await prisma.walletTransaction.count({ where: { userId: receiver.id, type: 'GIFT_RECEIVED' } }), required.length);

  await prisma.wallet.update({ where: { userId: sender.id }, data: { coinBalance: 0 } });
  const beforeFailedSend = {
    sender: await prisma.wallet.findUniqueOrThrow({ where: { userId: sender.id } }),
    receiver: await prisma.wallet.findUniqueOrThrow({ where: { userId: receiver.id } }),
    gifts: await prisma.giftTransaction.count({ where: { senderId: sender.id } }),
    ledger: await prisma.walletTransaction.count({ where: { OR: [{ userId: sender.id }, { userId: receiver.id }] } }),
  };
  await assert.rejects(
    giftService.sendGift(sender.id, receiver.id, required[0].id),
    /Insufficient coins/,
  );
  const afterFailedSend = {
    sender: await prisma.wallet.findUniqueOrThrow({ where: { userId: sender.id } }),
    receiver: await prisma.wallet.findUniqueOrThrow({ where: { userId: receiver.id } }),
    gifts: await prisma.giftTransaction.count({ where: { senderId: sender.id } }),
    ledger: await prisma.walletTransaction.count({ where: { OR: [{ userId: sender.id }, { userId: receiver.id }] } }),
  };
  assert.deepEqual(afterFailedSend, beforeFailedSend, 'Failed gift send changed wallet or transaction state');

  console.log(JSON.stringify({
    comments: { load: true, create: true, reply: true, like: true, unlike: true, delete: true, search: true, top: true, pagination: true, blockedFiltering: true },
    gifts: { catalog: catalog.length, sent: requiredSlugs, search: true, categories: true, history: true, atomicInsufficientBalance: true },
    wallet: { openingBalance, closingBalance: expectedBalance, senderLedgerEntries: required.length, receiverLedgerEntries: required.length },
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });