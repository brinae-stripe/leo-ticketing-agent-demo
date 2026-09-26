/** Display helpers. Everything money-shaped arrives here as integer cents. */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function money(cents: number): string {
  return usd.format(cents / 100);
}

export function moneyWhole(cents: number): string {
  return usdWhole.format(Math.round(cents / 100));
}

/** $1.2M / $842K for headline tiles. */
export function moneyCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${compact.format(dollars)}`;
  return usdWhole.format(dollars);
}

export function count(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function countCompact(value: number): string {
  return compact.format(value);
}

export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function bps(value: number): string {
  const rounded = Math.round(value * 10_000);
  return `${rounded > 0 ? '+' : ''}${rounded} bps`;
}

export function points(value: number, digits = 1): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)} pts`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

const longDateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Epoch seconds → "Sep 25". */
export function shortDate(epochSeconds: number): string {
  return dateFmt.format(new Date(epochSeconds * 1000));
}

/** Epoch seconds → "Sep 25, 2:00 PM". */
export function dateTime(epochSeconds: number): string {
  return dateTimeFmt.format(new Date(epochSeconds * 1000));
}

/** Epoch seconds → "Fri, Sep 25, 2026". */
export function longDate(epochSeconds: number): string {
  return longDateFmt.format(new Date(epochSeconds * 1000));
}

/** ISO date string (YYYY-MM-DD) → "Sep 25". */
export function isoToShortDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T12:00:00Z`));
}

/** Signed, human duration between two epoch-second stamps. */
export function untilLabel(target: number, from: number): string {
  const delta = target - from;
  const past = delta < 0;
  const abs = Math.abs(delta);
  const hours = Math.floor(abs / 3600);
  if (hours < 1) return past ? 'overdue' : 'under 1h';
  if (hours < 48) return past ? `${hours}h overdue` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return past ? `${days}d overdue` : `in ${days}d`;
}

/** Wall-clock timestamp for the audit log (real time, not simulated time). */
export function auditTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

/** snake_case / kebab-case → "Title Case". */
export function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bUs\b/g, 'US')
    .replace(/\bBnpl\b/g, 'BNPL')
    .replace(/\bEfw\b/g, 'EFW')
    .replace(/\bSql\b/g, 'SQL');
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: 'Card (online)',
  card_present: 'Card present',
  klarna: 'Klarna',
  affirm: 'Affirm',
  afterpay_clearpay: 'Afterpay / Clearpay',
};

export const WALLET_LABELS: Record<string, string> = {
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  link: 'Link',
};

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
