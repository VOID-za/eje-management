import { cn } from '@/lib/cn';

/**
 * EJE's branding on screen. BRAND-1.
 *
 * Every placement is the owner's logo (`public/branding/eje-logo-original.jpg`), cut by
 * `scripts/generate-brand-assets.mjs` — never redrawn. Two cuts:
 *
 *   - the MARK: the EJE lettering on its own dark background, square. Header, sidebar,
 *     the documents on screen. Always drawn square, so it is never stretched.
 *   - the full LOGO: the whole 3:2 artwork, for the sign-in screen.
 *
 * Plain `<img>` on purpose: these are small static files the service worker can keep
 * for offline use (`/branding/` is cacheable); the image optimiser would serve them from
 * an API route instead, and would need an image library on the deployment host.
 */

/** The EJE lettering, square. `className` sets the size (default 36px). */
export const LogoMark = ({ className, decorative = false }: { readonly className?: string; readonly decorative?: boolean }) => (
  // eslint-disable-next-line @next/next/no-img-element -- a small committed static asset, kept by the service worker for offline use
  <img
    src="/branding/eje-mark-96.webp"
    srcSet="/branding/eje-mark-96.webp 96w, /branding/eje-mark-192.webp 192w"
    sizes="48px"
    width={96}
    height={96}
    alt={decorative ? '' : 'EJE'}
    aria-hidden={decorative ? true : undefined}
    decoding="async"
    draggable={false}
    data-testid="eje-logo-mark"
    className={cn('aspect-square size-9 shrink-0 rounded-[0.55rem] object-cover ring-1 ring-white/10', className)}
  />
);

/** The whole EJE logo, 3:2. `className` sets the width; the height follows. */
export const LogoFull = ({ className }: { readonly className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element -- a committed static asset, kept by the service worker for offline use
  <img
    src="/branding/eje-logo-480.webp"
    srcSet="/branding/eje-logo-480.webp 480w, /branding/eje-logo-960.webp 960w"
    sizes="(min-width: 1024px) 20rem, 18rem"
    width={480}
    height={320}
    alt="EJE"
    decoding="async"
    draggable={false}
    data-testid="eje-logo-full"
    className={cn('aspect-[3/2] h-auto w-full rounded-xl object-cover shadow-lg ring-1 ring-white/10', className)}
  />
);

/** The mark beside the application's name — the sidebar and the sign-in panel. */
export const Logo = ({
  className,
  variant = 'dark',
}: {
  readonly className?: string;
  readonly variant?: 'dark' | 'light';
}) => (
  <span className={cn('inline-flex items-center gap-2.5', className)}>
    {/* The name is written beside it, so the mark adds nothing for a screen reader. */}
    <LogoMark decorative />
    <span className="flex min-w-0 flex-col leading-tight">
      <span
        className={cn(
          'text-sm font-bold tracking-tight',
          variant === 'dark' ? 'text-white' : 'text-steel-900',
        )}
      >
        EJE Industrial
      </span>
      <span
        className={cn(
          'text-xs font-medium tracking-wide uppercase',
          variant === 'dark' ? 'text-chrome-dim' : 'text-chrome-faint',
        )}
      >
        Job Card System
      </span>
    </span>
  </span>
);
