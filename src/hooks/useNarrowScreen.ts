'use client';

import { useSyncExternalStore } from 'react';

/**
 * WHETHER THE SCREEN IS PHONE-WIDE (below Tailwind's `sm`, 640px). MOBILE-TABLES-1 (17 November 2026).
 *
 * A table that is wider than a phone used to scroll sideways inside its card, which put the customer,
 * the price and a part's Edit and Remove out of reach without a swipe nobody knows to make. Below this
 * width those lists are drawn as stacked cards instead. It is decided in script rather than by hiding
 * one of two copies with CSS, so the page holds ONE copy of every value — a screen reader, a search
 * and a browser test never meet the hidden twin.
 *
 * The server and the first client render assume a wide screen (the layout every table had), and a
 * phone switches straight after hydration.
 */
const QUERY = '(max-width: 639.98px)';

const subscribe = (notify: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

const narrowNow = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

export const useNarrowScreen = (): boolean => useSyncExternalStore(subscribe, narrowNow, () => false);
