const { normalizeText } = require("./text");

const LEADING_MARKER_PATTERN = /^\s*(?:[-*•]+|\d+[.)])\s*/;
const APOSTROPHE_PATTERN = /[ʻʼ`´’‘]/g;
const PUNCTUATION_PATTERN = /[.!?,"“”«»()]/g;
const SURROUNDING_QUOTES_PATTERN = /^["'«»„“]+|["'«»„“]+$/g;
const TRAILING_HEADING_PATTERN = /[:\-–—]\s*$/u;
const BRACKET_PAIR_PATTERN = /^(?<left>.+?)\s*[\(\[](?<right>[^()[\]]+)[\)\]]\s*$/u;
const TAB_SEPARATOR_PATTERN = /^(?<left>.+?)\t+(?<right>.+)$/u;
const STRONG_SEPARATOR_PATTERN = /^(?<left>.+?)\s*(?:\||;|=>|->|:|=)\s*(?<right>.+)$/u;
const DASH_SEPARATOR_PATTERN = /^(?<left>.+?)\s*[—–-]\s*(?<right>.+)$/u;
const GERMAN_ARTICLE_PATTERN = /^(?:der|die|das|ein|eine)\s+/i;

function normalizeDictionaryTerm(value) {
  return String(value || "")
    .replace(APOSTROPHE_PATTERN, "'")
    .replace(SURROUNDING_QUOTES_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createEntry(left, right) {
  const german = normalizeDictionaryTerm(left);
  const uzbek = normalizeDictionaryTerm(right);

  if (!german || !uzbek) {
    return null;
  }

  return {
    german,
    uzbek,
  };
}

function parseLine(line) {
  const strongMatch = line.match(STRONG_SEPARATOR_PATTERN);

  if (strongMatch?.groups) {
    return createEntry(strongMatch.groups.left, strongMatch.groups.right);
  }

  const dashMatch = line.match(DASH_SEPARATOR_PATTERN);

  if (dashMatch?.groups) {
    return createEntry(dashMatch.groups.left, dashMatch.groups.right);
  }

  const tabMatch = line.match(TAB_SEPARATOR_PATTERN);

  if (tabMatch?.groups) {
    return createEntry(tabMatch.groups.left, tabMatch.groups.right);
  }

  const bracketMatch = line.match(BRACKET_PAIR_PATTERN);

  if (bracketMatch?.groups) {
    return createEntry(bracketMatch.groups.left, bracketMatch.groups.right);
  }

  return null;
}

function isIgnorableLine(line) {
  const normalized = normalizeDictionaryTerm(line);

  if (!normalized) {
    return true;
  }

  if (TRAILING_HEADING_PATTERN.test(normalized)) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount > 5) {
    return false;
  }

  const commonSeparators = ["|", ";", "=>", "->", ":", "=", "—", "–", "-"];
  const hasSeparator = commonSeparators.some((sep) => normalized.includes(sep));

  if (hasSeparator && wordCount >= 1) {
    return false;
  }

  return wordCount <= 3;
}

function parseDictionaryText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_MARKER_PATTERN, "").trim())
    .filter(Boolean);

  const invalidLines = [];
  const ignoredLines = [];
  const uniqueEntries = new Map();

  for (const line of lines) {
    const parsed = parseLine(line);

    if (!parsed) {
      if (isIgnorableLine(line)) {
        ignoredLines.push(line);
      } else {
        invalidLines.push(line);
      }
      continue;
    }

    const key = `${normalizeText(parsed.german)}::${normalizeText(parsed.uzbek)}`;

    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, parsed);
    }
  }

  return {
    entries: Array.from(uniqueEntries.values()),
    ignoredLines,
    invalidLines,
    totalLines: lines.length,
  };
}

function normalizeDictionaryAnswer(value) {
  return normalizeText(
    String(value || "")
      .replace(APOSTROPHE_PATTERN, "'")
      .replace(PUNCTUATION_PATTERN, " ")
      .replace(/\s+/g, " "),
  );
}

function buildExpectedVariants(value) {
  const normalized = normalizeDictionaryAnswer(value);

  if (!normalized) {
    return [];
  }

  const variants = new Set([normalized]);
  const noBracketText = normalizeDictionaryAnswer(String(value || "").replace(/\s*[\(\[][^()[\]]+[\)\]]\s*/g, " "));

  if (noBracketText) {
    variants.add(noBracketText);
  }

  const articleless = normalizeDictionaryAnswer(normalized.replace(GERMAN_ARTICLE_PATTERN, ""));

  if (articleless) {
    variants.add(articleless);
  }

  const noBracketArticleless = normalizeDictionaryAnswer(noBracketText.replace(GERMAN_ARTICLE_PATTERN, ""));

  if (noBracketArticleless) {
    variants.add(noBracketArticleless);
  }

  return Array.from(variants);
}

function matchDictionaryAnswer(expectedAnswer, actualAnswer) {
  const actual = normalizeDictionaryAnswer(actualAnswer);

  if (!actual) {
    return false;
  }

  const expectedVariants = String(expectedAnswer || "")
    .split(/[;/]/)
    .flatMap((item) => buildExpectedVariants(item));

  return expectedVariants.some((item) => item === actual);
}

module.exports = {
  matchDictionaryAnswer,
  parseDictionaryText,
};
