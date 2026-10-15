import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Sparkles,
  Check,
  RotateCcw,
  AlertTriangle,
  Paintbrush,
  Heart,
  Clock,
  Wand2,
} from 'lucide-react';
import {
  useTheme,
  PRESET_THEMES,
  FLAT_SWATCHES_36,
  checkContrast,
  autoFixContrast,
  type ThemeColors,
  type ThemeMode,
} from '../../lib/theme';

interface ThemeChooserProps {
  compact?: boolean;
}

const COLOR_ROLES: { key: keyof ThemeColors; label: string; description: string }[] = [
  { key: 'bg', label: 'Background', description: 'App page backdrop' },
  { key: 'surface', label: 'Surface', description: 'Cards and dialogs' },
  { key: 'text', label: 'Text', description: 'Headings and reading text' },
  { key: 'partnerA', label: 'Alex (Partner A)', description: 'First partner color' },
  { key: 'partnerB', label: 'Sam (Partner B)', description: 'Second partner color' },
  { key: 'accent', label: 'Accent', description: 'Buttons, stars & highlights' },
  { key: 'urgent', label: 'Urgent', description: 'Nudges and alarms' },
];

export const ThemeChooser: React.FC<ThemeChooserProps> = ({ compact = false }) => {
  const {
    theme,
    mode,
    resolvedMode,
    currentColors,
    setTheme,
    setMode,
    setCustomColor,
    resetTheme,
  } = useTheme();

  const [activeRole, setActiveRole] = useState<keyof ThemeColors>('partnerA');
  const [showCustomizer, setShowCustomizer] = useState<boolean>(!compact);

  // WCAG Contrast Checks
  const bgContrast = checkContrast(currentColors.text, currentColors.bg);
  const surfaceContrast = checkContrast(currentColors.text, currentColors.surface);
  const hasContrastIssue = !bgContrast.passesAA || !surfaceContrast.passesAA;

  const handleAutoFix = () => {
    // Fix text against bg if needed
    if (!bgContrast.passesAA) {
      const fixedText = autoFixContrast(currentColors.text, currentColors.bg, 4.6);
      setCustomColor('text', fixedText);
    } else if (!surfaceContrast.passesAA) {
      const fixedText = autoFixContrast(currentColors.text, currentColors.surface, 4.6);
      setCustomColor('text', fixedText);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* 1. Mode Selector: 3-way segmented control */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs uppercase font-chunky font-bold tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <Sun className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Appearance Mode</span>
          </label>
          <span className="text-xs font-ui font-semibold text-[var(--text-muted)] capitalize">
            Current: {resolvedMode}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-[var(--surface-2)] rounded-2xl border-2 border-[var(--border)]">
          {(['light', 'dark', 'auto'] as ThemeMode[]).map((m) => {
            const isActive = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-ui font-semibold text-xs transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] -translate-y-0.5'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] border-2 border-transparent'
                }`}
              >
                {m === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
                {m === 'dark' && <Moon className="w-4 h-4 text-indigo-400" />}
                {m === 'auto' && (
                  <div className="w-4 h-4 rounded-full border-2 border-current flex overflow-hidden">
                    <span className="w-1/2 h-full bg-current" />
                  </div>
                )}
                <span className="capitalize">{m}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Theme Presets Grid */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-xs uppercase font-chunky font-bold tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--partner-a)]" />
            <span>Preset Vibes</span>
          </label>
          <span className="text-xs font-ui font-medium text-[var(--text-muted)]">
            6 Handcrafted Palettes
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(Object.values(PRESET_THEMES) as Array<typeof PRESET_THEMES[keyof typeof PRESET_THEMES]>).map((preset) => {
            const isSelected = theme === preset.id;
            const colors = resolvedMode === 'dark' ? preset.dark : preset.light;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setTheme(preset.id)}
                className={`relative p-3 rounded-2xl text-left transition-all cursor-pointer border-3 ${
                  isSelected
                    ? 'border-[var(--text)] ring-2 ring-[var(--text)] ring-offset-2 -translate-y-1 shadow-[0_4px_0_var(--shadow-color)]'
                    : 'border-[var(--border)] hover:-translate-y-0.5 shadow-[0_2px_0_var(--shadow-color)]'
                }`}
                style={{ backgroundColor: colors.bg }}
              >
                {/* Mini Preview Box */}
                <div
                  className="rounded-xl p-2.5 mb-2 border-2"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[11px] font-logo font-bold truncate"
                      style={{ color: colors.text }}
                    >
                      {preset.name}
                    </span>
                    {isSelected && (
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: colors.partnerA }}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Swatch dots */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: colors.partnerA }}
                      title="Partner A"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: colors.partnerB }}
                      title="Partner B"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: colors.accent }}
                      title="Accent"
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: colors.urgent }}
                      title="Urgent"
                    />
                  </div>
                </div>

                <p
                  className="text-[11px] font-body line-clamp-1 leading-tight opacity-80"
                  style={{ color: colors.text }}
                >
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Live Interactive Preview Card */}
      <div className="p-4 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
        <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-[var(--border)]">
          <span className="text-xs font-chunky font-bold tracking-wider text-[var(--text-muted)] uppercase flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Live Interactive Preview</span>
          </span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[11px] font-chunky font-bold text-[var(--text)] border border-[var(--border)]">
            {resolvedMode.toUpperCase()} MODE
          </span>
        </div>

        {/* Live Mock UI Elements */}
        <div className="space-y-3">
          {/* Top row: Partner Clock Tile + Nudge Pill */}
          <div className="grid grid-cols-2 gap-2">
            {/* Clock Tile */}
            <div className="p-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--partner-b)] shrink-0" />
              <div className="min-w-0">
                <div className="font-numeric text-xs font-bold text-[var(--text)] tabular-nums truncate">
                  3:07 PM
                </div>
                <div className="text-[10px] font-ui font-medium text-[var(--text-muted)] truncate">
                  Sam is online
                </div>
              </div>
            </div>

            {/* Urgent Nudge Pill */}
            <div className="p-2.5 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--urgent)] flex items-center justify-center text-center">
              <span className="font-loud text-xs tracking-wider text-[var(--urgent)] uppercase">
                THINKING OF YOU! ⚡
              </span>
            </div>
          </div>

          {/* Sample Mission */}
          <div className="p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-full bg-[var(--partner-a)] flex items-center justify-center text-white shrink-0">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div className="min-w-0">
                <div className="font-chunky text-xs font-bold text-[var(--text)] truncate">
                  Cook dinner together
                </div>
                <div className="font-ui text-[10px] font-semibold text-[var(--partner-a)]">
                  For You • Today
                </div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[var(--surface)] text-[10px] font-chunky font-bold text-[var(--text-muted)] border border-[var(--border)] shrink-0">
              0/1 Done
            </span>
          </div>

          {/* Chat Bubble & Quick Love Chip */}
          <div className="flex items-center justify-between gap-2 pt-1">
            {/* Quick Love Chip */}
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] font-chunky font-bold text-xs flex items-center gap-1.5 shadow-[0_2px_0_var(--shadow-color)]"
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
              <span>Hug 🤗</span>
            </button>

            {/* Chat message */}
            <div className="max-w-[65%] px-3 py-1.5 rounded-2xl rounded-tr-sm bg-[var(--partner-a)] text-white font-body text-xs font-semibold shadow-[0_2px_0_var(--shadow-color)]">
              Can't wait to see what you make together!
            </div>
          </div>

          {/* Doodle Stroke Demonstration */}
          <div className="pt-2 flex items-center gap-2">
            <span className="text-[10px] font-hand text-[var(--text-muted)] shrink-0">
              Doodle Ink:
            </span>
            <div className="flex-1 h-3 rounded-full bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden flex items-center px-1">
              <div className="w-2/3 h-1.5 rounded-full bg-[var(--partner-b)]" />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Contrast Warning & Auto-Fix Banner */}
      {hasContrastIssue && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200 font-ui font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              Text contrast ratio ({bgContrast.ratio}:1) is below WCAG AA standard (4.5:1).
            </span>
          </div>
          <button
            type="button"
            onClick={handleAutoFix}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-chunky font-bold text-xs flex items-center gap-1.5 shrink-0 transition-all cursor-pointer shadow-[0_2px_0_#b45309]"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Auto-Fix</span>
          </button>
        </div>
      )}

      {/* 5. "Make It Yours" Customizer Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setShowCustomizer(!showCustomizer)}
            className="flex items-center gap-2 text-xs uppercase font-chunky font-bold tracking-wider text-[var(--text)] hover:text-[var(--partner-a)] transition-colors cursor-pointer"
          >
            <Paintbrush className="w-4 h-4 text-[var(--partner-a)]" />
            <span>Make It Yours (Custom Colors)</span>
            <span className="text-[10px] font-ui normal-case text-[var(--text-muted)]">
              {showCustomizer ? '(Click to collapse)' : '(Click to expand)'}
            </span>
          </button>

          <button
            type="button"
            onClick={resetTheme}
            className="flex items-center gap-1 text-xs font-ui font-semibold text-[var(--text-muted)] hover:text-[var(--urgent)] transition-colors cursor-pointer"
            title="Reset theme and colors to defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to default</span>
          </button>
        </div>

        {showCustomizer && (
          <div className="p-4 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] space-y-4">
            {/* Role Switcher Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {COLOR_ROLES.map((r) => {
                const isActive = activeRole === r.key;
                const currentColorVal = currentColors[r.key];
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setActiveRole(r.key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-ui font-bold whitespace-nowrap transition-all cursor-pointer border-2 ${
                      isActive
                        ? 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--text)] shadow-[0_2px_0_var(--shadow-color)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20 shrink-0"
                      style={{ backgroundColor: currentColorVal }}
                    />
                    <span>{r.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Role Editor */}
            <div className="p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-chunky font-bold text-[var(--text)]">
                    Edit {COLOR_ROLES.find((r) => r.key === activeRole)?.label}
                  </div>
                  <div className="text-[11px] font-body text-[var(--text-muted)]">
                    {COLOR_ROLES.find((r) => r.key === activeRole)?.description}
                  </div>
                </div>

                {/* Direct Hex & Native Color Input */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="color"
                      value={currentColors[activeRole]}
                      onChange={(e) => setCustomColor(activeRole, e.target.value.toUpperCase())}
                      className="w-8 h-8 rounded-lg cursor-pointer border-2 border-[var(--border)] bg-transparent p-0 overflow-hidden"
                      title="Choose native color"
                    />
                  </div>
                  <input
                    type="text"
                    value={currentColors[activeRole]}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      if (val.startsWith('#') && val.length <= 7) {
                        setCustomColor(activeRole, val.toUpperCase());
                      }
                    }}
                    placeholder="#RRGGBB"
                    maxLength={7}
                    className="w-24 px-2 py-1 text-xs font-numeric font-bold rounded-lg bg-[var(--surface)] text-[var(--text)] border-2 border-[var(--border)] uppercase"
                  />
                </div>
              </div>

              {/* 36 Flat Color Swatches Palette */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-chunky uppercase tracking-wider text-[var(--text-muted)]">
                  36 Flat Spectrum Swatches:
                </span>
                <div className="grid grid-cols-9 sm:grid-cols-12 gap-1.5">
                  {FLAT_SWATCHES_36.map((swatch) => {
                    const isCurrent = currentColors[activeRole].toUpperCase() === swatch.toUpperCase();
                    return (
                      <button
                        key={swatch}
                        type="button"
                        onClick={() => setCustomColor(activeRole, swatch)}
                        className={`w-7 h-7 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-center ${
                          isCurrent
                            ? 'border-black dark:border-white scale-110 shadow-[0_2px_0_rgba(0,0,0,0.4)]'
                            : 'border-black/15 hover:scale-105'
                        }`}
                        style={{ backgroundColor: swatch }}
                        title={swatch}
                      >
                        {isCurrent && <Check className="w-3.5 h-3.5 stroke-[3] text-white mix-blend-difference" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
