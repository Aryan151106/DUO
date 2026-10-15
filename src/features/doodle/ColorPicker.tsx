import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Pipette, Plus, Check } from 'lucide-react';

export interface ColorPickerProps {
  color: string;
  onChange: (hex: string) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  recentColors?: string[];
  savedSwatches?: string[];
  onAddSwatch?: (hex: string) => void;
  className?: string;
}

// Convert Hex to RGB
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r || 0, g || 0, b || 0];
  }
  const num = parseInt(clean.substring(0, 6), 16);
  if (Number.isNaN(num)) return [255, 107, 107];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Convert RGB to Hex
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Convert RGB to HSV
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

// Convert HSV to RGB
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100;
  v /= 100;
  const i = Math.floor((h / 60) % 6);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0, g = 0, b = 0;
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export const PRESET_SWATCHES = [
  '#FF6B6B', // Coral
  '#7C6CF2', // Lavender
  '#FFD166', // Butter yellow
  '#2BB58B', // Mint green
  '#339AF0', // Sky blue
  '#BE4BDB', // Grape purple
  '#F76707', // Orange
  '#1F1D2B', // Deep ink
  '#FFFFFF', // Chalk white
  '#F43F5E', // Rose
  '#14B8A6', // Teal
  '#EAB308', // Amber
];

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onChange,
  opacity = 1,
  onOpacityChange,
  recentColors = [],
  savedSwatches = PRESET_SWATCHES,
  onAddSwatch,
  className = '',
}) => {
  // Parse initial color into HSV
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(color);
    return rgbToHsv(r, g, b);
  });

  const [hexInput, setHexInput] = useState(color.toUpperCase());
  const [rgbInput, setRgbInput] = useState<[number, number, number]>(() => hexToRgb(color));
  const isDraggingSatVal = useRef(false);
  const isDraggingHue = useRef(false);
  const satValRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Sync state if external color changes
  useEffect(() => {
    const [r, g, b] = hexToRgb(color);
    setHsv(rgbToHsv(r, g, b));
    setHexInput(color.toUpperCase());
    setRgbInput([r, g, b]);
  }, [color]);

  // Update color from HSV
  const updateFromHsv = useCallback(
    (newHsv: [number, number, number]) => {
      setHsv(newHsv);
      const [r, g, b] = hsvToRgb(newHsv[0], newHsv[1], newHsv[2]);
      const hex = rgbToHex(r, g, b);
      setHexInput(hex);
      setRgbInput([r, g, b]);
      onChange(hex);
    },
    [onChange]
  );

  // 1. Saturation & Value (Shade Area) Handlers
  const handleSatValPointer = (e: React.PointerEvent) => {
    if (!satValRef.current) return;
    const rect = satValRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const s = Math.round((x / rect.width) * 100);
    const v = Math.round(100 - (y / rect.height) * 100);
    updateFromHsv([hsv[0], s, v]);
  };

  const onSatValDown = (e: React.PointerEvent) => {
    isDraggingSatVal.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleSatValPointer(e);
  };

  const onSatValMove = (e: React.PointerEvent) => {
    if (isDraggingSatVal.current) {
      handleSatValPointer(e);
    }
  };

  const onSatValUp = (e: React.PointerEvent) => {
    isDraggingSatVal.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // 2. Hue Slider Handlers
  const handleHuePointer = (e: React.PointerEvent) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = Math.round((x / rect.width) * 360) % 360;
    updateFromHsv([h, hsv[1], hsv[2]]);
  };

  const onHueDown = (e: React.PointerEvent) => {
    isDraggingHue.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleHuePointer(e);
  };

  const onHueMove = (e: React.PointerEvent) => {
    if (isDraggingHue.current) {
      handleHuePointer(e);
    }
  };

  const onHueUp = (e: React.PointerEvent) => {
    isDraggingHue.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // 3. Hex Input Change
  const handleHexChange = (val: string) => {
    let clean = val.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    setHexInput(clean.toUpperCase());

    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      const [r, g, b] = hexToRgb(clean);
      setRgbInput([r, g, b]);
      setHsv(rgbToHsv(r, g, b));
      onChange(clean.toUpperCase());
    }
  };

  // 4. RGB Input Change
  const handleRgbChange = (index: 0 | 1 | 2, val: number) => {
    const updated: [number, number, number] = [...rgbInput];
    updated[index] = Math.max(0, Math.min(255, val || 0));
    setRgbInput(updated);
    const hex = rgbToHex(updated[0], updated[1], updated[2]);
    setHexInput(hex);
    setHsv(rgbToHsv(updated[0], updated[1], updated[2]));
    onChange(hex);
  };

  // Eyedropper API (if browser supports it)
  const openEyeDropper = async () => {
    if (typeof window !== 'undefined' && 'EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          handleHexChange(result.sRGBHex);
        }
      } catch (e) {
        // user cancelled
      }
    }
  };

  const pureHueRgb = hsvToRgb(hsv[0], 100, 100);
  const pureHueHex = rgbToHex(pureHueRgb[0], pureHueRgb[1], pureHueRgb[2]);

  return (
    <div className={`flex flex-col gap-3 w-full max-w-[320px] select-none ${className}`}>
      {/* 2D Shade Area (Saturation & Value) */}
      <div
        ref={satValRef}
        onPointerDown={onSatValDown}
        onPointerMove={onSatValMove}
        onPointerUp={onSatValUp}
        className="relative w-full h-36 rounded-2xl cursor-crosshair overflow-hidden touch-none border-2 border-[var(--border)] shadow-xs"
        style={{
          backgroundColor: pureHueHex,
          backgroundImage: `
            linear-gradient(to right, #fff, transparent),
            linear-gradient(to top, #000, transparent)
          `,
        }}
      >
        {/* Thumb pointer */}
        <div
          className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-white shadow-md pointer-events-none transition-transform"
          style={{
            left: `${hsv[1]}%`,
            top: `${100 - hsv[2]}%`,
            backgroundColor: color,
          }}
        />
      </div>

      {/* 1D Rainbow Hue Slider */}
      <div className="flex flex-col gap-1">
        <div
          ref={hueRef}
          onPointerDown={onHueDown}
          onPointerMove={onHueMove}
          onPointerUp={onHueUp}
          className="relative w-full h-6 rounded-full cursor-pointer touch-none border-2 border-[var(--border)] shadow-xs"
          style={{
            background:
              'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }}
        >
          {/* Hue Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-5 h-5 -ml-2.5 rounded-full border-2 border-white shadow-md bg-white pointer-events-none"
            style={{
              left: `${(hsv[0] / 360) * 100}%`,
              backgroundColor: pureHueHex,
            }}
          />
        </div>
      </div>

      {/* Opacity Slider (if provided) */}
      {onOpacityChange && (
        <div className="flex items-center gap-2">
          <span className="font-ui text-xs font-semibold text-[var(--text-muted)] w-14 shrink-0">
            Opacity:
          </span>
          <div className="relative flex-1 h-5 rounded-full border-2 border-[var(--border)] overflow-hidden bg-checkerboard flex items-center">
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.01"
              value={opacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              className="w-full h-full opacity-80 cursor-pointer accent-[var(--accent)]"
              aria-label="Color opacity"
            />
          </div>
          <span className="font-numeric text-xs font-bold text-[var(--text)] w-9 text-right tabular-nums">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      )}

      {/* Color Preview & Hex / RGB row */}
      <div className="flex items-center gap-2 pt-1">
        {/* Preview swatch */}
        <div className="relative w-10 h-10 rounded-2xl border-2 border-[var(--border)] shadow-xs overflow-hidden shrink-0">
          <div
            className="w-full h-full"
            style={{
              backgroundColor: color,
              opacity,
            }}
          />
        </div>

        {/* Hex input */}
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value)}
            maxLength={7}
            placeholder="#FF6B6B"
            className="w-full px-2.5 py-1.5 rounded-xl bg-[var(--surface-2)] border-2 border-[var(--border)] font-mono text-xs font-bold text-[var(--text)] uppercase tracking-wider outline-none text-center"
            aria-label="Hex color value"
          />
        </div>

        {/* Eyedropper button (if supported) */}
        {typeof window !== 'undefined' && 'EyeDropper' in window && (
          <button
            type="button"
            onClick={openEyeDropper}
            className="p-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text)] cursor-pointer shrink-0"
            title="Sample color from screen"
            aria-label="Eyedropper tool"
          >
            <Pipette className="w-4 h-4" />
          </button>
        )}

        {/* Save to Swatches button */}
        {onAddSwatch && (
          <button
            type="button"
            onClick={() => onAddSwatch(color)}
            className="p-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--border)] cursor-pointer shrink-0 transition-colors"
            title="Save current color"
            aria-label="Save color swatch"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Precision RGB inputs */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['R', 'G', 'B'] as const).map((channel, i) => (
          <div
            key={channel}
            className="flex items-center rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1"
          >
            <span className="font-ui text-[10px] font-bold text-[var(--text-muted)] mr-1">
              {channel}
            </span>
            <input
              type="number"
              min="0"
              max="255"
              value={rgbInput[i as 0 | 1 | 2]}
              onChange={(e) => handleRgbChange(i as 0 | 1 | 2, parseInt(e.target.value, 10))}
              className="w-full bg-transparent font-numeric text-xs font-bold text-[var(--text)] outline-none text-right"
              aria-label={`${channel} value`}
            />
          </div>
        ))}
      </div>

      {/* Recent Colors (if any) */}
      {recentColors.length > 0 && (
        <div className="pt-1">
          <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] mb-1.5">
            Recent Colors:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {recentColors.slice(0, 8).map((c, idx) => (
              <button
                key={`${c}-${idx}`}
                type="button"
                onClick={() => handleHexChange(c)}
                className={`w-7 h-7 rounded-full border-2 border-[var(--border)] transition-transform cursor-pointer relative ${
                  color.toUpperCase() === c.toUpperCase() ? 'scale-110 ring-2 ring-[var(--text)]' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={`Recent color ${c}`}
              >
                {color.toUpperCase() === c.toUpperCase() && (
                  <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md stroke-[3]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Preset Swatches */}
      {savedSwatches.length > 0 && (
        <div className="pt-1">
          <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] mb-1.5">
            Swatches:
          </span>
          <div className="grid grid-cols-6 gap-1.5">
            {savedSwatches.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleHexChange(c)}
                className={`w-8 h-8 rounded-xl border-2 border-[var(--border)] transition-transform cursor-pointer relative ${
                  color.toUpperCase() === c.toUpperCase() ? 'scale-110 ring-2 ring-[var(--text)]' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={c}
                aria-label={`Color swatch ${c}`}
              >
                {color.toUpperCase() === c.toUpperCase() && (
                  <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow-md stroke-[3]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
