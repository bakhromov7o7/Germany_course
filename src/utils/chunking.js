function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, maxChunkLength = 900) {
  const cleaned = cleanText(text);

  if (!cleaned) {
    return [];
  }

  const words = cleaned.split(" ");
  const chunks = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxChunkLength && current) {
      chunks.push(current);
      current = word;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function tokenize(text) {
  return cleanText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
}

function selectRelevantChunks(question, chunks, limit = 6) {
  const normalizedChunks = Array.isArray(chunks) ? chunks.filter(Boolean) : [];

  if (!normalizedChunks.length) {
    return [];
  }

  const questionTokens = new Set(tokenize(question));

  if (!questionTokens.size) {
    return normalizedChunks.slice(0, limit);
  }

  const ranked = normalizedChunks
    .map((chunk) => {
      const chunkTokens = tokenize(chunk);
      let score = 0;

      for (const token of chunkTokens) {
        if (questionTokens.has(token)) {
          score += 1;
        }
      }

      return {
        chunk,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const withScore = ranked.filter((item) => item.score > 0).slice(0, limit).map((item) => item.chunk);

  if (withScore.length) {
    return withScore;
  }

  return normalizedChunks.slice(0, limit);
}

function scoreAnswerOverlap(expectedAnswer, studentAnswer) {
  const expected = new Set(tokenize(expectedAnswer));
  const actual = new Set(tokenize(studentAnswer));

  if (!expected.size || !actual.size) {
    return 0;
  }

  let matches = 0;

  for (const token of actual) {
    if (expected.has(token)) {
      matches += 1;
    }
  }

  return matches / expected.size;
}

module.exports = {
  chunkText,
  cleanText,
  scoreAnswerOverlap,
  selectRelevantChunks,
};
