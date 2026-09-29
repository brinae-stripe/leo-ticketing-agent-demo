import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Marquee brand: black + white, brilliant blue accent,
        // purple and cool gray used sparingly.
        ink: {
          DEFAULT: '#000000',
          soft: '#0B0B0C',
          muted: '#17181B',
        },
        blue: {
          50: '#EEF3FF',
          100: '#DBE5FF',
          200: '#BACCFF',
          300: '#8EA9FF',
          400: '#5C83FF',
          500: '#1F5EFF',
          600: '#1747D6',
          700: '#1236A8',
          800: '#0E2A80',
          900: '#0B2061',
        },
        purple: {
          50: '#F4EFFF',
          100: '#E8DEFF',
          300: '#B695FF',
          500: '#7A3BFF',
          600: '#6326DC',
          700: '#4E1BAF',
        },
        gray: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
        success: '#0B8A4B',
        warning: '#B45309',
        danger: '#C01048',
        border: '#E5E7EB',
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(17 24 39 / 0.04)',
        lift: '0 8px 24px -12px rgb(17 24 39 / 0.18)',
        sheet: '0 24px 64px -24px rgb(17 24 39 / 0.35)',
      },
      backgroundImage: {
        // "Stadium lights" motif — a subtle dot grid for hero/header surfaces.
        'stadium-dots':
          'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)',
        'stadium-dots-light':
          'radial-gradient(rgba(17,24,39,0.10) 1px, transparent 1px)',
      },
      backgroundSize: {
        dots: '18px 18px',
        'dots-lg': '26px 26px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'caret-blink': {
          '0%, 70%, 100%': { opacity: '1' },
          '20%, 50%': { opacity: '0' },
        },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'caret-blink': 'caret-blink 1s steps(1) infinite',
        'overlay-in': 'overlay-in 160ms ease-out',
        'sheet-in': 'sheet-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
