'use client';
import VantaShop from '@/components/wallet/VantaShop';
import type { BadgePurchasePlan } from '@/lib/verificationApi';
interface Props { open: boolean; plan: BadgePurchasePlan | null; onClose: () => void; onSuccess?: () => void; }
export default function VerificationPurchaseModal({ open, plan, onClose, onSuccess }: Props) {
  return <VantaShop open={open} initialProduct="badge" initialPlan={plan} onClose={onClose} onBadgeSuccess={onSuccess}/>;
}
