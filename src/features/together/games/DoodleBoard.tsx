import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { GameSession, DoodleState, DoodleStroke } from '../../../lib/games/types';
import { GoogleIcon } from '../../../components/GoogleIcon';

interface DoodleBoardProps {
  session: GameSession;
  isMyTurn: boolean;
  myRole: string;
  secretWord: string | null;
  doodleStrokes: DoodleStroke[];
  onSendStroke: (stroke: DoodleStroke) => void;
  onClear: () => void;
  onRequestHint: () => void;
  onSubmitGuess: (guess: string) => Promise<{ correct: boolean; word?: string }>;
  onRematch: () => void;
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
  onSendStroke,
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

  const [guessInput, setGuessInput] = useState('');
  const [guessMessage, setGuessMessage] = useState<string | null>(null);
  const [shakingCanvas, setShakingCanvas] = useState(false);

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
    setIsDrawing(true);
    const pt = getCanvasPoint(e);
    currentStrokeRef.current = [pt];

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
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStrokeRef.current.length > 1) {
      onSendStroke({
        points: currentStrokeRef.current,
        color: currentColor,
        width: brushWidth,
      });
    }
    currentStrokeRef.current = [];
  };

  const handleGuessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessInput.trim() || isFinished) return;
    const res = await onSubmitGuess(guessInput);
    if (res.correct) {
      setGuessMessage(`🎉 Correct! It was ${res.word?.toUpperCase()}!`);
    } else {
      setShakingCanvas(true);
      setGuessMessage('“' + guessInput.trim() + '”? Nope, try again! 🎨');
      setTimeout(() => setShakingCanvas(false), 500);
    }
    setGuessInput('');
  };

  return (
    <div className="flex flex-col items-center w-full max-w-lg mx-auto space-y-3">
      {/* Header Info */}
      <div className="w-full text-center">
        {!isFinished ? (
          <div className="inline-flex flex-col items-center gap-1 px-4 py-2 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[3px_3px_0_var(--arcade-ink)]">
            <span className="font-bold text-sm sm:text-base text-[var(--arcade-ink)]">
              {drawerPlayer.displayName} draws 🎨 • {guesserPlayer.displayName} guesses 🧐
            </span>
            {isDrawer && secretWord && (
              <span className="text-xs font-black text-[#ff5d8f] uppercase">
                Secret Word: {secretWord} (Shh, don't tell!)
              </span>
            )}
          </div>
        ) : (
          <div className="inline-flex flex-col items-center gap-1 px-5 py-3 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-2xl shadow-[4px_4px_0_var(--arcade-ink)]">
            <span className="text-xl sm:text-2xl font-black">
              🎉 Round Guessed! Word was {secretWord?.toUpperCase() || state.secretWordMasked}!
            </span>
          </div>
        )}
      </div>

      {/* Secret Word Masked Banner */}
      <div className="text-2xl sm:text-3xl font-black tracking-widest text-center py-1 text-[var(--arcade-ink)] select-none">
        {state.secretWordMasked || '_ _ _ _'}
      </div>

      {/* Local Mode Pass-the-Device Curtain */}
      {!isOnline && localStage === 'pass-to-drawer' && (
        <div className="w-full p-6 bg-[var(--arcade-c)] border-[3px] border-[var(--arcade-ink)] rounded-3xl text-center space-y-4 shadow-[5px_5px_0_var(--arcade-ink)]">
          <h3 className="text-xl font-black">Pass the device to {drawerPlayer.displayName}! 🤫</h3>
          <p className="text-sm font-semibold opacity-85">
            {guesserPlayer.displayName}, close your eyes while your partner sees the secret word!
          </p>
          <button
            type="button"
            onClick={() => setLocalStage('drawing')}
            className="arcade-btn arcade-btn-pink"
          >
            I am Ready! Show Secret Word 🎨
          </button>
        </div>
      )}

      {/* Canvas */}
      {(!isOnline && localStage === 'pass-to-drawer') ? null : (
        <div
          className={`w-full aspect-[3/2] max-w-[480px] bg-white border-[4px] border-[var(--arcade-ink)] rounded-2xl overflow-hidden shadow-[5px_5px_0_var(--arcade-ink)] relative ${
            shakingCanvas ? 'arcade-shake' : ''
          }`}
        >
          <canvas
            ref={canvasRef}
            width={600}
            height={400}
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
        <div className="flex items-center justify-between gap-2 w-full max-w-[480px] px-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setCurrentColor(color)}
                style={{ backgroundColor: color }}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-[var(--arcade-ink)] transition-transform ${
                  currentColor === color ? 'scale-125 ring-2 ring-[var(--arcade-ink)]' : 'hover:scale-105'
                }`}
                aria-label={`Color ${color}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="arcade-btn py-1 px-3 text-xs sm:text-sm bg-white"
            >
              <GoogleIcon name="delete" size={14} />
              <span>Clear</span>
            </button>

            {!isOnline && localStage === 'drawing' && (
              <button
                type="button"
                onClick={() => setLocalStage('guessing')}
                className="arcade-btn arcade-btn-pink py-1 px-3 text-xs sm:text-sm"
              >
                <span>Done Drawing! ✅</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Guesser Toolbar & Input */}
      {isGuesser && !isFinished && (
        <div className="w-full max-w-[480px] space-y-2">
          {guessMessage && (
            <p className="text-center font-bold text-sm text-[var(--arcade-ink)] animate-bounce">
              {guessMessage}
            </p>
          )}

          <form onSubmit={handleGuessSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="What on earth is that? Guess here…"
              className="flex-1 p-2.5 bg-[var(--arcade-card)] border-[3px] border-[var(--arcade-ink)] rounded-xl font-bold text-sm sm:text-base text-[var(--arcade-ink)] shadow-[2px_2px_0_var(--arcade-ink)] outline-none focus:ring-2 focus:ring-[#2bb5d4]"
            />
            <button type="submit" className="arcade-btn arcade-btn-blue text-sm sm:text-base py-2.5">
              Guess!
            </button>
            <button
              type="button"
              onClick={onRequestHint}
              className="arcade-btn py-2.5 text-sm sm:text-base bg-[#ffc233]"
              title="Reveal one letter"
            >
              💡 Hint
            </button>
          </form>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-center gap-3 w-full pt-2">
        {isFinished ? (
          <button
            type="button"
            onClick={onRematch}
            className="arcade-btn arcade-btn-pink text-sm sm:text-base"
          >
            <GoogleIcon name="replay" size={18} />
            <span>{rematchRequested ? 'Partner Ready! Tap for Next Round' : 'Next Round'}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onLeave}
          className="arcade-btn text-sm sm:text-base bg-white dark:bg-gray-800"
        >
          <GoogleIcon name="arrow_back" size={18} />
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
};
