function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitCommand(text) {
  const normalized = String(text || "").trim();

  if (!normalized.startsWith("/")) {
    return null;
  }

  const [rawCommand, ...rest] = normalized.split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();

  return {
    command,
    argsText: rest.join(" ").trim(),
  };
}

function parsePipeArgs(argsText) {
  return String(argsText || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTelegramDisplayName(from) {
  const firstName = from?.first_name || "";
  const lastName = from?.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) {
    return fullName;
  }

  if (from?.username) {
    return from.username;
  }

  return "Telegram user";
}

function extractJsonCandidate(text) {
  const raw = String(text || "").trim();
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const arrayStart = raw.indexOf("[");
  const objectStart = raw.indexOf("{");
  const startIndex =
    arrayStart >= 0 && (objectStart === -1 || arrayStart < objectStart) ? arrayStart : objectStart;

  if (startIndex >= 0) {
    const opener = raw[startIndex];
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < raw.length; index += 1) {
      const char = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }

        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === opener) {
        depth += 1;
        continue;
      }

      if (char === closer) {
        depth -= 1;

        if (depth === 0) {
          return raw.slice(startIndex, index + 1).trim();
        }
      }
    }
  }

  if (arrayStart >= 0 && (objectStart === -1 || arrayStart < objectStart)) {
    return raw.slice(arrayStart).trim();
  }

  if (objectStart >= 0) {
    return raw.slice(objectStart).trim();
  }

  return raw;
}

function isAffirmative(text) {
  const value = normalizeText(text);
  const positive = new Set(["ha", "xa", "ok", "boshla", "start", "ja", "los"]);
  return positive.has(value);
}

function isQuizRequest(text) {
  const value = normalizeText(text);
  return value.includes("savollarim tugadi") || value.includes("savollar tugadi") || value.includes("savolim tugadi");
}

function isUncertainAnswer(text) {
  const value = normalizeText(text);
  const patterns = [
    "bilmayman",
    "bilmiman",
    "bilmasam",
    "bilmadim",
    "eslay olmayman",
    "eslolmadim",
    "tushunmadim",
    "nma ekan bilmiman",
    "bilolmadim",
    "bilolmayman",
    "ich weiss nicht",
    "ich weiß nicht",
    "keine ahnung",
    "nicht sicher",
  ];

  return patterns.some((pattern) => value.includes(pattern));
}

function shortText(text, maxLength = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 3)}...`;
}

module.exports = {
  buildTelegramDisplayName,
  extractJsonCandidate,
  isAffirmative,
  isQuizRequest,
  isUncertainAnswer,
  normalizeText,
  parsePipeArgs,
  shortText,
  splitCommand,
};
