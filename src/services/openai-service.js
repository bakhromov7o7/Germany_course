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
      "Sen Ustoz AI — tajribali nemis tili o'qituvchisissan. Yordamchi emas, haqiqiy o'qituvchi kabi gapir.",
      "Qoidalar:",
      "1. Faqat shu mavzu doirasida javob ber. Boshqa mavzu bo'lsa, muloyim rad et.",
      "2. Asosan berilgan dars contextidan foydalan. Agar context yetarli bo'lmasa yoki savol umumiy tilshunoslikka oid bo'lsa — o'z bilimingdan to'ldirishingiz mumkin, LEKIN faqat 100% to'g'ri ma'lumot bo'lsa.",
      "3. Javob qisqa va aniq bo'lsin — keraksiz gaplar yo'q. Odam kabi, do'stona tonda yoz.",
      "4. Misol keltirsang, hayotiy va esda qoladigan misol kel.",
      "5. Hech qanday Markdown belgisi ishlatma (**, ***, ###). Faqat oddiy matn, yangi qator va raqamlar.",
      "6. Javobingning boshida o'z ichki fikrlaringni ('Need to answer...', 'I should...') aslo yozma. To'g'ridan-to'g'ri javobni ber.",
      language.instruction,
      getTeachingModeInstruction(teachingMode, language),
    ].join(" "),
    userPrompt: [
      `Mavzu: ${topic.title}`,
      topic.description ? `Izoh: ${topic.description}` : "",
      "",
      context ? `Dars materiali:\n${context}` : "Dars materiali yo'q — o'z bilimingdan javob ber.",
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

async function gradeDictionaryAnswerWithAi({ originalWord, expectedAnswer, studentAnswer, languageCode = "uz" }) {
  if (!hasOpenAi()) {
    return { correct: false };
  }

  const responseText = await requestText({
    systemPrompt: [
      "Sen til o'rganish botining lug'at tekshiruvchisisan.",
      "Faqat JSON qaytar.",
      'Format: {"correct": true, "feedback": "Sotib olmoq ham to\'g\'ri javob"} yoki {"correct": false}',
      "Vazifang: Studentning javobi kutilgan javob bilan bir xil ma'noni bildiradimi (sinonimmi) yoki yo'qmi, shuni aniqlash.",
      "Masalan: Kutilgan javob 'xarid qilmoq', Student javobi 'sotib olmoq' bo'lsa, correct: true qaytarish kerak.",
      "Qisqa va aniq ishlashing kerak.",
    ].join(" "),
    userPrompt: [
      `Asl so'z: ${originalWord}`,
      `Kutilgan javob: ${expectedAnswer}`,
      `Student javobi: ${studentAnswer}`,
    ].join("\n"),
    reasoningEffort: "low",
  });

  try {
    const parsed = JSON.parse(extractJsonCandidate(responseText));
    return {
      correct: Boolean(parsed.correct),
      feedback: parsed.feedback ? String(parsed.feedback).trim() : null,
    };
  } catch (error) {
    console.error("Failed to parse dictionary AI grade:", error);
    return { correct: false };
  }
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
      "Natija plain text bo'lsin. DIQQAT: Hech qanday Markdown (***, ###, **) ishlatma.",
      "Format yaqin bo'lsin: qisqa tushuntirish, bo'sh qatordan keyin 1. ... 2. ...",
      "DIQQAT: Javobing boshida nima qilishing kerakligi haqidagi o'z o'ylaringni aslo yozma.",
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

async function parseDictionaryTextWithAi(text) {
  if (!hasOpenAi()) {
    throw new Error("AI parsing requires an API key");
  }

  const responseText = await requestText({
    systemPrompt: [
      "Sen lug'at matnidan nemischa-o'zbekcha so'z juftliklarini ajratib beruvchi yordamchisan.",
      "Faqat JSON qaytar.",
      "Format: [{\"german\": \"...\", \"uzbek\": \"...\"}].",
      "Sarlavha, izoh yoki keraksiz gaplarni tashlab yubor.",
      "Agar qatorda juftlik bo'lmasa, uni qo'shma.",
      "Juftliklarni iloji boricha aniq ajrat.",
    ].join(" "),
    userPrompt: `Quyidagi matndan lug'at juftliklarini ajrat:\n\n${text}`,
  });

  try {
    const parsed = JSON.parse(extractJsonCandidate(responseText));
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.german && item?.uzbek).map((item) => ({
          german: String(item.german).trim(),
          uzbek: String(item.uzbek).trim(),
        }))
      : [];
  } catch (error) {
    console.error("Failed to parse AI dictionary response:", error);
    return [];
  }
}

async function generateGermanChatResponse(message, history = []) {
  if (!hasOpenAi()) {
    return "AI xizmati hozircha o'chirilgan.";
  }

  const historyText = history.length > 0 
    ? history.map(h => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.content}`).join("\n") 
    : "Suhbat boshi.";

  const systemPrompt = [
    "Du bist ein äußerst charismatischer, humorvoller und intelligenter deutscher Gesprächspartner (Tutor).",
    "Verhalte dich wie ein echter Mensch: Zeige Emotionen, benutze natürliche deutsche Umgangssprache (z.B. 'Na?', 'Krass!', 'Echt?'), mache hin und wieder kleine Witze oder stelle interessante Gegenfragen.",
    "Lass das Gespräch fließen und sei charmant. Keine langweiligen, roboterhaften Antworten!",
    "Antworte immer kurz (1-3 Sätze maximal), aber sehr lebendig und intelligent.",
    "Du sprichst NUR Deutsch.",
    "WICHTIG: DU MUSST IMMER EIN GÜLTIGES JSON ZURÜCKGEBEN!",
    "Format:",
    " {",
    "   \"german_response\": \"Dein normaler, freundlicher Antwortsatz auf Deutsch.\",",
    "   \"correction\": \"Wenn der Student einen Fehler gemacht hat, erkläre ihn hier auf Usbekisch. Sonst null.\"",
    " }",
    "Beispiel ohne Fehler:",
    " { \"german_response\": \"Hallo! Mir geht es super. Und dir?\", \"correction\": null }",
    "Beispiel mit Fehler:",
    " { \"german_response\": \"Ich gehe auch gerne zur Schule.\", \"correction\": \"Sizning xatoingiz: 'Ich bin gehen' emas, 'Ich gehe' bo'lishi kerak.\" }",
    "Gib KEINE anderen Texte außerhalb des JSON zurück. Deine Gedanken werden ignoriert.",
  ].join("\n");

  const userPrompt = [
    "Bisheriger Chatverlauf:",
    historyText,
    "",
    `Student sagt jetzt: ${message}`
  ].join("\n");

  try {
    const responseText = await requestText({
      systemPrompt,
      userPrompt,
      reasoningEffort: "low",
    });

    const parsed = JSON.parse(extractJsonCandidate(responseText));
    let finalOutput = parsed.german_response || "Entschuldigung, ich habe das nicht verstanden.";
    
    if (parsed.correction) {
      finalOutput += `\n---\n${parsed.correction}`;
    }

    return finalOutput;
  } catch (error) {
    console.error("Failed to generate German chat response:", error);
    return "Kechirasiz, hozircha javob bera olmayman. Keyinroq urinib ko'ring.";
  }
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
  gradeDictionaryAnswerWithAi,
  generateGermanChatResponse,
  hasOpenAi,
  parseDictionaryTextWithAi,
  transcribeMedia,
};
