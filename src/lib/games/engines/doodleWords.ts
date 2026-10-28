export const DOODLE_WORDS = [
  'cat',
  'pizza',
  'rocket',
  'banana',
  'octopus',
  'castle',
  'bicycle',
  'umbrella',
  'dinosaur',
  'guitar',
  'robot',
  'volcano',
  'snowman',
  'pirate',
  'spider',
  'sandwich',
  'unicorn',
  'airplane',
  'ghost',
  'cactus',
  'penguin',
  'burger',
  'crown',
  'dragon',
  'rainbow',
  'heart',
  'coffee',
  'cupcake',
  'puppy',
  'moon',
  'sunflower',
  'butterfly',
  'camera',
  'ice cream',
  'balloon',
  'spaceship',
];

export function getRandomWord(): string {
  const index = Math.floor(Math.random() * DOODLE_WORDS.length);
  return DOODLE_WORDS[index];
}

export function maskSecretWord(word: string, revealedCount = 0): string {
  const chars = word.split('');
  return chars
    .map((char, index) => {
      if (char === ' ') return ' ';
      return index < revealedCount ? char.toUpperCase() : '_';
    })
    .join(' ');
}
