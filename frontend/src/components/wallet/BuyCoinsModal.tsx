'use client';
import VantaShop from './VantaShop';
interface BuyCoinsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (coins: number) => void;
}
export default function BuyCoinsModal({ open, onClose, onSuccess }: BuyCoinsModalProps) {
  return <VantaShop open={open} initialProduct="coins" onClose={onClose} onCoinsSuccess={onSuccess}/>;
}
