const naughtyWords = require('naughty-words');

// Deliberately checks for exact whole-word matches only (not substrings) so
// legitimate names that happen to contain a blocked word as a fragment --
// e.g. "Cassidy", "Bass", "Scott" -- are never falsely rejected.
const BLOCKED_WORDS = new Set([
  'fuck', 'fucker', 'fucking', 'shit', 'shitty', 'bitch', 'bastard',
  'asshole', 'ass', 'cunt', 'dick', 'dickhead', 'piss', 'pissed',
  'cock', 'pussy', 'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga',
  'retard', 'retarded', 'douche', 'douchebag', 'twat', 'wanker',
  'motherfucker', 'goddamn', 'damn', 'hell', 'crap',
]);

// Names of historical hate figures / genocidal dictators -- names parents
// have deliberately used to make a hateful statement rather than to name a
// child. Same whole-word matching as BLOCKED_WORDS, so multi-word input
// (e.g. "Adolf Hitler") is caught on either word.
const BLOCKED_NAMES = new Set([
  'adolf', 'hitler', 'himmler', 'goebbels', 'mengele',
  'stalin', 'mussolini', 'saddam', 'osama',
]);

// Slurs and profanity in ~28 other languages, from the community-maintained
// LDNOOBW dataset (via the `naughty-words` package) -- covers Arabic, Czech,
// Danish, German, Esperanto, Spanish, Persian, Finnish, Filipino, French,
// Quebec French, Hindi, Hungarian, Italian, Japanese, Kabyle, Korean, Dutch,
// Norwegian, Polish, Portuguese, Russian, Swedish, Thai, Klingon(!), Turkish,
// and Chinese. Most entries are single words; the handful of multi-word
// phrases are matched separately below since they won't appear as one token.
const MULTILINGUAL_WORDS = new Set();
const MULTILINGUAL_PHRASES = [];
for (const wordList of Object.values(naughtyWords)) {
  for (const entry of wordList) {
    const normalized = entry.toLowerCase().trim();
    if (!normalized) continue;
    if (normalized.includes(' ')) {
      MULTILINGUAL_PHRASES.push(normalized);
    } else {
      MULTILINGUAL_WORDS.add(normalized);
    }
  }
}

function containsProfanity(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();

  // \p{L}\p{M} (Unicode letters + combining marks) instead of a-z so this
  // tokenizes non-English scripts (accented Latin, Cyrillic, Arabic, CJK,
  // etc.) correctly instead of stripping them out.
  const words = normalized
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const hasBlockedWord = words.some(
    (word) => BLOCKED_WORDS.has(word) || BLOCKED_NAMES.has(word) || MULTILINGUAL_WORDS.has(word)
  );
  if (hasBlockedWord) return true;

  return MULTILINGUAL_PHRASES.some((phrase) => normalized.includes(phrase));
}

module.exports = { containsProfanity };
