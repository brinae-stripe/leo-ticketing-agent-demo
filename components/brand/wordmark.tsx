import { PLATFORM } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Platform wordmark. Monochrome, always — it inherits currentColor so it works
 * on the dark header band and on white without a second asset. The leading
 * letter is slanted; nothing else is.
 */
export function Wordmark({
  className,
  label = PLATFORM.toUpperCase(),
}: {
  className?: string;
  label?: string;
}) {
  const [first, ...rest] = label;
  return (
    <span
      className={cn(
        'font-display select-none font-black leading-none tracking-[-0.015em]',
        className,
      )}
      aria-label={label}
    >
      <span className="inline-block -skew-x-12 italic" aria-hidden>
        {first}
      </span>
      <span aria-hidden>{rest.join('')}</span>
    </span>
  );
}

/** The dot field used on dark surfaces. Purely decorative. */
export function StadiumLights({
  className,
  fade = true,
}: {
  className?: string;
  fade?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 stadium-dots',
        fade && 'stadium-fade',
        className,
      )}
    />
  );
}
