/**
 * ThemeProvider — writes 7 CSS tokens to <head> style tag at runtime.
 * Reads theme from settingsStore. No re-render required on theme change —
 * the DOM write propagates to all CSS var consumers immediately.
 */
import { useEffect } from 'react';
import useSettingsStore from '../stores/settingsStore';

const THEMES = {
  'warm-sand': {
    bg: '#F5F5F0',
    surface: '#EEEEE8',
    border: '#D8D8D0',
    primary: '#CC785C',
    primaryRgb: '204, 120, 92',
    text: '#1A1A1A',
    muted: '#888888',
  },
  'dark-slate': {
    bg: '#1A1D23',
    surface: '#22262F',
    border: '#333844',
    primary: '#6C8EBF',
    primaryRgb: '108, 142, 191',
    text: '#E8EAF0',
    muted: '#6B7280',
  },
  forest: {
    bg: '#F0F4F0',
    surface: '#E8EFE8',
    border: '#C8D8C8',
    primary: '#3D7A4A',
    primaryRgb: '61, 122, 74',
    text: '#1A2A1A',
    muted: '#6B8068',
  },
  'midnight-blue': {
    bg: '#0F1117',
    surface: '#161B27',
    border: '#252D40',
    primary: '#4F8EF7',
    primaryRgb: '79, 142, 247',
    text: '#E2E8F0',
    muted: '#64748B',
  },
  'paper-white': {
    bg: '#FAFAF8',
    surface: '#F5F5F0',
    border: '#E5E5DC',
    primary: '#2563EB',
    primaryRgb: '37, 99, 235',
    text: '#111111',
    muted: '#6B7280',
  },
};

const FONT_URLS = {
  Inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'DM Sans': 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  'Open Sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  Lato: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
  Nunito: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
  Poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  Raleway: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap',
  Montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
  Oswald: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap',
  Lora: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap',
  Merriweather: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
  'Playfair Display': 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
  'PT Serif': 'https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&display=swap',
  'Crimson Text': 'https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&display=swap',
  'JetBrains Mono': 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap',
  'Fira Code': 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap',
  'DM Mono': 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap',
};

function loadFont(family) {
  if (!family || !FONT_URLS[family]) return;
  const id = `font-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = FONT_URLS[family];
  document.head.appendChild(link);
}

function applyTheme(themeName, bodyFont, headingFont, monoFont) {
  const palette = THEMES[themeName] ?? THEMES['warm-sand'];

  const styleId = 'mcp-theme';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }

  style.textContent = `
    :root {
      --color-bg:          ${palette.bg};
      --color-surface:     ${palette.surface};
      --color-border:      ${palette.border};
      --color-primary:     ${palette.primary};
      --color-primary-rgb: ${palette.primaryRgb};
      --color-text:        ${palette.text};
      --color-muted:       ${palette.muted};
      --font-body:         '${bodyFont}', sans-serif;
      --font-heading:      '${headingFont}', serif;
      --font-mono:         '${monoFont}', monospace;
    }
  `;
}

export default function ThemeProvider({ children }) {
  const { theme, bodyFont, headingFont, monoFont } = useSettingsStore();

  useEffect(() => {
    loadFont(bodyFont);
    loadFont(headingFont);
    loadFont(monoFont);
    applyTheme(theme, bodyFont, headingFont, monoFont);
  }, [theme, bodyFont, headingFont, monoFont]);

  return children;
}

export { THEMES };
