import { Bookmark, type LucideProps } from 'lucide-react';
import { createElement } from 'react';

type Props = Omit<LucideProps, 'fill' | 'color' | 'stroke'> & { saved?: boolean };

/** A saved item always uses the same gold stroke and fill, even inside a
 * neutral/hovered action button. Unsaved items retain their outline. */
export default function BookmarkIcon({ saved = false, style, ...props }: Props) {
  return createElement(Bookmark, { ...props, 'aria-hidden': true, fill: saved ? 'currentColor' : 'none', style: { ...style, ...(saved ? { color: 'var(--vanta-gold-bright, #dfbd55)' } : {}) } });
}
