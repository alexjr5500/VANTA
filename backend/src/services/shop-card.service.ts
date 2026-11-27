import Stripe from 'stripe';
import type { ShopCardCheckout } from '@prisma/client';
import { prisma } from '../prisma';
import { shopCardEnabled } from '../config/shop-card.config';
import { BADGE_PLAN_BY_ID } from '../config/verification-badge.config';
import { VANTA_COIN_PACKAGES, coinsToUsd } from '../config/wallet.config';
import { createCoinPaymentSimulateToken } from '../config/coin-payments.config';
import { requireAppOrigin } from '../utils/app-origin';
import { resolveShopGiftRecipient } from './shop-gift.service';
import { walletService } from './wallet.service';
import { verificationPaymentService } from './verification-payment.service';

function stripeClient() {
  if (!shopCardEnabled()) throw new Error('Card test checkout unavailable');
  return new Stripe(process.env.VANTA_SHOP_STRIPE_SECRET_KEY!);
}
function cents(n: number) {
  const value = Math.round(n * 100);
  if (!Number.isSafeInteger(value) || value <= 0 || Math.abs(n - value / 100) > 1e-8) throw new Error('Invalid catalog price');
  return value;
}
export function isStripeTestCheckoutUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password && !u.port && u.pathname.startsWith('/c/pay/cs_test_'); } catch { return false; }
}
async function orderFor(card: ShopCardCheckout) {
  if (card.product === 'coins') return prisma.purchaseOrder.findFirst({ where: { id: card.orderId, userId: card.payerId, provider: 'stripe', paymentMethod: 'stripe-card', paymentMode: 'test' } });
  if (card.product === 'badge') return prisma.verificationPurchase.findFirst({ where: { id: card.orderId, userId: card.payerId, network: 'stripe-card', paymentMode: 'test' } });
  throw new Error('Invalid product');
}
export async function createShopCardCheckout(payerId: string, input: Record<string, unknown>) {
  const stripe = stripeClient();
  if (input.renew === true) throw new Error('Recurring card billing is not enabled');
  const recipientUserId = await resolveShopGiftRecipient(payerId, input.recipientId);
  if (input.product !== 'coins' && input.product !== 'badge') throw new Error('Invalid product');
  const product = input.product;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const sessionExpiry = Math.floor(Date.now() / 1000) + 35 * 60;
  const origin = requireAppOrigin();
  const card = await prisma.$transaction(async tx => {
    let orderId: string, amountCents: number;
    if (product === 'coins') {
      let coins: number, amount: number, packageId: string | null = null, packageName = 'Custom amount';
      if (input.packageId === 'custom') {
        if (typeof input.customCoins !== 'number' || !Number.isSafeInteger(input.customCoins) || input.customCoins < 100 || input.customCoins > 100000) throw new Error('Invalid custom coin quantity');
        coins = input.customCoins; amount = coinsToUsd(coins);
      } else {
        const catalog = VANTA_COIN_PACKAGES.find(p => p.id === input.packageId);
        if (!catalog) throw new Error('Unknown coin package');
        const row = await tx.sparkCoinPackage.findUnique({ where: { id: catalog.id } });
        if (!row?.isActive || row.coins !== catalog.coins || row.price !== catalog.price) throw new Error('Coin package unavailable');
        coins = row.coins; amount = row.price; packageId = row.id; packageName = row.name;
      }
      amountCents = cents(amount);
      const order = await tx.purchaseOrder.create({ data: { userId: payerId, recipientUserId, packageId, packageName, coins, amount, currency: 'USD', provider: 'stripe', paymentMethod: 'stripe-card', paymentMode: 'test', expiresAt, status: 'PENDING' } });
      orderId = order.id;
    } else {
      const plan = typeof input.planId === 'string' ? BADGE_PLAN_BY_ID.get(input.planId) : undefined;
      if (!plan) throw new Error('Unknown badge plan');
      const row = await tx.subscriptionPlan.findUnique({ where: { id: plan.id } });
      if (!row?.isActive || row.price !== plan.priceUSD || row.durationMonths !== plan.durationMonths || row.badgeType !== plan.badgeType) throw new Error('Badge plan unavailable');
      if (recipientUserId && await tx.verificationBadge.findFirst({ where: { userId: recipientUserId, status: 'ACTIVE' } })) throw new Error('Recipient already has an active badge');
      amountCents = cents(plan.priceUSD);
      const order = await tx.verificationPurchase.create({ data: { userId: payerId, recipientUserId, planId: plan.id, amount: plan.priceUSD, currency: 'USD', network: 'stripe-card', paymentMode: 'test', expiresAt, status: 'PENDING' } });
      orderId = order.id;
    }
    return tx.shopCardCheckout.create({ data: { orderId, payerId, product, amountCents, expiresAt } });
  });
  const order = await orderFor(card);
  if (!order) throw new Error('Order unavailable');
  const returnUrl = new URL('/balance', origin);
  returnUrl.searchParams.set('shopCard', card.orderId);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], client_reference_id: card.id,
    success_url: returnUrl.href, cancel_url: returnUrl.href,
    expires_at: sessionExpiry,
    metadata: { vantaCheckoutId: card.id, vantaOrderId: card.orderId, product },
    payment_intent_data: { metadata: { vantaCheckoutId: card.id, vantaOrderId: card.orderId } },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: card.amountCents, product_data: { name: product === 'coins' && 'coins' in order ? order.coins + ' VANTA Coins (test)' : 'VANTA Verification Badge (test)' } } }],
  }, { idempotencyKey: 'vanta-shop-card-test:' + card.id });
  if (session.livemode || !session.id.startsWith('cs_test_') || !isStripeTestCheckoutUrl(session.url)) throw new Error('Unexpected provider session');
  const bound = await prisma.shopCardCheckout.updateMany({ where: { id: card.id, sessionId: null }, data: { sessionId: session.id } });
  if (bound.count !== 1) throw new Error('Could not bind checkout session');
  return { orderId: card.orderId, product, amount: card.amountCents / 100, currency: 'USD', checkoutUrl: session.url, mode: 'card-test', expiresAt: card.expiresAt.toISOString() };
}

export function validatePaidCardSession(card: Pick<ShopCardCheckout, 'id' | 'orderId' | 'product' | 'amountCents' | 'sessionId'>, session: Stripe.Checkout.Session): string {
  const intent = session.payment_intent;
  if (session.livemode || session.id !== card.sessionId || session.mode !== 'payment' || session.status !== 'complete' || session.payment_status !== 'paid' || session.currency !== 'usd' || session.amount_total !== card.amountCents || session.client_reference_id !== card.id || session.metadata?.vantaCheckoutId !== card.id || session.metadata?.vantaOrderId !== card.orderId || session.metadata?.product !== card.product || !intent || typeof intent === 'string') throw new Error('Provider session not verified as paid');
  const charge = intent.latest_charge;
  if (intent.livemode || intent.status !== 'succeeded' || intent.currency !== 'usd' || intent.amount !== card.amountCents || intent.amount_received !== card.amountCents || intent.metadata.vantaCheckoutId !== card.id || intent.metadata.vantaOrderId !== card.orderId || !charge || typeof charge === 'string' || charge.livemode || !charge.paid || !charge.captured || charge.refunded || charge.amount_refunded !== 0 || charge.disputed || charge.amount !== card.amountCents || charge.currency !== 'usd') throw new Error('Provider payment not verified');
  return intent.id;
}
async function reconcile(card: ShopCardCheckout) {
  const stripe = stripeClient();
  const order = await orderFor(card);
  if (!order || cents(order.amount) !== card.amountCents) throw new Error('Order mismatch');
  if (order.status === 'COMPLETED') return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
  if (!card.sessionId || !['PENDING', 'PROCESSING', 'PAID'].includes(order.status)) return { success: false, status: 'RECONCILIATION' };
  const session = await stripe.checkout.sessions.retrieve(card.sessionId, { expand: ['payment_intent.latest_charge'] });
  if (session.status === 'expired') {
    if (card.product === 'coins') await prisma.purchaseOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    else await prisma.verificationPurchase.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return { success: false, status: 'EXPIRED' };
  }
  if (session.payment_status !== 'paid') return { success: false, status: 'PENDING' };
  const paymentIntentId = validatePaidCardSession(card, session);
  if (Date.now() >= card.expiresAt.getTime()) return { success: false, status: 'RECONCILIATION' };
  const claim = await prisma.shopCardCheckout.updateMany({ where: { id: card.id, sessionId: card.sessionId, OR: [{ paymentIntentId: null }, { paymentIntentId }] }, data: { paymentIntentId, paidAt: new Date() } });
  if (claim.count !== 1) throw new Error('Payment already attached elsewhere');
  // The signed simulation token stays on the server. Card orders additionally
  // require the durable provider-paid record in both fulfillment services.
  const simulateToken = createCoinPaymentSimulateToken(order);
  if (card.product === 'coins') await walletService.completeCoinPurchase(card.payerId, card.orderId, { mode: 'test', simulateToken, providerOrderId: paymentIntentId, verification: { stripePaymentIntentId: paymentIntentId } });
  else await verificationPaymentService.completeTestPurchase(card.payerId, card.orderId, { simulateToken });
  await prisma.shopCardCheckout.updateMany({ where: { id: card.id, paymentIntentId }, data: { settledAt: new Date() } });
  return { success: true, status: 'COMPLETED', ...('coins' in order ? { coins: order.coins } : {}) };
}
export async function checkShopCardCheckout(payerId: string, orderId: string) {
  const card = await prisma.shopCardCheckout.findFirst({ where: { payerId, orderId } });
  if (!card) throw new Error('Checkout not found');
  return reconcile(card);
}
export async function listShopCardCheckouts(payerId: string) {
  stripeClient();
  const cards = await prisma.shopCardCheckout.findMany({ where: { payerId, sessionId: { not: null }, settledAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 10 });
  return { checkouts: cards.map(c => ({ orderId: c.orderId, product: c.product, amount: c.amountCents / 100, expiresAt: c.expiresAt.toISOString() })) };
}
export async function resumeShopCardCheckout(payerId: string, orderId: string) {
  const stripe = stripeClient();
  const card = await prisma.shopCardCheckout.findFirst({ where: { payerId, orderId } });
  if (!card?.sessionId) throw new Error('Checkout not found');
  const order = await orderFor(card);
  if (!order) throw new Error('Order unavailable');
  const session = await stripe.checkout.sessions.retrieve(card.sessionId);
  if (session.livemode || session.client_reference_id !== card.id) throw new Error('Session mismatch');
  return { orderId, product: card.product, amount: card.amountCents / 100, currency: 'USD', mode: 'card-test', expiresAt: card.expiresAt.toISOString(), checkoutUrl: session.status === 'open' && isStripeTestCheckoutUrl(session.url) ? session.url : null,
    status: order.status, ...('coins' in order ? { coins: order.coins } : { planId: order.planId }), recipientUserId: order.recipientUserId };
}
export async function handleShopCardWebhook(raw: string, signature: string) {
  const stripe = stripeClient();
  const event = stripe.webhooks.constructEvent(raw, signature, process.env.VANTA_SHOP_STRIPE_WEBHOOK_SECRET!);
  if (event.livemode) throw new Error('Live events are not accepted');
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.expired') return { received: true };
  const session = event.data.object as Stripe.Checkout.Session;
  const card = await prisma.shopCardCheckout.findUnique({ where: { sessionId: session.id } });
  if (!card) throw new Error('Unknown card session');
  const result = await reconcile(card);
  return { received: true, status: result.status };
}
