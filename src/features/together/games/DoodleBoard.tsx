import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { GameSession, DoodleState, DoodleStroke, DoodleStrokeChunk } from '../../../lib/games/types';
import { GoogleIcon } from '../../../components/GoogleIcon';
import { sfx } from '../../../lib/games/arcadeAudio';

interface DoodleBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  secretWord: string | null;
  doodleStrokes: DoodleStroke[];
  incomingLiveChunk?: DoodleStrokeChunk | null;
  onSendStroke: (stroke: DoodleStroke) => void;
  onSendStrokeChunk?: (chunk: DoodleStrokeChunk) => void;
  onClear: () => void;
  onRequestHint: () => void;
  onSubmitGuess: (guess: string) => Promise<{ correct: boolean; word?: string }>;
  onRematch: (options?: { mode?: 'keep' | 'change' }) => void;
  onLeave: () => void;
  rematchRequested: boolean;
}

const PALETTE = ['#2b2140', '#ff3d5a', '#2bb5d4', '#2fbf71', '#ffc233', '#a05cff'];

export const DoodleBoard: React.FC<DoodleBoardProps> = ({
  session,
  isMyTurn: _isMyTurn,
  myRole: _myRole,
  secretWord,
  doodleStrokes,
  incomingLiveChunk,
  onSendStroke,
  onSendStrokeChunk,
  onClear,
  onRequestHint,
  onSubmitGuess,
  onRematch,
  onLeave,
  rematchRequested,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentColor, setCurrentColor] = useState('#2b2140');
  const brushWidth = 5;
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const lastChunkIndexRef = useRef<number>(0);
  const strokeIdRef = useRef<string>('');

  const [guessInput, setGuessInput] = useState('');
  const [guessFeedback, setGuessFeedback] = useState<string | null>(null);
  const [shakingCanvas, setShakingCanvas] = useState(false);
  const [canvasJumping, setCanvasJumping] = useState(false);

  // Offline pass-and-play stage: 'pass-to-drawer' -> 'drawing' -> 'pass-to-guesser' -> 'guessing'
  const [localStage, setLocalStage] = useState<'pass-to-drawer' | 'drawing' | 'guessing'>(
    session.mode === 'local' ? 'pass-to-drawer' : 'drawing'
  );

  const state = session.state as DoodleState;
  const isFinished = session.status === 'finished';
  const isOnline = session.mode === 'online';

  const isDrawer = isOnline ? state.drawerId === session.currentTurnPlayerId : localStage === 'drawing';
  const isGuesser = isOnline ? !isDrawer : localStage === 'guessing';

  const drawerPlayer = session.players[state.drawerId] || { displayName: 'Drawer' };
  const guesserPlayer = session.players[state.guesserId] || { displayName: 'Guesser' };

  // Redraw all strokes whenever doodleStrokes array updates
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of doodleStrokes) {
      if (!stroke.points || stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color || '#2b2140';
      ctx.lineWidth = stroke.width || 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [doodleStrokes]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Live stream incoming stroke chunks onto receiver canvas in real time
  useEffect(() => {
    if (!incomingLiveChunk || !incomingLiveChunk.points || incomingLiveChunk.points.length < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.strokeStyle = incomingLiveChunk.color || '#2b2140';
    ctx.lineWidth = incomingLiveChunk.width || 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pts = incomingLiveChunk.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }, [incomingLiveChunk]);

  // Pointer event handlers for drawing
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || isFinished) return;
    if (Math.random() < 0.3) sfx('pop');
    setIsDrawing(true);
    const pt = getCanvasPoint(e);
    currentStrokeRef.current = [pt];
    lastChunkIndexRef.current = 0;
    strokeIdRef.current = `strk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = brushWidth;
        ctx.lineCap = 'round';
        ctx.moveTo(pt.x, pt.y);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isDrawer || isFinished) return;
    const pt = getCanvasPoint(e);
    currentStrokeRef.current.push(pt);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
    }

    // Stream chunk live every 5-6 points to avoid flooding while providing real-time drawing
    const pts = currentStrokeRef.current;
    if (onSendStrokeChunk && isOnline && pts.length - lastChunkIndexRef.current >= 5) {
      const chunkPoints = pts.slice(Math.max(0, lastChunkIndexRef.current - 1));
      lastChunkIndexRef.current = pts.length;
      onSendStrokeChunk({
        strokeId: strokeIdRef.current,
        points: chunkPoints,
        color: currentColor,
        width: brushWidth,
        isNewStroke: lastChunkIndexRef.current === 5,
        isComplete: false,
      });
    }
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const pts = currentStrokeRef.current;

    if (pts.length > 1) {
      const fullStroke: DoodleStroke = {
        points: pts,
        color: currentColor,
        width: brushWidth,
      };

      if (onSendStrokeChunk && isOnline) {
        const remainingChunk = pts.slice(Math.max(0, lastChunkIndexRef.current - 1));
        onSendStrokeChunk({
          strokeId: strokeIdRef.current,
          points: remainingChunk.length > 1 ? remainingChunk : pts,
          color: currentColor,
          width: brushWidth,
          isNewStroke: false,
          isComplete: true,
        });
      }

      onSendStroke(fullStroke);
    }
    currentStrokeRef.current = [];
    lastChunkIndexRef.current = 0;
  };

  const handleGuessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessInput.trim() || isFinished) return;
    const guessText = guessInput.trim();
    const res = await onSubmitGuess(guessText);

    if (res.correct) {
      sfx('win');
      setCanvasJumping(true);
      setTimeout(() => setCanvasJumping(false), 900);
      setGuessFeedback(`🎉 Correct! It was ${res.word?.toUpperCase()}!`);
    } else {
      sfx('wah');
      setShakingCanvas(true);
      setGuessFeedback(`“${guessText}” is incorrect`);
      setTimeout(() => setShakingCanvas(false), 500);
    }
    setGuessInput('');
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[840px] mx-auto space-y-2.5 sm:space-y-3 min-w-0">
      {/* Header Info */}
      <div className="w-full text-center min-w-0">
        {!isFinished ? (
          <div className="inline-flex flex-col items-center gap-1 px-3 sm:px-4 py-1.5 sm:py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)]">
            <span className="font-bold text-xs sm:text-base text-[var(--arcade-ink)]">
              {drawerPlayer.displayName} draws 🎨 • {guesserPlayer.displayName} guesses 🧐
            </span>
            {isDrawer && secretWord && (
              <span className="text-xs sm:text-sm font-black text-[#ff5d8f] uppercase tracking-wider">
                Secret Word: {secretWord} (Shh! 🤫)
              </span>
            )}
          </div>
        ) : (
          <div className="inline-flex flex-col items-center gap-1 px-4 sm:px-5 py-2 sm:py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-lg sm:text-2xl font-black">
              🎉 Round Guessed! Word was {secretWord?.toUpperCase() || state.secretWordMasked}!
            </span>
          </div>
        )}
      </div>

      {/* Secret Word Masked Banner */}
      <div className="text-xl sm:text-4xl font-black tracking-widest text-center py-1 text-[var(--arcade-ink)] select-none">
        {state.secretWordMasked || '_ _ _ _'}
      </div>

      {/* Local Mode Pass-the-Device Curtain */}
      {!isOnline && localStage === 'pass-to-drawer' && (
        <div className="w-full p-4 sm:p-6 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-3xl text-center space-y-3 shadow-[5px_5px_0_var(--arcade-ink)]">
          <h3 className="text-lg sm:text-xl font-black">Pass the device to {drawerPlayer.displayName}</h3>
          <p className="text-xs sm:text-sm font-semibold opacity-85">
            {guesserPlayer.displayName}, look away while the secret word is revealed!
          </p>
          <button
            type="button"
            onClick={() => {
              sfx('ding');
              setLocalStage('drawing');
            }}
            className="arcade-btn arcade-btn-pink text-xs sm:text-sm"
          >
            I am Ready! Show Secret Word 🎨
          </button>
        </div>
      )}

      {/* Canvas - Substantially Larger on Desktop while Covering Phone Screen */}
      {(!isOnline && localStage === 'pass-to-drawer') ? null : (
        <div
          className={`w-full aspect-[4/3] sm:aspect-[16/10] max-w-[840px] bg-white border-[3px] sm:border-[5px] border-[var(--arcade-ink)] rounded-2xl overflow-hidden shadow-[4px_4px_0_var(--arcade-ink)] sm:shadow-[8px_8px_0_var(--arcade-ink)] relative min-w-0 ${
            shakingCanvas ? 'arcade-shake' : ''
          } ${canvasJumping ? 'arcade-jump' : ''}`}
        >
          <canvas
            ref={canvasRef}
            width={840}
            height={630}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`w-full h-full touch-none select-none ${
              isDrawer && !isFinished ? 'cursor-crosshair' : 'cursor-default'
            }`}
          />
        </div>
      )}

      {/* Drawing Toolbar (Only active for Drawer) */}
      {isDrawer && !isFinished && (
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full max-w-[840px] px-0.5 sm:px-1 flex-wrap min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setCurrentColor(color)}
                style={{ backgroundColor: color }}
                className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full border-2 border-[var(--arcade-ink)] transition-transform ${
                  currentColor === color ? 'scale-125 ring-3 ring-[var(--arcade-ink)]' : 'hover:scale-105'
                }`}
                aria-label={`Color ${color}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                sfx('slide');
                onClear();
              }}
              className="arcade-btn py-1.5 px-3.5 text-xs sm:text-sm bg-white"
            >
              <GoogleIcon name="delete" size={16} />
              <span>Clear</span>
            </button>

            {!isOnline && localStage === 'drawing' && (
              <button
                type="button"
                onClick={() => {
                  sfx('ding');
                  setLocalStage('guessing');
                }}
                className="arcade-btn arcade-btn-pink py-1.5 px-4 text-xs sm:text-sm"
              >
                <span>Done Drawing! Pass Device ✅</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Guesser Toolbar & Input */}
      {isGuesser && !isFinished && (
        <div className="w-full max-w-[840px] space-y-2 min-w-0">
          {guessFeedback && (
            <p className="text-center font-bold text-xs sm:text-sm text-[var(--arcade-ink)] animate-bounce">
              {guessFeedback}
            </p>
          )}

          <form onSubmit={handleGuessSubmit} className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <input
              type="text"
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="What on earth is that? Guess here…"
              className="flex-1 min-w-[120px] p-2 sm:p-3 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-xl font-bold text-xs sm:text-base text-[var(--arcade-ink)] shadow-[2px_2px_0_var(--arcade-ink)] outline-none focus:ring-2 focus:ring-[#2bb5d4]"
            />
            <button type="submit" className="arcade-btn arcade-btn-blue text-xs sm:text-base py-2 sm:py-3 px-3.5 sm:px-5 shrink-0">
              Guess! 🧐
            </button>
            <button
              type="button"
              onClick={() => {
                sfx('ding');
                onRequestHint();
              }}
              className="arcade-btn py-2 sm:py-3 text-xs sm:text-base bg-[#ffc233] shrink-0"
              title="Reveal one letter"
            >
              💡 Hint
            </button>
          </form>
        </div>
      )}

      {/* Footer Actions / Rematch Options */}
      <div className="flex items-center justify-center gap-2 sm:gap-3 w-full pt-2 flex-wrap">
        {isFinished ? (
          <>
            <button
              type="button"
              onClick={() => onRematch({ mode: 'keep' })}
              className="arcade-btn arcade-btn-pink text-xs sm:text-sm py-2 px-4"
            >
              <GoogleIcon name="replay" size={16} />
              <span>{rematchRequested ? 'Partner Ready! Tap Play' : 'Next Round (Alternate Drawer)'}</span>
            </button>
            <button
              type="button"
              onClick={() => onRematch({ mode: 'change' })}
              className="arcade-btn py-2 px-4 text-xs sm:text-sm bg-[#ffc233]"
            >
              <span>Change Roles / Setup ⚙️</span>
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={onLeave}
          className="arcade-btn text-xs sm:text-sm py-2 px-4 bg-white dark:bg-gray-800"
        >
          <GoogleIcon name="arrow_back" size={16} />
          <span>Exit Game</span>
        </button>
      </div>
    </div>
  );
};
