'use client';

import { useEffect } from 'react';

/**
 * Section transitions: sections below the fold at load rise gently into place
 * as they arrive. What is on screen at load is never hidden, and nothing is
 * hidden without script or with reduced motion.
 */
export function SectionReveal() {
  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('main > section:not(.hero), main > .strip, footer'));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.remove('pending');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    for (const el of targets) {
      el.classList.add('reveal');
      if (el.getBoundingClientRect().top > window.innerHeight * 0.92) {
        el.classList.add('pending');
        io.observe(el);
      }
    }
    return () => io.disconnect();
  }, []);
  return null;
}
