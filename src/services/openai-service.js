const { config } = require("../config");
const { scoreAnswerOverlap, selectRelevantChunks } = require("../utils/chunking");
const { extractJsonCandidate, shortText } = require("../utils/text");

function getLanguageMeta(languageCode = "uz") {
  const map = {
    uz: {
      label: "O'zbekcha",
      instruction: "Javobni o'zbek tilida yoz.",
      summaryPrompt: "Mavzuni qisqacha, sodda va tushunarli qilib tushuntir.",
      simplePrompt: "Shu savolga juda sodda, oson va bola ham tushunadigan tilda javob ber.",
      examplePrompt: "Shu savolga hayotiy va esda qoladigan 1-2 ta misol bilan javob ber.",
      normalPrompt: "Javobni foydali, aniq va darsga yopishgan holda yoz.",
      noMaterial: "Bu mavzu uchun hali text yoki transcript yuklanmagan. Employee avval text material ham yuborsin.",
      fallbackTitle: "Topilgan material",
      fallbackLead: "AI hozircha ulanmagan, shuning uchun mavzu ichidagi eng yaqin materialni ko'rsatdim.",
      fallbackQuestion: "Savol",
      sourcesTitle: "Manba parchalari",
      noMistakes: "Bu mavzu bo'yicha hozircha xato topilmadi.",
      yourAnswerLabel: "Sizning javobingiz",
      correctAnswerLabel: "To'g'ri javob",
      uncertainFeedback: "Mayli, avval qisqa tushuntiraman.",
      selfCheckTitle: "Endi shu tushuntirish bo'yicha 2 ta yengil savol",
      quizFallbackQuestion: "Ushbu dars parchasi nimani tushuntiryapti?",
      feedbackGood: "Javob asosiy mazmunga yaqin.",
      feedbackBad: "Javobda asosiy mazmun yetarli emas.",
      languageQuestion: "Qaysi tilda tushuntiray?",
      currentLanguageLabel: "Joriy til",
      checkedFeedback: "Tekshirildi.",
    },
    de: {
      label: "Deutsch",
      instruction: "Antworte auf Deutsch.",
      summaryPrompt: "Erkläre das Thema kurz, einfach und klar.",
      simplePrompt: "Antworte sehr einfach und leicht verständlich, wie für einen Schüler.",
      examplePrompt: "Antworte mit 1-2 klaren Beispielen aus dem Alltag.",
      normalPrompt: "Antworte nützlich, klar und eng am Unterrichtsstoff.",
      noMaterial: "Für dieses Thema wurde noch kein Text oder Transkript hochgeladen. Der Lehrer soll zuerst Textmaterial senden.",
      fallbackTitle: "Gefundenes Material",
      fallbackLead: "AI ist gerade nicht verbunden, deshalb zeige ich das passendste Material aus diesem Thema.",
      fallbackQuestion: "Frage",
      sourcesTitle: "Quellenausschnitte",
      noMistakes: "Zu diesem Thema wurden noch keine Fehler gefunden.",
      yourAnswerLabel: "Deine Antwort",
      correctAnswerLabel: "Richtige Antwort",
      uncertainFeedback: "Kein Problem, ich erkläre es zuerst kurz.",
      selfCheckTitle: "Jetzt 2 leichte Fragen zu dieser Erklärung",
      quizFallbackQuestion: "Was erklärt dieser Unterrichtsausschnitt?",
      feedbackGood: "Die Antwort liegt nah an der Hauptidee.",
      feedbackBad: "In der Antwort fehlt die Hauptidee.",
      languageQuestion: "In welcher Sprache soll ich erklären?",
      currentLanguageLabel: "Aktuelle Sprache",
      checkedFeedback: "Geprüft.",
    },
  };

  return map[languageCode] || map.uz;
}

function getApiKey() {
  return config.groqApiKey || config.openAiApiKey || "";
}

function hasOpenAi() {
  return Boolean(getApiKey());
}

function getTeachingModeInstruction(mode, language) {
  if (mode === "summary") {
    return language.summaryPrompt;
  }

  if (mode === "simple") {
    return language.simplePrompt;
  }

  if (mode === "example") {
    return language.examplePrompt;
  }

  return language.normalPrompt;
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];

  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

async function requestText({ systemPrompt, userPrompt, reasoningEffort = "low" }) {
  const response = await fetch(`${config.openAiApiBase}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openAiModel,
      reasoning: {
        effort: reasoningEffort,
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || response.statusText || "OpenAI request failed";
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const output = extractResponseText(data);

  if (!output) {
    throw new Error("OpenAI returned an empty response");
  }

  return output;
}

function buildFallbackAnswer(question, relevantChunks, languageCode) {
  const language = getLanguageMeta(languageCode);

  if (!relevantChunks.length) {
    return language.noMaterial;
  }

  const snippet = relevantChunks.map((chunk, index) => `${index + 1}. ${shortText(chunk, 220)}`).join("\n");

  return [
    language.fallbackLead,
    `${language.fallbackQuestion}: ${question}`,
    "",
    `${language.fallbackTitle}:`,
    snippet,
  ].join("\n");
}

function buildFallbackQuiz(chunks, count, languageCode) {
  const language = getLanguageMeta(languageCode);
  const source = chunks.filter(Boolean).slice(0, count);

  if (!source.length) {
    return [];
  }

  return source.map((chunk, index) => ({
    question: `${index + 1}. ${language.quizFallbackQuestion}`,
    answer: shortText(chunk, 400),
  }));
}

async function answerTopicQuestion({ topic, chunks, question, languageCode = "uz", teachingMode = "normal" }) {
  const language = getLanguageMeta(languageCode);
  const relevantChunks = selectRelevantChunks(question, chunks, config.topicContextChunkLimit);

  if (!hasOpenAi()) {
    return buildFallbackAnswer(question, relevantChunks, languageCode);
  }

  const context = relevantChunks.map((chunk, index) => `[${index + 1}] ${chunk}`).join("\n\n");

  return requestText({
    systemPrompt: [
      "Sen Ustoz AI ismli o'qituvchi botsan.",
      "Faqat tanlangan mavzu doirasida javob ber.",
      "Agar foydalanuvchi savoli mavzudan tashqarida bo'lsa, muloyim rad et va shu dars bo'yicha savol berishini ayt.",
      language.instruction,
      getTeachingModeInstruction(teachingMode, language),
      "Contextda bo'lmagan faktni o'zing to'qib yozma.",
    ].join(" "),
    userPrompt: [
      `Mavzu: ${topic.title}`,
      topic.description ? `Izoh: ${topic.description}` : "",
      "",
      "Dars contexti:",
      context || "Context yo'q",
      "",
      `Student savoli: ${question}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

async function generateQuiz({ topic, chunks, count, languageCode = "uz" }) {
  const language = getLanguageMeta(languageCode);
  if (!hasOpenAi()) {
    return buildFallbackQuiz(chunks, count, languageCode);
  }

  const context = chunks.slice(0, Math.max(count, config.topicContextChunkLimit)).join("\n\n");
  const responseText = await requestText({
    systemPrompt: [
      "Sen mavzu bo'yicha quiz yaratuvchi yordamchisan.",
      "Faqat JSON qaytar.",
      `Aniq ${count} ta ochiq savol tuz.`,
      'Format: [{"question":"...","answer":"..."}].',
      "Savollar faqat berilgan mavzu va context ichidan bo'lsin.",
      "Javoblar qisqa va tekshirishga qulay bo'lsin.",
      language.instruction,
    ].join(" "),
    userPrompt: [
      `Mavzu: ${topic.title}`,
      topic.description ? `Izoh: ${topic.description}` : "",
      "",
      "Context:",
      context || "Context yo'q",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const parsed = JSON.parse(extractJsonCandidate(responseText));

  return parsed
    .filter((item) => item?.question && item?.answer)
    .slice(0, count)
    .map((item) => ({
      question: String(item.question).trim(),
      answer: String(item.answer).trim(),
    }));
}

async function gradeQuizAnswer({ topicTitle, question, expectedAnswer, studentAnswer, languageCode = "uz" }) {
  const language = getLanguageMeta(languageCode);
  if (!hasOpenAi()) {
    const overlapScore = scoreAnswerOverlap(expectedAnswer, studentAnswer);
    return {
      correct: overlapScore >= 0.3,
      feedback: overlapScore >= 0.3 ? language.feedbackGood : language.feedbackBad,
    };
  }

  const responseText = await requestText({
    systemPrompt: [
      "Sen quiz javoblarini tekshiruvchi yordamchisan.",
      "Faqat JSON qaytar.",
      'Format: {"correct": true, "feedback": "..."}',
      "Baholashda mazmunni tekshir, faqat so'zma-so'z moslikni emas.",
      "Feedback bitta qisqa gap bo'lsin.",
      language.instruction,
    ].join(" "),
    userPrompt: [
      `Mavzu: ${topicTitle}`,
      `Savol: ${question}`,
      `Kutilgan javob: ${expectedAnswer}`,
      `Student javobi: ${studentAnswer}`,
    ].join("\n"),
    reasoningEffort: "medium",
  });

  let parsed;

  try {
    parsed = JSON.parse(extractJsonCandidate(responseText));
  } catch (error) {
    const overlapScore = scoreAnswerOverlap(expectedAnswer, studentAnswer);
    return {
      correct: overlapScore >= 0.3,
      feedback: overlapScore >= 0.3 ? language.feedbackGood : language.feedbackBad,
    };
  }

  return {
    correct: Boolean(parsed.correct),
    feedback: parsed.feedback ? String(parsed.feedback).trim() : language.checkedFeedback,
  };
}

async function generateQuizRecovery({ topic, chunks, question, expectedAnswer, languageCode = "uz" }) {
  const language = getLanguageMeta(languageCode);
  const relevantChunks = selectRelevantChunks(`${question} ${expectedAnswer}`, chunks, config.topicContextChunkLimit);

  if (!hasOpenAi()) {
    return [
      language.uncertainFeedback,
      `${language.correctAnswerLabel}: ${expectedAnswer}`,
      "",
      `${language.selfCheckTitle}:`,
      `1. ${question}`,
      `2. Bir gap bilan ayting: ${shortText(expectedAnswer, 120)}`,
    ].join("\n");
  }

  const context = relevantChunks.map((chunk, index) => `[${index + 1}] ${chunk}`).join("\n\n");

  return requestText({
    systemPrompt: [
      "Sen quizdagi qiynalgan studentga yordam beruvchi o'qituvchisan.",
      "To'g'ri javobni juda sodda qilib tushuntir.",
      "So'ng aynan shu tushuntirish ichidan aniq 2 ta yengil self-check savol ber.",
      "Natija plain text bo'lsin.",
      "Format yaqin bo'lsin: qisqa tushuntirish, bo'sh qatordan keyin 1. ... 2. ...",
      language.instruction,
      "Faqat berilgan mavzu contextidan foydalan.",
    ].join(" "),
    userPrompt: [
      `Mavzu: ${topic.title}`,
      topic.description ? `Izoh: ${topic.description}` : "",
      `Quiz savoli: ${question}`,
      `Kutilgan javob: ${expectedAnswer}`,
      "",
      "Context:",
      context || "Context yo'q",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

async function transcribeMedia({ fileBuffer, filename = "lesson.mp4", mimeType = "video/mp4", prompt = "" }) {
  if (!hasOpenAi()) {
    throw new Error("Transcription requires an AI API key");
  }

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });

  formData.append("file", blob, filename);
  formData.append("model", config.transcriptionModel);

  if (prompt) {
    formData.append("prompt", prompt);
  }

  const response = await fetch(`${config.openAiApiBase}/audio/transcriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getApiKey()}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || response.statusText || "Transcription request failed";
    throw new Error(`Transcription request failed: ${message}`);
  }

  const transcript = String(data?.text || "").trim();

  if (!transcript) {
    throw new Error("Transcription returned empty text");
  }

  return transcript;
}

module.exports = {
  answerTopicQuestion,
  generateQuiz,
  generateQuizRecovery,
  getLanguageMeta,
  gradeQuizAnswer,
  hasOpenAi,
  transcribeMedia,
};
