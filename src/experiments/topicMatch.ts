// ABOUTME: Extracts subject keywords from a post and scores firehose posts by
// ABOUTME: keyword overlap, so comments can loosely match what the user wrote.

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "at", "by", "for", "with",
  "about", "to", "from", "in", "on", "out", "up", "down", "is", "am", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "doing", "have",
  "has", "had", "having", "i", "you", "he", "she", "it", "we", "they", "me",
  "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "what", "which", "who", "whom", "whose",
  "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
  "most", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "just", "can", "will", "would", "should", "could",
  "now", "then", "there", "here", "get", "got", "gonna", "wanna", "really",
  "like", "im", " im", "dont", "cant", "yall", "hbu", "lol", "lmao", "omg",
  "tbh", "idk", "rn", "af", "fr", "bro", "guys", "guy", "thing", "things",
  "stuff", "today", "day", "time", "good", "bad", "much", "many", "feel",
  "feeling", "think", "thought", "know", "going", "go", "make", "made",
]);

// Words that are content but too generic to anchor a topic search on.
const WEAK_WORDS = new Set([
  "people", "person", "life", "world", "way", "work", "love", "hate", "best",
  "new", "old", "big", "little", "happy", "sad",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface Subject {
  keywords: string[];
  bigrams: string[];
}

// Pull the candidate subject terms out of a post. Returns an empty subject
// when nothing confident surfaces, signalling the caller to fall back.
export function extractSubject(post: string): Subject {
  const tokens = tokenize(post);
  const content = tokens.filter(
    (t) => t.length > 2 && !STOPWORDS.has(t)
  );

  const bigrams: string[] = [];
  for (let i = 0; i < content.length - 1; i++) {
    bigrams.push(`${content[i]} ${content[i + 1]}`);
  }

  // Prefer strong content words; only fall back to weak ones if nothing else.
  const strong = content.filter((t) => !WEAK_WORDS.has(t));
  const keywords = Array.from(new Set(strong.length > 0 ? strong : content));

  return { keywords, bigrams };
}

// Score how well a candidate firehose post matches the subject. A bigram hit
// counts more than single-word hits. Returns 0 when there is no overlap.
export function scoreRelevance(subject: Subject, candidate: string): number {
  if (subject.keywords.length === 0) return 0;
  const lower = candidate.toLowerCase();

  let score = 0;
  for (const bigram of subject.bigrams) {
    if (lower.includes(bigram)) score += 3;
  }
  for (const keyword of subject.keywords) {
    // Word-boundary match so "art" doesn't hit "start".
    const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`);
    if (re.test(lower)) score += 1;
  }
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
