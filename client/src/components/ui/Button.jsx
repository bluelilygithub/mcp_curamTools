/**
 * Button — platform UI primitive.
 * Variants: primary, secondary, danger, icon, toggle.
 * Hover mechanism: opacity only — works across all themes.
 * Corner radius: rounded-xl (buttons/inputs convention).
 */

const BASE = 'inline-flex items-center justify-center gap-2 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS = {
  primary: `${BASE} px-4 py-2 rounded-xl text-sm text-white hover:opacity-80`,
  secondary: `${BASE} px-4 py-2 rounded-xl text-sm border hover:opacity-70`,
  danger: `${BASE} px-4 py-2 rounded-xl text-sm text-white hover:opacity-80`,
  icon: `${BASE} w-8 h-8 rounded-lg hover:opacity-70`,
  toggle: `${BASE} flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70`,
};

const VARIANT_STYLES = {
  primary: { background: 'var(--color-primary)', color: '#fff' },
  secondary: { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' },
  danger: { background: '#ef4444', color: '#fff' },
  icon: { color: 'var(--color-muted)', background: 'transparent' },
  toggle: { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' },
};

export default function Button({
  variant = 'primary',
  children,
  onClick,
  disabled = false,
  type = 'button',
  active = false,
  style: extraStyle = {},
  className = '',
  ...rest
}) {
  const isToggle = variant === 'toggle';
  const activeStyle = isToggle && active
    ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }
    : {};

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      style={{ ...VARIANT_STYLES[variant], ...activeStyle, ...extraStyle }}
      {...rest}
    >
      {children}
    </button>
  );
}
