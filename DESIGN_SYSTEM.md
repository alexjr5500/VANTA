# VANTA Design System

## Overview
VANTA is a premium creator platform for creating, connecting, and going LIVE. The system uses a black, graphite, silver, and restrained gold design language with glassmorphism depth.

**Design Composition:**
- Black/graphite: 70–80%
- Silver/white: 15–25%
- Gold: 5–10%

Gold is an accent — used for important actions, active navigation, premium features, creator earnings, VANTA Coins, gifts, VIP/elite indicators, and premium CTAs. It must NOT dominate.

## Design Tokens

### Colors — Core Palette
```
--vanta-black:        #050505
--vanta-obsidian:     #080808
--vanta-panel:        #101010
--vanta-surface:      #161616
--vanta-elevated:     #1c1c1c
--vanta-graphite:     #202023
--vanta-gray:         #666666
--vanta-gray-light:   #8a8a8a
--vanta-silver:       #c8c8cc
--vanta-silver-bright:#f5f5f5
--vanta-white:        #f5f5f5
--vanta-pure-white:   #ffffff
```

### Colors — Gold Accent
```
--vanta-gold:         #d6a83f
--vanta-gold-bright:  #f2c75c
--vanta-gold-deep:    #a8842c
--gold-glow:          0 0 20px rgba(214, 168, 63, 0.12)
--gold-glow-strong:   0 0 32px rgba(242, 199, 92, 0.18)
--gold-border:        rgba(214, 168, 63, 0.3)
--gold-border-strong: rgba(242, 199, 92, 0.5)
--gold-bg:            rgba(214, 168, 63, 0.08)
--gold-bg-strong:     rgba(214, 168, 63, 0.14)
--gradient-gold:      linear-gradient(135deg, #f2c75c 0%, #d6a83f 55%, #a8842c 100%)
--gradient-gold-subtle: linear-gradient(135deg, rgba(242,199,92,.16) 0%, rgba(214,168,63,.06) 50%, transparent 100%)
```

### Glass Surfaces
```
--glass-bg:       rgba(255, 255, 255, 0.03)
--glass-border:   rgba(255, 255, 255, 0.06)
--glass-hover:    rgba(255, 255, 255, 0.08)
--glass-strong:   rgba(255, 255, 255, 0.08)
--glass-active:   rgba(255, 255, 255, 0.12)
```

### Borders
- `rgba(255, 255, 255, 0.08)` — default subtle border
- `rgba(255, 255, 255, 0.12)` — hover border
- `rgba(255, 255, 255, 0.2)` — active/focused border
- `var(--gold-border)` — gold accent border
- `var(--gold-border-strong)` — strong gold border

### Typography
- Font: Inter (system-ui fallback)
- Mono: JetBrains Mono (SF Mono fallback)
- Weights: 400, 500, 600, 700, 750, 800

**Type Scale Tokens:**
```
--text-display:   clamp(2.5rem, 6vw, 4.5rem) — line 1.08
--text-h1:        clamp(1.75rem, 3.5vw, 2.5rem) — line 1.15
--text-h2:        clamp(1.4rem, 2.5vw, 1.875rem) — line 1.2
--text-h3:        clamp(1.15rem, 1.8vw, 1.375rem) — line 1.3
--text-body:      0.9375rem — line 1.6
--text-secondary: 0.875rem — line 1.5
--text-caption:   0.75rem — line 1.4
--text-label:     0.6875rem — line 1.3 (uppercase, tracking 0.08em)
--text-stat:      clamp(1.75rem, 3vw, 2.5rem) — line 1.1 (tabular-nums)
```

**Utility Classes:** `.text-display`, `.text-h1`, `.text-h2`, `.text-h3`, `.text-body`, `.text-secondary`, `.text-caption`, `.text-label`, `.text-stat`, `.text-gold`, `.text-gold-gradient`

### Spacing
- 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96

### Border Radius — Progressive Scale
```
--radius-xs:  6px   small controls, tags
--radius-sm:  8px   buttons, inputs
--radius-md:  12px  cards, panels
--radius-lg:  16px  large cards, media
--radius-xl:  20px  modals, sheets
--radius-2xl: 24px  feature panels, dialogs
--radius-3xl: 32px  hero panels, banner media
--radius-4xl: 40px  flagship surfaces
--radius-full: 9999px

Semantic aliases:
--radius-control: xs   small controls
--radius-button:  sm   buttons
--radius-card:    md   cards
--radius-modal:   xl   modals
--radius-sheet:   xl   bottom sheets
--radius-panel:   2xl  feature panels
--radius-media:   lg   profile media
```

### Shadows
- **Floating**: `0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)`
- **Gold Glow**: `var(--gold-glow)` / `var(--gold-glow-strong)`
- **Gold Shadow**: `--shadow-gold: 0 8px 28px rgba(214,168,63,0.16)`
- **Gold Shadow Strong**: `--shadow-gold-lg: 0 14px 42px rgba(214,168,63,0.2)`

### Transitions
- Spring: `cubic-bezier(0.16, 1, 0.3, 1)`
- Spring Bouncy: `cubic-bezier(0.34, 1.56, 0.64, 1)`

## Component Library

### Glass Surfaces
| Class | Usage |
|-------|-------|
| `.glass` | Default glass surface |
| `.glass-strong` | Stronger glass surface |
| `.glass-card` | Card with hover effect |
| `.glass-card-premium` | Premium card with silver accent |
| `.glass-input` | Input field |

### Buttons
| Class | Usage |
|-------|-------|
| `.btn-primary` | Primary white/silver button |
| `.btn-gold` | **Premium gold CTA** — For important actions |
| `.btn-gold-ghost` | Gold ghost button with subtle gold outline |
| `.btn-secondary` | Glass button |
| `.btn-ghost` | Ghost button |
| `.btn-icon` | Icon button |
| `.btn-destructive` | Destructive action button |
| `.btn-gradient-border` | Button with silver gradient border |

React component: `Button` supports variants: `primary`, `secondary`, `ghost`, `danger`, `outline`, `gold`, `goldGhost`, `destructive`

### Cards
| Class | Usage |
|-------|-------|
| `.card` | Standard card |
| `.card-hover` | Card with hover lift |
| `.card-premium` | Premium silver-edge card |
| `.card-floating` | Floating card with depth |
| `.card-gold-accent` | Card with gold top-edge hairline |
| `.card-creator` | Creator profile card |
| `.card-live` | Live stream card |
| `.card-video` | Video/reel card |
| `.card-post` | Social post card |
| `.card-balance` | Balance card with gold gradient wash |
| `.card-gift` | Gift card |
| `.card-gift-selected` | Selected gift card with gold border/glow |

### Badges
| Class | Usage |
|-------|-------|
| `.badge-live` | Live indicator badge |
| `.badge-verified` | Verification badge (white) |
| `.verified-badge-gold` | **Gold verification badge** |
| `.badge-red` | Error/danger badge |
| `.badge-green` | Success badge |
| `.badge-amber` | Warning badge |

### Navigation
| Class | Usage |
|-------|-------|
| `.nav-item` | Navigation item |
| `.nav-item-active` | Active navigation item (white) |
| `.nav-item-gold-active` | **Gold active navigation item** |
| `.nav-gold-indicator` | Gold left indicator bar for active nav |
| `.nav-icon` | Navigation icon |
| `.nav-icon-active` | Active navigation icon |

### Tabs
| Class | Usage |
|-------|-------|
| `.tab-bar` | Tab bar container |
| `.tab-item` | Tab item |
| `.tab-item-active` | Active tab item |

### Forms
| Class | Usage |
|-------|-------|
| `.form-label` | Form label |
| `.form-input` | Text input |
| `.form-textarea` | Textarea |
| `.form-select` | Select dropdown |
| `.form-error` | Error message |
| `.form-success` | Success message |
| `.form-checkbox` | Checkbox |

### Status Indicators
| Class | Usage |
|-------|-------|
| `.status-dot-online` | Online status |
| `.status-dot-idle` | Idle status |
| `.status-dot-offline` | Offline status |
| `.status-dot-live` | Live status |

### Special Components
| Class | Usage |
|-------|-------|
| `.story-ring` | Story ring |
| `.story-ring-viewed` | Viewed story ring |
| `.create-fab` | Create FAB button |
| `.live-indicator` | Live indicator (red) |
| `.level-badge` | Creator level badge (white) |
| `.level-badge-gold` | **Gold creator level badge** |
| `.coin-display` | VANTA Coin display (amber) |
| `.coin-display-gold` | **Gold VANTA Coin display** |
| `.gold-surface` | Gold-tinted surface |
| `.gold-surface-strong` | Strong gold surface with glow |
| `.gold-divider` | Gold gradient divider line |
| `.glow-gold` | Gold glow shadow |
| `.glow-gold-strong` | Strong gold glow shadow |

### Typography Utilities
| Class | Usage |
|-------|-------|
| `.text-display` | Display / hero heading |
| `.text-h1` | Page heading |
| `.text-h2` | Section heading |
| `.text-h3` | Card heading |
| `.text-body` | Body copy |
| `.text-secondary` | Secondary text |
| `.text-caption` | Caption / metadata |
| `.text-label` | Label / eyebrow (uppercase) |
| `.text-stat` | Numbers / statistics |
| `.text-gold` | Gold text |
| `.text-gold-gradient` | Gold gradient text |

## Animations

### Float Animations
- `.animate-float` — 8s ease-in-out
- `.animate-float-delayed` — 10s ease-in-out
- `.animate-float-soft` — 6s ease-in-out

### Fade Animations
- `.animate-fade-in` — 0.5s
- `.animate-fade-in-up` — 0.6s
- `.animate-fade-in-down` — 0.6s
- `.animate-fade-in-left` — 0.5s
- `.animate-fade-in-right` — 0.5s
- `.animate-fade-in-scale` — 0.5s

### Scale & Slide
- `.animate-scale-in` — 0.4s
- `.animate-slide-up` — 0.8s
- `.animate-slide-down` — 0.8s
- `.animate-slide-in-left` — 0.5s
- `.animate-slide-in-right` — 0.5s

### Special Effects
- `.animate-pulse-glow` — Soft glow pulse
- `.animate-heartbeat` — Heartbeat
- `.animate-notification-in` — Notification slide in
- `.animate-notification-out` — Notification slide out

### Delay Classes
- `.delay-100` through `.delay-800` — Staggered animation delays

## Page Architecture

### Information Architecture
```
Home → Discover → Reels → Live → Create → Chat → Notifications → Profile
```

The center `+` (Create) is the primary creation action.

### Layout Structure
- **Desktop**: 280px sidebar + main content area
- **Mobile**: Full-width + bottom navigation bar with gold center **+** create button
- **Tablet**: Full-width + bottom navigation bar

### Page Templates
- `page-container` — max-w-7xl centered
- `page-container-narrow` — max-w-5xl centered
- `page-container-wide` — max-w-[1400px] centered

## Responsive Breakpoints
- Mobile: < 1024px (lg breakpoint)
- Desktop: ≥ 1024px

## Accessibility
- Focus-visible ring with white glow (rgba(255,255,255,.42))
- ARIA labels on navigation items
- Semantic HTML structure
- Keyboard navigation support
- High contrast text (white on dark backgrounds)
- Proper heading hierarchy
- Touch-friendly mobile controls
- `prefers-reduced-motion` support via `.auth-surface` and animation classes

## Gold Usage Guidelines

### ✅ Use gold for
- Primary CTAs (Create, Go Live, Add Coins)
- Active navigation state
- Premium features & VIP/elite indicators
- Creator earnings & VANTA Coin balances
- Gift cards & selected gift states
- Featured/trending content markers
- Important achievements
- Premium verification badges

### ❌ Don't use gold for
- Background fills (limit to subtle 8% tint)
- Standard borders (keep graphite/silver)
- Body text (keep silver/white)
- Every button — only the primary CTA
- Decorative animations — restrained glow only