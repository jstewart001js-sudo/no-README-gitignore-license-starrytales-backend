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

function containsProfanity(text) {
  if (!text) return false;
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.some((word) => BLOCKED_WORDS.has(word));
}

module.exports = { containsProfanity };
