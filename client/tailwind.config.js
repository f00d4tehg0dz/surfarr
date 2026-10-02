/** @type {import('tailwindcss').Config} */
// SurfArr "Late Night Broadcast" design system (2026).
// Warm ink surfaces, TV-Guide marigold, phosphor teal, on-air red.
// The `m3-*` token names are kept so every existing class picks up the new
// palette; new work should prefer the semantic names under `tv-*`.
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        m3: {
          bg:               '#0D0C11',
          surface:          '#15141B',
          surfaceContainer: '#1C1A23',
          surfaceHigh:      '#25222E',
          border:           '#2E2A38',
          borderSubtle:     '#211E29',
          text:             '#F3EEE4',
          textSecondary:    '#BDB5A8',
          muted:            '#80796E',
          primary:          '#FFB547',
          primaryContainer: '#6B4306',
          onPrimary:        '#1C1206',
          error:            '#FF6159',
          errorContainer:   '#5E1512',
          success:          '#7EE2A8',
          successContainer: '#0F4A2B',
          accent:           '#6EE7D2',
          black:            '#050507',
          overlay:          'rgba(5,5,7,0.72)',
        },
        tv: {
          ink:      '#0D0C11',
          paper:    '#F3EEE4',
          marigold: '#FFB547',
          tangerine:'#FF7A3D',
          phosphor: '#6EE7D2',
          onair:    '#FF4D45',
          plum:     '#8B6CFF',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        m3:      '14px',
        'm3-sm': '10px',
        'm3-lg': '20px',
        'm3-xl': '28px',
      },
      boxShadow: {
        m3:      '0 1px 0 rgba(255,255,255,0.03) inset, 0 1px 2px rgba(0,0,0,0.4)',
        'm3-md': '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.6)',
        'm3-lg': '0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 60px -12px rgba(0,0,0,0.75)',
        glow:    '0 0 0 1px rgba(255,181,71,0.35), 0 8px 30px -6px rgba(255,181,71,0.35)',
        onair:   '0 0 12px rgba(255,77,69,0.55)',
      },
      keyframes: {
        'on-air': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'tune-in': {
          '0%':   { opacity: '0', filter: 'brightness(3) blur(2px)', transform: 'scaleY(0.02)' },
          '60%':  { opacity: '1', filter: 'brightness(1.4)', transform: 'scaleY(1)' },
          '100%': { opacity: '1', filter: 'none', transform: 'none' },
        },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      animation: {
        'on-air':  'on-air 1.6s ease-in-out infinite',
        'fade-up': 'fade-up .35s ease-out both',
        'tune-in': 'tune-in .45s cubic-bezier(.2,.8,.2,1) both',
        marquee:   'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
