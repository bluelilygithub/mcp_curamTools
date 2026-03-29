/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // 200ms default resolves the 200ms/150ms mismatch — all transitions consistent
      transitionDuration: {
        DEFAULT: '200ms',
      },
      // Map CSS custom properties to Tailwind utilities
      // bg-bg, bg-surface, bg-primary, text-primary, text-muted, border-border, etc.
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        primary: 'var(--color-primary)',
        'text-col': 'var(--color-text)',
        muted: 'var(--color-muted)',
      },
      fontFamily: {
        body: ['var(--font-body)', 'sans-serif'],
        heading: ['var(--font-heading)', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease forwards',
      },
    },
  },
  plugins: [],
};
