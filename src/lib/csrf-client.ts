'use client';

/**
 * The session's CSRF token is rendered onto <body data-csrf> by the layout.
 * Client components read it here rather than each fetching it, and every
 * mutating request carries it.
 */

import { CSRF_HEADER } from './auth/constants';

export function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  return document.body.dataset['csrf'] ?? '';
}

export function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken() };
}
