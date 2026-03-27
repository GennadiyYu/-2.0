import { config } from './config.js';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function getRelevantChunks(question, documents) {
  const tokens = tokenize(question);
  if (!tokens.length || !documents?.length) return [];

  const scored = [];

  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      const haystack = chunk.text.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      if (score > 0) {
        scored.push({ ...chunk, score });
      }
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, config.topKChunks);
}
