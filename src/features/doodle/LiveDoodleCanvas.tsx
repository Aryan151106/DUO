import React, { useState, useRef, useEffect } from 'react';
import { getStroke } from 'perfect-freehand';
import { useAuthStore } from '../../lib/store';
import { soundEngine } from '../../lib/sounds';
import { broadcastEvent, duoBroadcast } from '../../lib/supabase';
import type { RealtimeEnvelope } from '../../lib/supabase';
import {
  uploadDoodle,
  subscribeDoodles,
  type DoodleMetadata,
  type DoodleStroke,
  type StrokePoint,
} from '../../lib/doodleStorage';
import {
  Eraser,
  Undo2,
  Trash2,
  Send,
  Sparkles,
  SunMedium,
  Image as ImageIcon,
  RotateCcw,
  Check,
  AlertCircle,
  Loader2,
  Sliders,
  Maximize2,
  X,
  Palette,
  Layers,
  PenTool,
  Highlighter as MarkerIcon,
  Zap,
  Square,
  Circle,
  Heart,
  Star,
  Minus,
} from 'lucide-react';
import { ColorPicker, PRESET_SWATCHES } from './ColorPicker';

type ShapeKind = 'line' | 'circle' | 'rectangle' | 'heart' | 'star';
type ToolKind = 'pen' | 'marker' | 'highlighter' | 'spray' | 'neon' | 'calligraphy' | 'shape';

const VIRTUAL_WIDTH = 1600;
const VIRTUAL_HEIGHT = 1200;

function getSvgPathFromStroke(strokePoints: number[][]): string {
  if (!strokePoints.length) return '';
  const d = strokePoints.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...strokePoints[0], 'Q']
  );
  d.push('Z');
  return d.join(' ');
}

function getRenderedStrokePath(stroke: DoodleStroke): string {
  const thinning =
    stroke.tool === 'calligraphy' ? 0.9 : stroke.tool === 'marker' || stroke.tool === 'highlighter' ? 0.1 : 0.5;
  const smoothing = stroke.tool === 'spray' ? 0.25 : 0.7;
  const points = getStroke(
    stroke.points.map((p) => [p.x, p.y, p.pressure || 0.5]),
    {
      size:
        stroke.tool === 'marker'
          ? stroke.size * 1.8
          : stroke.tool === 'highlighter'
          ? stroke.size * 2.4
          : stroke.size,
      thinning,
      smoothing,
      streamline: 0.6,
    }
  );
  return getSvgPathFromStroke(points);
}

function renderStroke(
  stroke: DoodleStroke,
  paperStaysLight: boolean,
  shapeKind: ShapeKind,
  shapeFill: boolean = false
) {
  const fillColor = stroke.isEraser
    ? paperStaysLight
      ? '#FFFFFF'
      : 'var(--surface)'
    : stroke.color;
  const opacity = stroke.opacity ?? 1;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1] || first;
  const minX = Math.min(first?.x || 0, last?.x || 0);
  const minY = Math.min(first?.y || 0, last?.y || 0);
  const width = Math.abs((last?.x || 0) - (first?.x || 0));
  const height = Math.abs((last?.y || 0) - (first?.y || 0));

  if (stroke.tool === 'shape' && first && last) {
    const selectedShape = stroke.shape || shapeKind;
    const isFilled = (stroke as any).isFilled ?? shapeFill;
    const fill = isFilled ? fillColor : 'none';
    const strokeVal = fillColor;

    if (selectedShape === 'circle') {
      return (
        <ellipse
          cx={minX + width / 2}
          cy={minY + height / 2}
          rx={Math.max(width / 2, 4)}
          ry={Math.max(height / 2, 4)}
          fill={fill}
          stroke={strokeVal}
          strokeWidth={stroke.size}
          opacity={opacity}
        />
      );
    }
    if (selectedShape === 'rectangle') {
      return (
        <rect
          x={minX}
          y={minY}
          width={Math.max(width, 4)}
          height={Math.max(height, 4)}
          fill={fill}
          stroke={strokeVal}
          strokeWidth={stroke.size}
          opacity={opacity}
          rx={stroke.size}
        />
      );
    }
    if (selectedShape === 'heart') {
      const x = minX;
      const y = minY;
      return (
        <path
          d={`M ${x + width / 2} ${y + height} C ${x - width * 0.15} ${y + height * 0.45}, ${x + width * 0.2} ${y}, ${x + width / 2} ${y + height * 0.3} C ${x + width * 0.8} ${y}, ${x + width * 1.15} ${y + height * 0.45}, ${x + width / 2} ${y + height} Z`}
          fill={isFilled ? fillColor : 'none'}
          stroke={strokeVal}
          strokeWidth={isFilled ? 0 : stroke.size}
          opacity={opacity}
        />
      );
    }
    if (selectedShape === 'star') {
      const cx = minX + width / 2;
      const cy = minY + height / 2;
      const radius = Math.max(Math.min(width, height) / 2, 5);
      const points = Array.from({ length: 10 }, (_, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const currentRadius = index % 2 === 0 ? radius : radius * 0.42;
        return `${cx + Math.cos(angle) * currentRadius},${cy + Math.sin(angle) * currentRadius}`;
      }).join(' ');
      return (
        <polygon
          points={points}
          fill={isFilled ? fillColor : 'none'}
          stroke={strokeVal}
          strokeWidth={isFilled ? 0 : stroke.size}
          opacity={opacity}
        />
      );
    }
    return (
      <line
        x1={first.x}
        y1={first.y}
        x2={last.x}
        y2={last.y}
        stroke={strokeVal}
        strokeWidth={stroke.size}
        strokeLinecap="round"
        opacity={opacity}
      />
    );
  }

  if (stroke.tool === 'spray') {
    return (
      <g opacity={opacity}>
        {stroke.points.flatMap((point, index) =>
          Array.from({ length: 5 }, (_, dotIndex) => {
            const seed = (index + 1) * (dotIndex + 3);
            const offset = ((seed * 17) % 23) - 11;
            return (
              <circle
                key={`${stroke.id}-${index}-${dotIndex}`}
                cx={point.x + offset}
                cy={point.y + (((seed * 11) % 19) - 9)}
                r={Math.max(0.8, stroke.size / 7)}
                fill={fillColor}
              />
            );
          })
        )}
      </g>
    );
  }

  const path = <path d={getRenderedStrokePath(stroke)} fill={fillColor} opacity={opacity} />;
  if (stroke.tool === 'neon' && !stroke.isEraser) {
    return (
      <g filter="url(#duo-neon-glow)">
        <path d={getRenderedStrokePath(stroke)} fill={fillColor} opacity={Math.min(opacity, 0.5)} />
        {path}
      </g>
    );
  }
  return path;
}

export const LiveDoodleCanvas: React.FC = () => {
  const { currentUser, partnerUser, couple, setTab, isDemoMode } = useAuthStore();

  // Drawing state
  const [strokes, setStrokes] = useState<DoodleStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<DoodleStroke | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>('#FF6B6B');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [isEraser, setIsEraser] = useState<boolean>(false);
  const [tool, setTool] = useState<ToolKind>('pen');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('line');
  const [shapeFill, setShapeFill] = useState<boolean>(false);
  const [opacity, setOpacity] = useState<number>(1);
  const [activeLayer, setActiveLayer] = useState<number>(1);
  const [redoStack, setRedoStack] = useState<DoodleStroke[]>([]);
  const [canvasBackground, setCanvasBackground] = useState<'plain' | 'grid' | 'dots' | 'paper'>('plain');
  const [partnerDrawing, setPartnerDrawing] = useState<boolean>(false);
  const [paperStaysLight, setPaperStaysLight] = useState<boolean>(false);

  // Tools panel state (closed by default)
  const [isToolsOpen, setIsToolsOpen] = useState<boolean>(false);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  // Recent & saved colors
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('duo_recent_doodle_colors');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return ['#FF6B6B', '#7C6CF2', '#FFD166', '#2BB58B', '#339AF0'];
  });

  const [savedSwatches, setSavedSwatches] = useState<string[]>(PRESET_SWATCHES);

  // ViewBox pan & zoom transform for canvas
  const [viewBox, setViewBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: VIRTUAL_WIDTH,
    h: VIRTUAL_HEIGHT,
  });

  // Multitouch gesture tracking
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistRef = useRef<number | null>(null);
  const initialViewBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Note & Send state
  const [caption, setCaption] = useState<string>('');
  const [isNoteExpanded, setIsNoteExpanded] = useState<boolean>(false);
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [sendProgress, setSendProgress] = useState<number>(0);
  const [sendError, setSendError] = useState<string | null>(null);

  // Gallery state
  const [gallery, setGallery] = useState<DoodleMetadata[]>([]);
  const [showGallery, setShowGallery] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const lastBroadcastTime = useRef<number>(0);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Handle color change without resetting brush, layer, size, or opacity
  const handleColorChange = (newColor: string) => {
    setSelectedColor(newColor);
    setIsEraser(false);
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c.toUpperCase() !== newColor.toUpperCase());
      const updated = [newColor, ...filtered].slice(0, 8);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('duo_recent_doodle_colors', JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });
  };

  const handleAddSwatch = (hex: string) => {
    if (!savedSwatches.includes(hex)) {
      setSavedSwatches((prev) => [...prev, hex]);
    }
  };

  // Close tools panel on Escape or outside tap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsToolsOpen(false);
        setShowClearConfirm(false);
        setShowGallery(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Subscribe to partner doodles in Firestore
  useEffect(() => {
    if (!couple?.id || isDemoMode) return;
    const unsub = subscribeDoodles(couple.id, (items) => {
      setGallery(items);
    });
    return () => unsub();
  }, [couple?.id, isDemoMode]);

  // Real-time remote strokes listener from partner
  useEffect(() => {
    if (!duoBroadcast) return;

    const handleMessage = (e: MessageEvent<RealtimeEnvelope>) => {
      const data = e.data;
      if (!data || data.senderId === currentUser.id) return;

      if (data.type === 'DOODLE_STROKE') {
        const stroke = data.payload as DoodleStroke;
        setPartnerDrawing(true);
        setStrokes((prev) => {
          const existingIdx = prev.findIndex((s) => s.id === stroke.id);
          if (existingIdx !== -1) {
            const next = [...prev];
            next[existingIdx] = stroke;
            return next;
          }
          return [...prev, stroke];
        });
        setTimeout(() => setPartnerDrawing(false), 800);
      } else if (data.type === 'DOODLE_CLEAR') {
        setStrokes([]);
      }
    };

    const bc = duoBroadcast;
    bc.addEventListener('message', handleMessage);
    return () => {
      bc.removeEventListener('message', handleMessage);
    };
  }, [currentUser.id]);

  // Map pointer client coordinates into virtual canvas viewBox coordinates
  const getVirtualPoint = (clientX: number, clientY: number, pressure: number = 0.5): StrokePoint => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY, pressure };
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return { x: clientX, y: clientY, pressure };

    // Use the SVG transform instead of the element bounds so coordinates stay
    // aligned when preserveAspectRatio adds letterboxing or the canvas zooms.
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const virtualPoint = point.matrixTransform(screenMatrix.inverse());
    return { x: virtualPoint.x, y: virtualPoint.y, pressure };
  };

  // Reset zoom & pan to default full canvas
  const handleFitCanvas = () => {
    soundEngine.play('msg-pop', { force: true });
    setViewBox({
      x: 0,
      y: 0,
      w: VIRTUAL_WIDTH,
      h: VIRTUAL_HEIGHT,
    });
  };

  // Pointer Down (1-finger draw, 2-finger pan & zoom)
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 1-Finger Drawing
    if (activePointersRef.current.size === 1) {
      const pt = getVirtualPoint(e.clientX, e.clientY, e.pressure);
      const newStroke: DoodleStroke = {
        id: `str-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        points: [pt],
        color: selectedColor,
        size: brushSize,
        isEraser,
        tool,
        opacity: tool === 'highlighter' ? Math.min(opacity, 0.35) : opacity,
        layer: activeLayer,
        shape: tool === 'shape' ? shapeKind : undefined,
      };
      (newStroke as any).isFilled = shapeFill;
      setCurrentStroke(newStroke);
    }
    // 2-Finger Pinch / Pan Start
    else if (activePointersRef.current.size === 2) {
      setCurrentStroke(null); // Cancel single finger stroke if a second finger joins
      const pts = Array.from(activePointersRef.current.values());
      initialPinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialViewBoxRef.current = { ...viewBox };
    }
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 1-Finger Drawing
    if (activePointersRef.current.size === 1 && currentStroke) {
      const pt = getVirtualPoint(e.clientX, e.clientY, e.pressure);
      const updated: DoodleStroke = {
        ...currentStroke,
        points: [...currentStroke.points, pt],
      };
      setCurrentStroke(updated);

      // Throttled partner broadcast (60ms)
      const now = Date.now();
      if (now - lastBroadcastTime.current > 60) {
        lastBroadcastTime.current = now;
        broadcastEvent('DOODLE_STROKE', updated, currentUser.id, couple?.id || '');
      }
    }
    // 2-Finger Pinch & Pan
    else if (
      activePointersRef.current.size === 2 &&
      initialPinchDistRef.current !== null &&
      initialViewBoxRef.current !== null
    ) {
      const pts = Array.from(activePointersRef.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const zoomFactor = initialPinchDistRef.current / (currentDist || 1);

      // Clamp zoom between 0.5x and 4x
      const newW = Math.max(400, Math.min(3200, initialViewBoxRef.current.w * zoomFactor));
      const newH = Math.max(300, Math.min(2400, initialViewBoxRef.current.h * zoomFactor));

      const dx = (initialViewBoxRef.current.w - newW) / 2;
      const dy = (initialViewBoxRef.current.h - newH) / 2;

      setViewBox({
        x: initialViewBoxRef.current.x + dx,
        y: initialViewBoxRef.current.y + dy,
        w: newW,
        h: newH,
      });
    }
  };

  // Pointer Up
  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size === 0) {
      initialPinchDistRef.current = null;
      initialViewBoxRef.current = null;
      if (currentStroke) {
        setStrokes((prev) => [...prev, currentStroke]);
        setRedoStack([]);
        broadcastEvent('DOODLE_STROKE', currentStroke, currentUser.id, couple?.id || '');
        setCurrentStroke(null);
      }
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (e.ctrlKey || Math.abs(e.deltaY) > 20) {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 1.08 : 0.92;
      setViewBox((prev) => {
        const newW = Math.max(400, Math.min(3200, prev.w * zoomDelta));
        const newH = Math.max(300, Math.min(2400, prev.h * zoomDelta));
        const dx = (prev.w - newW) / 2;
        const dy = (prev.h - newH) / 2;
        return {
          x: prev.x + dx,
          y: prev.y + dy,
          w: newW,
          h: newH,
        };
      });
    }
  };

  // Undo & Redo
  const handleUndo = () => {
    soundEngine.play('msg-pop', { force: true });
    setStrokes((prev) => {
      if (!prev.length) return prev;
      setRedoStack((redo) => [...redo, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  };

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setStrokes((prev) => [...prev, next]);
    setRedoStack((prev) => prev.slice(0, -1));
  };

  // Clear Canvas (with confirmation step)
  const handleClear = () => {
    soundEngine.play('msg-pop', { force: true });
    setStrokes([]);
    setRedoStack([]);
    broadcastEvent('DOODLE_CLEAR', {}, currentUser.id, couple?.id || '');
  };

  // Send Doodle to chat
  const handleSendToChat = async () => {
    if (strokes.length === 0 || sendStatus === 'sending' || !couple?.id || !svgRef.current) return;

    setSendStatus('sending');
    setSendProgress(5);
    setSendError(null);

    try {
      await uploadDoodle({
        spaceId: couple.id,
        userId: currentUser.id,
        userName: currentUser.displayName,
        svgElement: svgRef.current,
        strokes,
        caption: caption.trim() || undefined,
        isDark: !paperStaysLight,
        onProgress: (pct) => setSendProgress(pct),
      });

      setSendStatus('sent');
      soundEngine.play('msg-ding', { force: true });

      setTimeout(() => {
        setStrokes([]);
        setCaption('');
        setIsNoteExpanded(false);
        setSendStatus('idle');
        setTab('chat');
      }, 900);
    } catch (err: any) {
      console.error('[LiveDoodleCanvas] Failed to upload doodle:', err);
      setSendStatus('failed');
      setSendError(err?.message || 'Failed to send drawing. Please retry.');
    }
  };

  const TOOLS_LIST: { id: ToolKind; label: string; icon: any }[] = [
    { id: 'pen', label: 'Pen', icon: PenTool },
    { id: 'marker', label: 'Marker', icon: MarkerIcon },
    { id: 'highlighter', label: 'Highlighter', icon: Sparkles },
    { id: 'spray', label: 'Spray', icon: Palette },
    { id: 'neon', label: 'Neon', icon: Zap },
    { id: 'calligraphy', label: 'Calligraphy', icon: PenTool },
    { id: 'shape', label: 'Shape', icon: Square },
  ];

  return (
    <div className="relative w-full h-[calc(100dvh-9rem)] min-h-[360px] flex flex-col min-h-0 flex-1 overflow-hidden select-none bg-[var(--surface)] rounded-3xl border-2 sm:border-3 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)]">
      {/* 1. TOP FLOATING CONTROLS OVER CANVAS */}
      <div className="absolute top-3 inset-x-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Floating Tools Trigger Button */}
        <button
          type="button"
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          className="pointer-events-auto px-3.5 py-2 rounded-2xl bg-[var(--surface)]/90 backdrop-blur-md border-2 border-[var(--border)] shadow-[0_2px_0_var(--shadow-color)] hover:bg-[var(--surface-2)] flex items-center gap-2 font-chunky text-xs font-bold text-[var(--text)] transition-transform active:scale-95 cursor-pointer"
          title="Open drawing tools"
          aria-label="Toggle drawing tools panel"
        >
          <Sliders className="w-4 h-4 text-[var(--accent)]" />
          <span>Tools</span>
          <span
            className="w-3 h-3 rounded-full border border-black/20 shrink-0"
            style={{ backgroundColor: selectedColor }}
          />
        </button>

        {/* Live Partner Drawing Indicator */}
        {partnerDrawing && (
          <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface)]/95 border-2 border-[var(--border)] shadow-xs text-xs font-ui text-[var(--text)] animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-[var(--partner-a)] animate-spin" />
            <span className="hidden sm:inline">{partnerUser.displayName} is drawing live…</span>
            <span className="sm:hidden">Partner drawing…</span>
          </div>
        )}

        {/* Quick Actions (Undo, Redo, Fit Canvas, Gallery) */}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="p-2 rounded-xl bg-[var(--surface)]/90 backdrop-blur-md text-[var(--text)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] disabled:opacity-40 cursor-pointer shadow-xs"
            title="Undo stroke"
            aria-label="Undo"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-xl bg-[var(--surface)]/90 backdrop-blur-md text-[var(--text)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] disabled:opacity-40 cursor-pointer shadow-xs"
            title="Redo stroke"
            aria-label="Redo"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleFitCanvas}
            className="p-2 rounded-xl bg-[var(--surface)]/90 backdrop-blur-md text-[var(--text)] hover:bg-[var(--surface-2)] border-2 border-[var(--border)] cursor-pointer shadow-xs"
            title="Fit Canvas (Reset Zoom/Pan)"
            aria-label="Fit Canvas"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowGallery(!showGallery)}
            className={`p-2 rounded-xl border-2 border-[var(--border)] font-chunky text-xs font-bold cursor-pointer shadow-xs flex items-center gap-1 ${
              showGallery ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--surface)]/90 backdrop-blur-md text-[var(--text)]'
            }`}
            title="Shared Doodle Gallery"
            aria-label="Open Gallery"
          >
            <ImageIcon className="w-4 h-4" />
            <span className="text-[11px] font-numeric font-bold">{gallery.length}</span>
          </button>
        </div>
      </div>

      {/* 2. MAIN EDGE-TO-EDGE DRAWING CANVAS */}
      <div className="relative w-full h-full flex-1 min-h-0 overflow-hidden cursor-crosshair touch-none">
        {/* Empty Canvas Guidance Hint */}
        {strokes.length === 0 && !currentStroke && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6 animate-in fade-in duration-300 z-10">
            <div className="px-5 py-3.5 rounded-3xl bg-[var(--surface)]/90 backdrop-blur-md border-2 border-[var(--border)] shadow-[0_4px_0_var(--shadow-color)] text-center space-y-1 max-w-sm">
              <p className="font-chunky text-sm font-bold text-[var(--text)]">
                Start drawing, or open Tools to choose a brush 🎨
              </p>
              <p className="font-ui text-xs text-[var(--text-muted)]">
                1 finger to draw • 2 fingers to pan & zoom
              </p>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          className="w-full h-full touch-none select-none"
          style={{
            backgroundColor: paperStaysLight ? '#FFFFFF' : 'var(--surface)',
            backgroundImage:
              canvasBackground === 'grid'
                ? 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)'
                : canvasBackground === 'dots'
                ? 'radial-gradient(var(--border) 1px, transparent 1px)'
                : canvasBackground === 'paper'
                ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 45%)'
                : undefined,
            backgroundSize: canvasBackground === 'dots' ? '20px 20px' : '30px 30px',
            touchAction: 'none',
          }}
        >
          <defs>
            <filter id="duo-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Committed strokes */}
          {strokes.map((stroke) => (
            <React.Fragment key={stroke.id}>
              {renderStroke(stroke, paperStaysLight, shapeKind, (stroke as any).isFilled)}
            </React.Fragment>
          ))}

          {/* Current active stroke */}
          {currentStroke && (
            <React.Fragment>
              {renderStroke(currentStroke, paperStaysLight, shapeKind, shapeFill)}
            </React.Fragment>
          )}
        </svg>
      </div>

      {/* 3. COMPACT BOTTOM NOTE & SEND BAR */}
      <div className="p-2 sm:p-2.5 bg-[var(--surface)]/95 backdrop-blur-md border-t-2 border-[var(--border)] flex items-center justify-between gap-2 z-20 shrink-0">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={caption}
            onFocus={() => setIsNoteExpanded(true)}
            onBlur={() => !caption && setIsNoteExpanded(false)}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add an optional sweet note…"
            maxLength={100}
            className={`w-full px-3 py-2 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] text-xs font-ui text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none transition-all ${
              isNoteExpanded ? 'ring-2 ring-[var(--accent)]' : ''
            }`}
          />
        </div>

        {sendStatus === 'failed' ? (
          <button
            type="button"
            onClick={handleSendToChat}
            className="h-10 px-4 rounded-2xl bg-[var(--urgent)] text-white border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_2px_0_var(--shadow-color)] flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSendToChat}
            disabled={strokes.length === 0 || sendStatus === 'sending'}
            className="h-10 px-5 rounded-2xl bg-[var(--partner-a)] text-white border-2 border-[var(--border)] font-chunky font-bold text-xs shadow-[0_2px_0_var(--shadow-color)] disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-0.5 transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {sendStatus === 'sending' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending {sendProgress}%…</span>
              </>
            ) : sendStatus === 'sent' ? (
              <>
                <Check className="w-3.5 h-3.5 text-white" />
                <span>Sent!</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send Doodle</span>
              </>
            )}
          </button>
        )}
      </div>

      {sendError && (
        <div className="px-4 py-1.5 bg-[var(--urgent)]/20 border-t border-[var(--urgent)] text-[var(--urgent)] text-xs font-ui flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{sendError}</span>
        </div>
      )}

      {/* 4. SLIDE-OUT TOOLS PANEL (Desktop Left Drawer & Mobile Bottom Sheet) */}
      {/* Mobile Backdrop */}
      {isToolsOpen && (
        <div
          onClick={() => setIsToolsOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-2xs animate-in fade-in"
        />
      )}

      <div
        ref={drawerRef}
        className={`fixed md:absolute z-50 md:z-40 transition-transform duration-300 ease-out bg-[var(--surface)]/98 backdrop-blur-xl border-[var(--border)] shadow-2xl flex flex-col ${
          // Mobile: Bottom sheet
          'inset-x-0 bottom-0 max-h-[82vh] rounded-t-[32px] border-t-3 border-x-2 md:rounded-3xl md:border-3 ' +
          // Desktop: Left side drawer
          'md:inset-auto md:top-3 md:left-3 md:bottom-16 md:w-80 md:max-h-none ' +
          (isToolsOpen
            ? 'translate-y-0 md:translate-x-0'
            : 'translate-y-full md:-translate-y-0 md:-translate-x-[110%]')
        }`}
      >
        {/* Mobile Grab Handle */}
        <div className="md:hidden w-full flex items-center justify-center pt-2.5 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-[var(--border)]" />
        </div>

        {/* Panel Header */}
        <div className="p-3.5 pb-2 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[var(--accent)]" />
            <h3 className="font-chunky text-sm font-bold text-[var(--text)]">Drawing Studio</h3>
          </div>
          <button
            type="button"
            onClick={() => setIsToolsOpen(false)}
            className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            aria-label="Close tools panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Panel Content (Organized in exact requested order) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {/* 1. TOOLS SECTION */}
          <div>
            <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              1. Tools
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {TOOLS_LIST.map((item) => {
                const Icon = item.icon;
                const isSelected = tool === item.id && !isEraser;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTool(item.id);
                      setIsEraser(false);
                    }}
                    className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-2xl border-2 transition-all cursor-pointer min-h-[52px] ${
                      isSelected
                        ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] shadow-xs scale-102 font-bold'
                        : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="font-ui text-[10px] leading-tight text-center">{item.label}</span>
                  </button>
                );
              })}

              {/* Eraser Tool */}
              <button
                type="button"
                onClick={() => setIsEraser(!isEraser)}
                className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-2xl border-2 transition-all cursor-pointer min-h-[52px] ${
                  isEraser
                    ? 'bg-rose-500 text-white border-[var(--border)] shadow-xs scale-102 font-bold'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] border-transparent'
                }`}
              >
                <Eraser className="w-4 h-4" />
                <span className="font-ui text-[10px] leading-tight text-center">Eraser</span>
              </button>
            </div>
          </div>

          {/* 2. COLOR SECTION */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                2. Color
              </span>
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="font-ui text-xs font-bold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>{showColorPicker ? 'Hide Picker' : 'More Colors'}</span>
              </button>
            </div>

            {/* Quick Recent Color Swatches */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
              {recentColors.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  type="button"
                  onClick={() => handleColorChange(c)}
                  className={`w-7 h-7 rounded-full border-2 border-[var(--border)] transition-transform cursor-pointer relative shrink-0 ${
                    !isEraser && selectedColor.toUpperCase() === c.toUpperCase()
                      ? 'scale-115 ring-2 ring-[var(--text)]'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                  aria-label={`Color ${c}`}
                >
                  {!isEraser && selectedColor.toUpperCase() === c.toUpperCase() && (
                    <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto drop-shadow-md stroke-[3]" />
                  )}
                </button>
              ))}
            </div>

            {/* Expandable Custom Color Picker */}
            {showColorPicker && (
              <div className="mt-3 p-3 rounded-2xl bg-[var(--surface-2)] border-2 border-[var(--border)] animate-in fade-in zoom-in-95">
                <ColorPicker
                  color={selectedColor}
                  onChange={handleColorChange}
                  opacity={opacity}
                  onOpacityChange={setOpacity}
                  recentColors={recentColors}
                  savedSwatches={savedSwatches}
                  onAddSwatch={handleAddSwatch}
                />
              </div>
            )}
          </div>

          {/* 3. TOOL SETTINGS SECTION */}
          <div>
            <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              3. Tool Settings ({isEraser ? 'Eraser' : tool.toUpperCase()})
            </span>

            {/* If Shape tool selected */}
            {tool === 'shape' && !isEraser && (
              <div className="space-y-3 mb-3 p-3 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
                <div>
                  <span className="block font-ui text-[10px] font-bold text-[var(--text-muted)] mb-1.5">
                    Shape Type:
                  </span>
                  <div className="grid grid-cols-5 gap-1">
                    {[
                      { kind: 'line', icon: Minus, label: 'Line' },
                      { kind: 'circle', icon: Circle, label: 'Circle' },
                      { kind: 'rectangle', icon: Square, label: 'Rect' },
                      { kind: 'heart', icon: Heart, label: 'Heart' },
                      { kind: 'star', icon: Star, label: 'Star' },
                    ].map((s) => {
                      const Icon = s.icon;
                      return (
                        <button
                          key={s.kind}
                          type="button"
                          onClick={() => setShapeKind(s.kind as ShapeKind)}
                          className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 cursor-pointer ${
                            shapeKind === s.kind
                              ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold'
                              : 'bg-[var(--surface)] text-[var(--text-muted)] border-transparent'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="text-[9px]">{s.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-ui text-xs font-semibold text-[var(--text-muted)]">
                    Shape Fill:
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShapeFill(false)}
                      className={`px-3 py-1 rounded-xl text-xs font-ui font-bold border ${
                        !shapeFill ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'
                      }`}
                    >
                      Outline
                    </button>
                    <button
                      type="button"
                      onClick={() => setShapeFill(true)}
                      className={`px-3 py-1 rounded-xl text-xs font-ui font-bold border ${
                        shapeFill ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'
                      }`}
                    >
                      Filled
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Brush / Eraser Size */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-ui text-xs font-semibold text-[var(--text-muted)]">
                  {isEraser ? 'Eraser Size:' : 'Brush Size:'}
                </span>
                <span className="font-numeric text-xs font-bold text-[var(--text)] tabular-nums">
                  {brushSize}px
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="48"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full accent-[var(--accent)] cursor-pointer"
                aria-label="Tool size"
              />
            </div>

            {/* Opacity (for drawing tools) */}
            {!isEraser && (
              <div className="space-y-2 mt-3">
                <div className="flex items-center justify-between">
                  <span className="font-ui text-xs font-semibold text-[var(--text-muted)]">
                    Opacity:
                  </span>
                  <span className="font-numeric text-xs font-bold text-[var(--text)] tabular-nums">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="w-full accent-[var(--accent)] cursor-pointer"
                  aria-label="Tool opacity"
                />
              </div>
            )}
          </div>

          {/* 4. LAYERS SECTION */}
          <div>
            <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              4. Layers
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 1, 2].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setActiveLayer(l)}
                  className={`py-2 px-2 rounded-2xl border-2 flex items-center justify-center gap-1.5 font-chunky text-xs cursor-pointer ${
                    activeLayer === l
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold shadow-xs'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-transparent'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Layer {l + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 5. CANVAS SECTION */}
          <div>
            <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              5. Canvas & Background
            </span>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {[
                { id: 'plain', label: 'Plain Paper' },
                { id: 'grid', label: 'Grid Paper' },
                { id: 'dots', label: 'Dot Grid' },
                { id: 'paper', label: 'Texture' },
              ].map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => setCanvasBackground(bg.id as any)}
                  className={`py-2 px-2.5 rounded-2xl border-2 font-ui text-xs font-semibold cursor-pointer text-center ${
                    canvasBackground === bg.id
                      ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)] font-bold'
                      : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-transparent'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaperStaysLight(!paperStaysLight)}
                className={`flex-1 py-2 px-3 rounded-2xl border-2 text-xs font-ui font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  paperStaysLight
                    ? 'bg-[var(--accent)] text-[var(--text)] border-[var(--border)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-transparent'
                }`}
              >
                <SunMedium className="w-4 h-4" />
                <span>Light Canvas</span>
              </button>

              <button
                type="button"
                onClick={handleFitCanvas}
                className="flex-1 py-2 px-3 rounded-2xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border-2 border-[var(--border)] text-xs font-ui font-bold text-[var(--text)] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Fit Canvas</span>
              </button>
            </div>
          </div>

          {/* 6. ACTIONS SECTION */}
          <div className="pt-1">
            <span className="block font-ui text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              6. Actions
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={strokes.length === 0}
                  className="flex-1 py-2 px-3 rounded-2xl bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] disabled:opacity-40 text-xs font-ui font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="flex-1 py-2 px-3 rounded-2xl bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] disabled:opacity-40 text-xs font-ui font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Redo</span>
                </button>
              </div>

              {/* Clear Canvas with Confirmation Prompt */}
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={strokes.length === 0}
                className="w-full py-2.5 px-3 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 border border-rose-500/30 text-xs font-ui font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Clear Canvas</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. CLEAR CANVAS CONFIRMATION MODAL */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-[var(--surface)] border-3 border-[var(--border)] rounded-3xl p-5 max-w-xs w-full text-center space-y-3 shadow-2xl">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-500 mx-auto flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <h4 className="font-chunky text-base font-bold text-[var(--text)]">Clear Canvas?</h4>
            <p className="font-ui text-xs text-[var(--text-muted)] leading-relaxed">
              Are you sure you want to erase all drawing strokes? This cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-[var(--surface-2)] text-[var(--text)] font-ui text-xs font-bold border border-[var(--border)] hover:bg-[var(--surface)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleClear();
                  setShowClearConfirm(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-ui text-xs font-bold shadow-md cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. GALLERY MODAL */}
      {showGallery && (
        <div className="absolute inset-x-2 sm:inset-x-8 top-16 bottom-16 z-50 p-4 rounded-3xl bg-[var(--surface)] border-3 border-[var(--border)] shadow-2xl flex flex-col animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <h3 className="font-chunky font-bold text-sm text-[var(--text)] flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[var(--accent)]" />
              <span>Our Shared Doodle Gallery</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowGallery(false)}
              className="p-1 rounded-xl hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {gallery.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 text-center text-xs font-ui text-[var(--text-muted)]">
                No doodles saved yet. Draw something cute above and hit Send! 🎨
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {gallery.map((doodle) => (
                  <div
                    key={doodle.id}
                    className="rounded-2xl border-2 border-[var(--border)] overflow-hidden bg-[var(--surface-2)] shadow-xs flex flex-col group"
                  >
                    <img
                      src={doodle.thumbnailUrl || doodle.imageUrl}
                      alt={doodle.caption || 'Doodle'}
                      className="w-full h-32 object-contain bg-white"
                    />
                    {doodle.caption && (
                      <div className="p-2 text-[11px] font-ui text-[var(--text)] truncate border-t border-[var(--border)]">
                        {doodle.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
