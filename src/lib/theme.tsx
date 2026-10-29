import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useAuthStore } from './store';
import { updateProfile } from './firestore';

export type ThemeName =
  | 'hazard'
  | 'concrete'
  | 'acid'
  | 'arcade'
  | 'jungle'
  | 'taxi'
  | 'cozy-cream'
  | 'cozy-dusk'
  | 'paper-ink'
  | 'soft-pop'
  | 'midnight'
  | 'mint-fresh'
  | 'custom';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  partnerA: string;
  partnerB: string;
  accent: string;
  accent2: string;
  success: string;
  urgent: string;
  shadowColor: string;
  overlay: string;
}

export interface PresetThemeDefinition {
  id: ThemeName;
  name: string;
  description: string;
  light: ThemeColors;
  dark: ThemeColors;
}

export const PRESET_THEMES: Record<Exclude<ThemeName, 'custom'>, PresetThemeDefinition> = {
  hazard: {
    id: 'hazard',
    name: 'Hazard (AV Flagship)',
    description: 'Electric flame orange, canary yellow, cobalt blue & emerald',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FF5A1F',
      partnerB: '#2B50FF',
      accent: '#FFE600',
      accent2: '#00C46A',
      success: '#00C46A',
      urgent: '#FF3B30',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FF5A1F',
      partnerB: '#3D61FF',
      accent: '#FFE600',
      accent2: '#00C46A',
      success: '#00C46A',
      urgent: '#FF4D4D',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete',
    description: 'High-contrast signal crimson, sun yellow & azure blue',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FF3B30',
      partnerB: '#0A84FF',
      accent: '#FFD60A',
      accent2: '#30D158',
      success: '#30D158',
      urgent: '#E03131',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FF453A',
      partnerB: '#0A84FF',
      accent: '#FFD60A',
      accent2: '#30D158',
      success: '#30D158',
      urgent: '#FF453A',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  acid: {
    id: 'acid',
    name: 'Acid',
    description: 'Vibrant neon tangerine, lime chartreuse & deep indigo',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FF6A00',
      partnerB: '#00B3A4',
      accent: '#C6FF00',
      accent2: '#1A1AFF',
      success: '#1A1AFF',
      urgent: '#FF2E2E',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FF7A1A',
      partnerB: '#00B3A4',
      accent: '#C6FF00',
      accent2: '#4444FF',
      success: '#4444FF',
      urgent: '#FF4D4D',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    description: 'Retro gameboy fire red, amber gold & hyper blue',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FF2E2E',
      partnerB: '#0057FF',
      accent: '#FFB800',
      accent2: '#00D084',
      success: '#00D084',
      urgent: '#FF2E2E',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FF4D4D',
      partnerB: '#337AFF',
      accent: '#FFB800',
      accent2: '#00D084',
      success: '#00D084',
      urgent: '#FF4D4D',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  jungle: {
    id: 'jungle',
    name: 'Jungle',
    description: 'Tropical citrus orange, warm saffron & deep forest emerald',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FF7A00',
      partnerB: '#007F5F',
      accent: '#F2E400',
      accent2: '#00B4D8',
      success: '#00B4D8',
      urgent: '#E63900',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FF8A1A',
      partnerB: '#007F5F',
      accent: '#F2E400',
      accent2: '#33C4E3',
      success: '#33C4E3',
      urgent: '#FF4D4D',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  taxi: {
    id: 'taxi',
    name: 'Taxi',
    description: 'Iconic metro yellow cab, flame red & street cobalt',
    light: {
      bg: '#EDEDE8',
      surface: '#FFFFFF',
      surface2: '#E2E2DC',
      border: '#101114',
      text: '#101114',
      textMuted: '#5A5D66',
      partnerA: '#FFC400',
      partnerB: '#E63900',
      accent: '#FFF200',
      accent2: '#2F6BFF',
      success: '#2F6BFF',
      urgent: '#E63900',
      shadowColor: '#101114',
      overlay: 'rgba(16, 17, 20, 0.65)',
    },
    dark: {
      bg: '#14151A',
      surface: '#23252E',
      surface2: '#2C2E38',
      border: '#3A3D4A',
      text: '#F4F4EE',
      textMuted: '#A3A6B3',
      partnerA: '#FFC400',
      partnerB: '#FF4D1A',
      accent: '#FFF200',
      accent2: '#5788FF',
      success: '#5788FF',
      urgent: '#FF4D1A',
      shadowColor: '#0A0B0E',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  'cozy-cream': {
    id: 'cozy-cream',
    name: 'Cozy Cream',
    description: 'Warm pastry warmth, coral blush & butter yellow',
    light: {
      bg: '#FFF8F0',
      surface: '#FFFFFF',
      surface2: '#F7EDE2',
      border: '#E8DCCE',
      text: '#2B1B17',
      textMuted: '#735F57',
      partnerA: '#FF6B6B',
      partnerB: '#7C6CF2',
      accent: '#FFD166',
      accent2: '#FF99C8',
      success: '#1EA87A',
      urgent: '#E03131',
      shadowColor: '#3A2722',
      overlay: 'rgba(43, 27, 23, 0.45)',
    },
    dark: {
      bg: '#1F1714',
      surface: '#2C211D',
      surface2: '#3B2E29',
      border: '#4A3B35',
      text: '#FBEFE6',
      textMuted: '#BFAFA7',
      partnerA: '#FF8A8A',
      partnerB: '#A296FF',
      accent: '#FFD166',
      accent2: '#FF99C8',
      success: '#38D9A9',
      urgent: '#FF6B6B',
      shadowColor: '#0D0907',
      overlay: 'rgba(0, 0, 0, 0.70)',
    },
  },
  'cozy-dusk': {
    id: 'cozy-dusk',
    name: 'Cozy Dusk',
    description: 'Warm evening terracotta, sage teal & amber glow',
    light: {
      bg: '#FFF4EE',
      surface: '#FFFFFF',
      surface2: '#F6EAE2',
      border: '#E6D8D0',
      text: '#2A2432',
      textMuted: '#746880',
      partnerA: '#E8604F',
      partnerB: '#2FA89A',
      accent: '#F5B83D',
      accent2: '#67B4FF',
      success: '#22A06B',
      urgent: '#E53935',
      shadowColor: '#30273A',
      overlay: 'rgba(42, 36, 50, 0.45)',
    },
    dark: {
      bg: '#1E1B24',
      surface: '#2A2632',
      surface2: '#383344',
      border: '#474154',
      text: '#F5F0EA',
      textMuted: '#B6AEBF',
      partnerA: '#FF7A6B',
      partnerB: '#5ED6C4',
      accent: '#FFD166',
      accent2: '#74C0FC',
      success: '#38D9A9',
      urgent: '#FF6B6B',
      shadowColor: '#0C0A0F',
      overlay: 'rgba(0, 0, 0, 0.70)',
    },
  },
  'paper-ink': {
    id: 'paper-ink',
    name: 'Paper & Ink',
    description: 'Crisp editorial parchment, rust orange & nautical blue',
    light: {
      bg: '#FAF5EE',
      surface: '#FFFFFF',
      surface2: '#F0E9DE',
      border: '#DDD4C5',
      text: '#1F1D2B',
      textMuted: '#6C6A7B',
      partnerA: '#E4572E',
      partnerB: '#2E86AB',
      accent: '#F2C14E',
      accent2: '#826AED',
      success: '#208B58',
      urgent: '#D9383A',
      shadowColor: '#2B2838',
      overlay: 'rgba(31, 29, 43, 0.45)',
    },
    dark: {
      bg: '#1A1A22',
      surface: '#25252F',
      surface2: '#32323E',
      border: '#424252',
      text: '#F3EFE8',
      textMuted: '#ADA9BC',
      partnerA: '#FF7A52',
      partnerB: '#55B4DB',
      accent: '#F2C14E',
      accent2: '#9D8DFC',
      success: '#38D9A9',
      urgent: '#FF6B6B',
      shadowColor: '#09090D',
      overlay: 'rgba(0, 0, 0, 0.70)',
    },
  },
  'soft-pop': {
    id: 'soft-pop',
    name: 'Soft Pop',
    description: 'Bubblegum lilac, sweet strawberry & matcha mint',
    light: {
      bg: '#EDE7FF',
      surface: '#FFFFFF',
      surface2: '#E0D7FA',
      border: '#CEBFF2',
      text: '#1A1A1A',
      textMuted: '#6B6380',
      partnerA: '#FF8FB1',
      partnerB: '#5FD3B3',
      accent: '#FFE066',
      accent2: '#70C1FF',
      success: '#12B886',
      urgent: '#E03131',
      shadowColor: '#261E38',
      overlay: 'rgba(26, 26, 26, 0.45)',
    },
    dark: {
      bg: '#221B3A',
      surface: '#2E2650',
      surface2: '#3D3369',
      border: '#4F4385',
      text: '#F4F0FF',
      textMuted: '#BCB2DE',
      partnerA: '#FF9DBB',
      partnerB: '#6FE0C0',
      accent: '#FFE066',
      accent2: '#90D5FF',
      success: '#38D9A9',
      urgent: '#FF6B6B',
      shadowColor: '#0E0A1A',
      overlay: 'rgba(0, 0, 0, 0.70)',
    },
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep navy velvet, electric crimson & cobalt neon',
    light: {
      bg: '#F1F4FB',
      surface: '#FFFFFF',
      surface2: '#E2E8F6',
      border: '#D0DAEC',
      text: '#0E1424',
      textMuted: '#5B667F',
      partnerA: '#E6455F',
      partnerB: '#4C6EF5',
      accent: '#F5A800',
      accent2: '#15AABF',
      success: '#12B886',
      urgent: '#E03131',
      shadowColor: '#1A2238',
      overlay: 'rgba(14, 20, 36, 0.45)',
    },
    dark: {
      bg: '#090D16',
      surface: '#121826',
      surface2: '#1C2438',
      border: '#28344E',
      text: '#E8ECF5',
      textMuted: '#94A1BC',
      partnerA: '#FF6B81',
      partnerB: '#6C8CFF',
      accent: '#FFC857',
      accent2: '#3BC9DB',
      success: '#38D9A9',
      urgent: '#FF6B81',
      shadowColor: '#030508',
      overlay: 'rgba(0, 0, 0, 0.75)',
    },
  },
  'mint-fresh': {
    id: 'mint-fresh',
    name: 'Mint Fresh',
    description: 'Refreshing botanic eucalyptus, coral flame & sunny dew',
    light: {
      bg: '#EFFAF4',
      surface: '#FFFFFF',
      surface2: '#DFF3E8',
      border: '#C8E7D6',
      text: '#14352A',
      textMuted: '#4E6E62',
      partnerA: '#FF7B54',
      partnerB: '#2BB58B',
      accent: '#FFD93D',
      accent2: '#67B4FF',
      success: '#12B886',
      urgent: '#E03131',
      shadowColor: '#1F382E',
      overlay: 'rgba(20, 53, 42, 0.45)',
    },
    dark: {
      bg: '#0F1F19',
      surface: '#172B23',
      surface2: '#213B30',
      border: '#2E4E40',
      text: '#E6F7EE',
      textMuted: '#94B5A6',
      partnerA: '#FF9370',
      partnerB: '#4FD6A8',
      accent: '#FFD93D',
      accent2: '#74C0FC',
      success: '#38D9A9',
      urgent: '#FF7B54',
      shadowColor: '#060C0A',
      overlay: 'rgba(0, 0, 0, 0.70)',
    },
  },
};

// 36 Flat Color Swatches spanning the full spectrum
export const FLAT_SWATCHES_36: string[] = [
  '#FF4D4D', '#FF6B6B', '#FA5252', '#E03131', '#C92A2A', '#E8590C',
  '#FD7E14', '#FF922B', '#FFA94D', '#F76707', '#E67700', '#F59F00',
  '#FCC419', '#FFD166', '#FFE066', '#82C91E', '#51CF66', '#2FB344',
  '#20C997', '#0CA678', '#2FA89A', '#15AABF', '#1098AD', '#228BE6',
  '#339AF0', '#4C6EF5', '#5C7CFA', '#7048E8', '#7950F2', '#845EF7',
  '#BE4BDB', '#CC5DE8', '#E64980', '#F783AC', '#FF8FB1', '#343A40',
];

// Helper: Relative Luminance
export function getRelativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6 && clean.length !== 8) return 0.5;
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Helper: Contrast Ratio
export function getContrastRatio(fgHex: string, bgHex: string): number {
  const l1 = getRelativeLuminance(fgHex);
  const l2 = getRelativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkContrast(fgHex: string, bgHex: string) {
  const ratio = Math.round(getContrastRatio(fgHex, bgHex) * 10) / 10;
  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesLarge: ratio >= 3.0,
  };
}

// Auto-fix contrast by adjusting lightness
export function autoFixContrast(fgHex: string, bgHex: string, targetRatio = 4.5): string {
  const bgLum = getRelativeLuminance(bgHex);
  let rgb = hexToRgb(fgHex) || [40, 40, 40];
  let [r, g, b] = rgb;

  const shouldLighten = bgLum < 0.5;
  let iterations = 0;

  while (iterations < 25) {
    const currentHex = rgbToHex(r, g, b);
    if (getContrastRatio(currentHex, bgHex) >= targetRatio) {
      return currentHex;
    }
    if (shouldLighten) {
      r = Math.min(255, Math.round(r + (255 - r) * 0.15 + 4));
      g = Math.min(255, Math.round(g + (255 - g) * 0.15 + 4));
      b = Math.min(255, Math.round(b + (255 - b) * 0.15 + 4));
    } else {
      r = Math.max(0, Math.round(r * 0.82 - 3));
      g = Math.max(0, Math.round(g * 0.82 - 3));
      b = Math.max(0, Math.round(b * 0.82 - 3));
    }
    iterations++;
  }
  return shouldLighten ? '#FFFFFF' : '#1A1A1A';
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return null;
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Apply CSS variables to document.documentElement
export function applyThemeVariables(colors: ThemeColors, theme: ThemeName, mode: ResolvedMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.setAttribute('data-theme', theme);
  root.setAttribute('data-app-theme', theme);
  root.setAttribute('data-mode', mode);

  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const visualColors = colors;

  root.style.setProperty('--bg', visualColors.bg);
  root.style.setProperty('--card', visualColors.surface);
  root.style.setProperty('--surface', visualColors.surface);
  root.style.setProperty('--surface-2', visualColors.surface2);
  root.style.setProperty('--border', visualColors.border);
  root.style.setProperty('--text', visualColors.text);
  root.style.setProperty('--ink', visualColors.text);
  root.style.setProperty('--text-muted', visualColors.textMuted);
  root.style.setProperty('--mut', visualColors.textMuted);
  root.style.setProperty('--partner-a', visualColors.partnerA);
  root.style.setProperty('--a', visualColors.partnerA);
  root.style.setProperty('--partner-b', visualColors.partnerB);
  root.style.setProperty('--c', visualColors.partnerB);
  root.style.setProperty('--accent', visualColors.accent);
  root.style.setProperty('--b', visualColors.accent);
  root.style.setProperty('--accent-2', visualColors.accent2);
  root.style.setProperty('--success', visualColors.success);
  root.style.setProperty('--d', visualColors.success);
  root.style.setProperty('--urgent', visualColors.urgent);
  root.style.setProperty('--shadow-color', visualColors.shadowColor);
  root.style.setProperty('--overlay', visualColors.overlay);
  root.style.setProperty('--on', '#101114');

  // Backward compatibility with previous theme variable names
  root.style.setProperty('--bg-main', visualColors.bg);
  root.style.setProperty('--bg-surface', visualColors.surface2);
  root.style.setProperty('--bg-card', visualColors.surface);
  root.style.setProperty('--border-color', visualColors.border);
  root.style.setProperty('--text-main', visualColors.text);
  root.style.setProperty('--primary-color', visualColors.partnerA);
  root.style.setProperty('--secondary-color', visualColors.partnerB);
  root.style.setProperty('--accent-color', visualColors.accent);
  root.style.setProperty('--urgent-color', visualColors.urgent);
  root.style.setProperty('--success-color', visualColors.success);

  // Update meta theme-color
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', visualColors.bg);
  }
}

interface ThemeContextValue {
  theme: ThemeName;
  mode: ThemeMode;
  resolvedMode: ResolvedMode;
  currentColors: ThemeColors;
  customColorsLight: Partial<ThemeColors>;
  customColorsDark: Partial<ThemeColors>;
  setTheme: (theme: ThemeName) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setCustomColor: (role: keyof ThemeColors, hex: string) => void;
  setPartnerColor: (isPartnerA: boolean, hex: string) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);

  // Read saved state or defaults
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('duo_theme') as ThemeName;
      if (saved && (saved in PRESET_THEMES || saved === 'custom')) return saved;
    }
    return 'hazard';
  });

  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('duo_mode') as ThemeMode;
      if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
    }
    return 'auto';
  });

  const [customColorsLight, setCustomColorsLight] = useState<Partial<ThemeColors>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('duo_custom_light');
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return {};
  });

  const [customColorsDark, setCustomColorsDark] = useState<Partial<ThemeColors>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('duo_custom_dark');
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return {};
  });

  // Track system mode
  const [systemMode, setSystemMode] = useState<ResolvedMode>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemMode(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const resolvedMode: ResolvedMode = mode === 'auto' ? systemMode : mode;

  // Sync state if currentUser.theme changes from auth / profile sync
  useEffect(() => {
    if (
      currentUser?.theme &&
      (currentUser.theme in PRESET_THEMES || currentUser.theme === 'custom') &&
      currentUser.theme !== theme
    ) {
      setThemeState(currentUser.theme);
      localStorage.setItem('duo_theme', currentUser.theme);
    }
  }, [currentUser?.theme]);

  // Compute active colors: presets take authoritative precedence unless theme is 'custom'
  const currentColors = useMemo<ThemeColors>(() => {
    const basePreset = PRESET_THEMES[theme === 'custom' ? 'hazard' : theme] || PRESET_THEMES['hazard'];
    const base = resolvedMode === 'dark' ? basePreset.dark : basePreset.light;
    const custom = resolvedMode === 'dark' ? customColorsDark : customColorsLight;

    if (theme === 'custom') {
      return {
        ...base,
        ...custom,
      };
    }

    return base;
  }, [theme, resolvedMode, customColorsLight, customColorsDark]);

  // Apply CSS variables on change
  useEffect(() => {
    applyThemeVariables(currentColors, theme, resolvedMode);
  }, [currentColors, theme, resolvedMode]);

  // Set theme handler
  const setTheme = (newTheme: ThemeName) => {
    setThemeState(newTheme);
    localStorage.setItem('duo_theme', newTheme);

    // Save to user profile in Zustand & Firestore
    setCurrentUser({ theme: newTheme as any });
    if (currentUser?.id) {
      updateProfile(currentUser.id, { theme: newTheme }).catch(() => {});
    }
  };

  // Set mode handler
  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem('duo_mode', newMode);

    if (currentUser?.id) {
      updateProfile(currentUser.id, { mode: newMode }).catch(() => {});
    }
  };

  const toggleMode = () => {
    const next = resolvedMode === 'dark' ? 'light' : 'dark';
    setMode(next);
  };

  const setCustomColor = (role: keyof ThemeColors, hex: string) => {
    if (resolvedMode === 'dark') {
      const updated = { ...customColorsDark, [role]: hex };
      setCustomColorsDark(updated);
      localStorage.setItem('duo_custom_dark', JSON.stringify(updated));
    } else {
      const updated = { ...customColorsLight, [role]: hex };
      setCustomColorsLight(updated);
      localStorage.setItem('duo_custom_light', JSON.stringify(updated));
    }
    if (theme !== 'custom') {
      setThemeState('custom');
      localStorage.setItem('duo_theme', 'custom');
    }
  };

  const setPartnerColor = (isPartnerA: boolean, hex: string) => {
    setCustomColor(isPartnerA ? 'partnerA' : 'partnerB', hex);
    if (currentUser?.id) {
      updateProfile(currentUser.id, { [isPartnerA ? 'partnerAColor' : 'partnerBColor']: hex }).catch(() => {});
    }
  };

  const resetTheme = () => {
    setCustomColorsLight({});
    setCustomColorsDark({});
    localStorage.removeItem('duo_custom_light');
    localStorage.removeItem('duo_custom_dark');
    setTheme('hazard');
    setMode('auto');
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        mode,
        resolvedMode,
        currentColors,
        customColorsLight,
        customColorsDark,
        setTheme,
        setMode,
        toggleMode,
        setCustomColor,
        setPartnerColor,
        resetTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
