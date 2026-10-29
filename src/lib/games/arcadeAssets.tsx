import React from 'react';

export const MASCOT_JOKES = [
  'Ouch! Stop poking me!',
  'I’m a professional emoji, please respect my art.',
  'Did you just boop me?!',
  'I once lost to a pigeon at chess. True story.',
  'Tickles! 🤭',
  '100% human-approved silliness guaranteed!',
  'Concentrate! Your partner is watching!',
  'May the sillier player win!',
];

export const CHESS_VICTIM_LINES: Record<string, string[]> = {
  P: ['Tell my mom I love her!', 'I was only a pawn in your game!', 'Why is it always the pawn?!', 'Oof! And I was on my lunch break!'],
  R: ['My tower! It’s still under mortgage!', 'I’ve fallen and I can’t castle up!', 'Timbeeer!'],
  N: ['Neeeeeigh!', 'That was NOT a fair L-shape!', 'I’m seeing stable lights…'],
  B: ['Bless you… and also curse you!', 'My diagonal dreams!', 'Tell the other wizards I’m out.'],
  Q: ['NOT THE LIPSTICK!', 'Drama! Absolute drama!', 'You dare?! I had a spa day booked!'],
  K: ['Long live… me?'],
};

export const CHESS_ATTACK_LINES: Record<string, string[]> = {
  P: ['Pawn power! Boop!', 'Tiny but mighty!'],
  R: ['TOWER SMASH!', 'Rolling thunder!'],
  N: ['Yeehaw, L-shaped justice!', 'Gallop gallop CHOMP!'],
  B: ['Abracadabra, gone!', 'Poof! Diagonal magic!'],
  Q: ['Queen’s orders: off with their heads!', 'Slay, your majesty!'],
  K: ['The king gets his hands dirty!'],
};

export const C4_FUN_QUOTES = [
  'Plop!',
  'Gravity: still working.',
  'Down the hole it goes!',
  'That disc has seen things.',
  'Wheee!',
  'Bonk! Landed.',
  'Ooh, strategic drop!',
];

export const DOODLE_JOKES = [
  'Behold, the masterpiece!',
  'Critics are calling it “interesting”.',
  'Please don’t laugh. Okay, laugh a little.',
  'Picasso is shaking right now.',
  'Is that a potato? A cat? A UFO?!',
];

export const FLOATING_EMOJIS = ['🎲', '♟️', '🔴', '❌', '⭕', '🖍️', '👑', '🍕', '🦆', '⭐', '🎈', '💖'];

/**
 * Custom SVG goofy chess piece inspired by Silly Game Arcade.
 * Features googly eyes, propellers, chunky outlines, and expressive facial elements.
 */
export const GoofyChessPiece: React.FC<{
  type: string;
  isWhite: boolean;
  mood?: 'scared' | 'relief' | 'grin' | '';
}> = ({ type, isWhite, mood = '' }) => {
  const S = '#2b2140';
  const f = isWhite ? '#fff4d9' : '#6a4fb0';
  const a = isWhite ? '#ff8fb1' : '#ffc233';

  const baseSvgAttrs = {
    stroke: S,
    strokeWidth: '3',
    strokeLinejoin: 'round' as const,
  };

  const eye = (cx: number, cy: number, r: number, key: string) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={S} strokeWidth="2.5" />
      <circle className="arcade-chess-eye" cx={cx} cy={cy} r={r / 2.2} fill={S} />
    </g>
  );

  const base = <path d="M20 92h60a7 7 0 0 0 0-14H20a7 7 0 0 0 0 14z" fill={f} {...baseSvgAttrs} />;

  const upperType = type.toUpperCase();

  const renderContent = () => {
    switch (upperType) {
      case 'P':
        return (
          <>
            <path d="M32 80c0-18 8-24 18-26 10 2 18 8 18 26z" fill={f} {...baseSvgAttrs} />
            <circle cx="50" cy="38" r="22" fill={f} {...baseSvgAttrs} />
            {eye(42, 36, 7, 'e1')}
            {eye(58, 36, 7, 'e2')}
            <path d="M41 48q9 9 18 0z" fill="#ff5d8f" stroke={S} strokeWidth="2.5" />
            <path d="M50 16v-5" stroke={S} strokeWidth="3" />
            <ellipse className="arcade-prop" cx="50" cy="9" rx="15" ry="3.5" fill={a} {...baseSvgAttrs} />
          </>
        );
      case 'R':
        return (
          <>
            <path d="M24 80V28h11v9h8v-9h14v9h8v-9h11v52z" fill={f} {...baseSvgAttrs} />
            {eye(40, 52, 8, 'e1')}
            {eye(62, 50, 11, 'e2')}
            <path d="M34 68l6 7 6-7 6 7 6-7 6 7 6-7" fill="none" stroke={S} strokeWidth="3" />
          </>
        );
      case 'N':
        return (
          <>
            <path d="M26 80C26 58 34 44 46 30L44 14l13 9C73 22 86 34 80 50L82 58 68 62C66 70 66 75 72 80z" fill={f} {...baseSvgAttrs} />
            <path d="M46 30Q34 40 32 60" fill="none" stroke={a} strokeWidth="7" strokeLinecap="round" />
            {eye(58, 38, 8, 'e1')}
            <circle cx="76" cy="50" r="2.5" fill={S} />
            <rect x="66" y="57" width="7" height="10" rx="1.5" fill="#fff" stroke={S} strokeWidth="2" />
          </>
        );
      case 'B':
        return (
          <>
            <path d="M50 14C70 26 78 44 72 60c-2 8-8 18-22 18S30 68 28 60C22 44 30 26 50 14z" fill={f} {...baseSvgAttrs} />
            <path d="M58 24L45 42" stroke={S} strokeWidth="3" />
            {eye(41, 52, 7, 'e1')}
            {eye(59, 52, 7, 'e2')}
            <path d="M43 64q7 6 14 0" fill="none" stroke={S} strokeWidth="3" />
            <path d="M52 65v7a3 3 0 0 0 6 0v-8z" fill="#ff5d8f" stroke={S} strokeWidth="2" />
            <circle cx="50" cy="11" r="6" fill={a} {...baseSvgAttrs} />
          </>
        );
      case 'Q':
        return (
          <>
            <path d="M28 80L22 36 38 52 50 28 62 52 78 36 72 80z" fill={f} {...baseSvgAttrs} />
            <circle cx="22" cy="32" r="6" fill={a} {...baseSvgAttrs} />
            <circle cx="50" cy="23" r="6" fill={a} {...baseSvgAttrs} />
            <circle cx="78" cy="32" r="6" fill={a} {...baseSvgAttrs} />
            {eye(42, 60, 7, 'e1')}
            {eye(58, 60, 7, 'e2')}
            <path d="M36 54l-5-4M64 54l5-4" stroke={S} strokeWidth="3" />
            <circle cx="34" cy="68" r="4" fill="#ff8fb1" opacity="0.7" />
            <circle cx="66" cy="68" r="4" fill="#ff8fb1" opacity="0.7" />
            <path d="M43 70q7 8 14 0q-7-3-14 0z" fill="#ff2d6f" stroke={S} strokeWidth="2" />
          </>
        );
      case 'K': {
        const mu = <path d="M50 72q-8-8-21-2 7 9 21 2 14 7 21-2-13-6-21 2z" fill={S} />;
        const st = { stroke: S, strokeWidth: '3', strokeLinecap: 'round' as const, fill: 'none' };

        const renderKingFace = () => {
          if (mood === 'scared') {
            return (
              <>
                <circle cx="40" cy="59" r="9" fill="#fff" stroke={S} strokeWidth="2.5" />
                <circle cx="60" cy="59" r="9" fill="#fff" stroke={S} strokeWidth="2.5" />
                <circle className="arcade-chess-eye" cx="40" cy="59" r="2" fill={S} />
                <circle className="arcade-chess-eye" cx="60" cy="59" r="2" fill={S} />
                <path d="M31 47l12 5M69 47l-12 5" {...st} />
                {mu}
                <ellipse cx="50" cy="79" rx="5" ry="4" fill="#7a1f3d" stroke={S} strokeWidth="2" />
                <path className="arcade-sweat" d="M76 50q6 9 0 12q-6-3 0-12z" fill="#7fd8ff" stroke={S} strokeWidth="1.5" />
              </>
            );
          }
          if (mood === 'relief') {
            return (
              <>
                <path d="M33 61q7-8 14 0M53 61q7-8 14 0" {...st} />
                <circle cx="34" cy="68" r="4" fill="#ff8fb1" opacity="0.7" />
                <circle cx="66" cy="68" r="4" fill="#ff8fb1" opacity="0.7" />
                {mu}
                <path d="M42 78q8 7 16 0" {...st} />
                <g className="arcade-puff">
                  <circle cx="82" cy="66" r="4" fill="#fff" stroke={S} strokeWidth="2" />
                  <circle cx="90" cy="62" r="2.5" fill="#fff" stroke={S} strokeWidth="1.5" />
                </g>
              </>
            );
          }
          if (mood === 'grin') {
            return (
              <>
                {eye(41, 61, 6, 'ke1')}
                {eye(59, 61, 6, 'ke2')}
                <path d="M30 50l15 7M70 50l-15 7" {...st} />
                {mu}
                <path d="M36 75q14 14 28 0z" fill="#fff" stroke={S} strokeWidth="3" strokeLinejoin="round" />
                <path d="M44 78v5M50 79v6M56 78v5" stroke={S} strokeWidth="2" />
                <path className="arcade-tw" d="M70 66l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#ffd23a" />
              </>
            );
          }
          return (
            <>
              {eye(41, 60, 7, 'e1')}
              {eye(59, 60, 7, 'e2')}
              {mu}
            </>
          );
        };

        return (
          <>
            <path d="M30 80C30 60 38 50 50 50s20 10 20 30z" fill={f} {...baseSvgAttrs} />
            <path d="M33 46l-2-18 11 8 8-12 8 12 11-8-2 18z" fill={a} {...baseSvgAttrs} />
            <path d="M50 8v16M44 13h12" stroke={S} strokeWidth="4" strokeLinecap="round" />
            {renderKingFace()}
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible select-none">
      {base}
      {renderContent()}
    </svg>
  );
};
