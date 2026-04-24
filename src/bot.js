const { config } = require("./config");
const {
  createManagedUser,
  ensureStudent,
  ensureSuperadmin,
  findAnySuperadmin,
  findById,
  findByTelegramUserId,
  listAccessibleStudentsForEmployee,
  listManagedUsersByRole,
  listStaffMembers,
  touchKnownUser,
} = require("./repositories/users");
const {
  assignTopicToStudent,
  createTopic,
  getTopicById,
  getTopicByIdForEmployee,
  listTopicsByEmployee,
  listTopicsByEmployeeWithStats,
  listTopicsForStudent,
  studentHasTopicAccess,
} = require("./repositories/topics");
const {
  addDictionaryEntries,
  clearDictionarySession,
  createDictionary,
  deleteDictionary,
  getDictionaryByIdForEmployee,
  getDictionaryByIdForStudent,
  getDictionaryEntryById,
  getDictionarySession,
  getRandomDictionaryEntry,
  listAllDictionaries,
  listDictionariesByEmployee,
  listDictionariesForStudent,
  listDictionaryEntries,
  replaceDictionaryEntries,
  upsertDictionarySession,
} = require("./repositories/dictionaries");
const { getKnowledgeChunks, getTopicVideos, saveTextMaterial, saveVideoMaterial } = require("./repositories/materials");
const { clearPendingAction, getStudentSession, getUserState, setActiveTopic, setPendingAction, setGermanChatHistory, setPreferredLanguage, upsertStudentSession } = require("./repositories/state");
const {
  createQuizAttempt,
  finalizeAttempt,
  getAttemptById,
  getAttemptSummary,
  getNextUnansweredQuestion,
  listEmployeeStudentStats,
  listRecentQuizResultsForEmployee,
  listStudentMistakes,
  markReportSent,
  saveQuestionAnswer,
} = require("./repositories/quiz");
const { answerCallbackQuery, deleteMessage, downloadTelegramFile, getFile, sendChatAction, sendMessage, sendVideo, getUpdates } = require("./services/telegram-api");
const {
  answerTopicQuestion,
  generateQuiz,
  generateQuizRecovery,
  getLanguageMeta,
  gradeQuizAnswer,
  gradeDictionaryAnswerWithAi,
  generateGermanChatResponse,
  hasOpenAi,
  transcribeMedia,
} = require("./services/openai-service");
const { matchDictionaryAnswer, parseDictionaryText } = require("./utils/dictionary");
const { chunkText, cleanText, selectRelevantChunks } = require("./utils/chunking");
const {
  buildTelegramDisplayName,
  isAffirmative,
  isQuizRequest,
  isUncertainAnswer,
  normalizeText,
  parsePipeArgs,
  shortText,
  splitCommand,
} = require("./utils/text");
const { formatDurationUz, sleep } = require("./utils/time");

const SUPERADMIN_MENU = {
  keyboard: [
    [{ text: "Employee qo'shish" }],
    [{ text: "Lug'atlar" }, { text: "Nemis tilida suhbat" }],
    [{ text: "Natijalar" }, { text: "Kuchsiz studentlar" }],
    [{ text: "Bekor qilish" }],
    [{ text: "Yordam" }],
  ],
  resize_keyboard: true,
};

function isStaff(role) {
  return role === "employee" || role === "superadmin";
}

const EMPLOYEE_MENU = {
  keyboard: [
    [{ text: "Lug'atlar" }, { text: "Nemis tilida suhbat" }],
    [{ text: "Natijalar" }, { text: "Kuchsiz studentlar" }],
    [{ text: "Bekor qilish" }],
    [{ text: "Yordam" }],
  ],
  resize_keyboard: true,
};

const STUDENT_MENU = {
  keyboard: [
    [{ text: "Lug'atlar" }, { text: "Nemis tilida suhbat" }],
    [{ text: "Xatolarim" }],
    [{ text: "Yordam" }],
  ],
  resize_keyboard: true,
};

function getRoleMenu(role) {
  if (role === "superadmin") {
    return SUPERADMIN_MENU;
  }

  if (role === "employee") {
    return EMPLOYEE_MENU;
  }

  return STUDENT_MENU;
}

function roleHelp(role) {
  if (role === "superadmin") {
    return "Superadmin panel. Sizda employeelarning barcha imkoniyatlari mavjud, qo'shimcha tarzda employee qo'sha olasiz.";
  }

  if (role === "employee") {
    return "Employee panel. Lug'at va mavzu yarating, student biriktiring va natijalarni kuzating.";
  }

  return "Student panel. Mavzu yoki lug'at bo'limini tanlang, savol bering va mashq qiling.";
}

function formatTopicList(topics, emptyText) {
  if (!topics.length) {
    return emptyText;
  }

  return topics
    .map((topic) => `#${topic.id} - ${topic.title}${topic.description ? `\n${topic.description}` : ""}`)
    .join("\n\n");
}

function formatEmployeeTopicList(topics, activeTopicId) {
  if (!topics.length) {
    return "Hozircha mavzu yo'q. Avval /newtopic <nom> yozing.";
  }

  return topics
    .map((topic) => {
      const marker = activeTopicId === topic.id ? " [active]" : "";
      const stats = [
        `material: ${Number(topic.material_count || 0)}`,
        `video: ${Number(topic.video_count || 0)}`,
        `text/transcript: ${Number(topic.text_count || 0) + Number(topic.transcript_count || 0)}`,
        `student: ${Number(topic.student_count || 0)}`,
        `test: ${Number(topic.quiz_count || 0)}`,
      ].join(" | ");
      const avg = Number(topic.quiz_count || 0) > 0 ? `\nO'rtacha natija: ${topic.avg_percent}%` : "";
      return `#${topic.id} - ${topic.title}${marker}${topic.description ? `\n${topic.description}` : ""}\n${stats}${avg}`;
    })
    .join("\n\n");
}

function buildTopicInlineKeyboard(topics, mode) {
  if (!topics.length) {
    return null;
  }

  const prefix = mode === "employee" ? "employee_use_topic" : "student_select_topic";
  const buttonLabel = mode === "employee" ? "Aktiv qilish" : "Tanlash";

  return {
    inline_keyboard: topics.map((topic) => [
      {
        text: `${buttonLabel}: ${topic.title}`,
        callback_data: `${prefix}:${topic.id}`,
      },
    ]),
  };
}

function buildLanguageInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "O'zbekcha", callback_data: "set_lang:uz" }],
      [{ text: "Deutsch", callback_data: "set_lang:de" }],
    ],
  };
}

function buildStudentQuickActionsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "O'zbekcha", callback_data: "reexplain_last:uz" },
        { text: "Deutsch", callback_data: "reexplain_last:de" },
      ],
      [
        { text: "Qisqacha", callback_data: "student_topic_summary" },
        { text: "Soddaroq", callback_data: "restyle_last:simple" },
        { text: "Misol bilan", callback_data: "restyle_last:example" },
      ],
      [
        { text: "Xatolarim", callback_data: "student_show_mistakes" },
        { text: "Test boshlash", callback_data: "student_quiz_start" },
      ],
    ],
  };
}

function buildStudentPickerInlineKeyboard(students) {
  if (!students.length) {
    return null;
  }

  return {
    inline_keyboard: students.map((student) => [
      {
        text: student.full_name,
        callback_data: `assign_student:${student.id}`,
      },
    ]),
  };
}

function buildMistakeActionsKeyboard({ canRetry = false, canStartQuiz = false }) {
  const rows = [];

  if (canRetry) {
    rows.unshift([{ text: "Xatolar bo'yicha qayta mashq", callback_data: "student_retry_mistakes" }]);
  }

  if (canStartQuiz) {
    rows.push([{ text: "Test boshlash", callback_data: "student_quiz_start" }]);
  }

  if (!rows.length) {
    rows.push([{ text: "Qisqacha", callback_data: "student_topic_summary" }]);
  }

  return {
    inline_keyboard: rows,
  };
}

function getPreferredLanguageCode(state) {
  const candidate = String(state?.preferred_language || "uz").toLowerCase();
  return ["uz", "de"].includes(candidate) ? candidate : "uz";
}

function buildLanguageChoiceText(languageCode = "uz") {
  const language = getLanguageMeta(languageCode);
  return [
    `${language.currentLanguageLabel}: ${language.label}`,
    language.languageQuestion,
  ].join("\n");
}

function parseLanguageChoice(text) {
  const value = normalizeText(text);

  if (
    value.includes("uzbek") ||
    value.includes("o'zbek") ||
    value.includes("ozbek") ||
    value === "uz"
  ) {
    return "uz";
  }

  if (
    value.includes("nemis") ||
    value.includes("deutsch") ||
    value.includes("german") ||
    value === "de"
  ) {
    return "de";
  }

  return null;
}

function getStudentDictionaryText(languageCode = "uz") {
  if (languageCode === "de") {
    return {
      listTitle: "Wörterbuch-Bereiche",
      emptyList: "Für dich gibt es noch keinen Wörterbuch-Bereich.",
      chooseSection: "Wähle einen Bereich über die Schaltflächen unten.",
      sectionLabel: "Bereich",
      countLabel: "Wortpaare",
      practiceHint: "Wähle unten, mit wie vielen Fragen getestet werden soll.",
      startFive: "5 Fragen",
      startTen: "10 Fragen",
      startTwenty: "20 Fragen",
      questionDeToUz: "Übersetze dieses deutsche Wort ins Usbekische:",
      questionUzToDe: "Übersetze dieses usbekische Wort ins Deutsche:",
      correct: "Richtig.",
      retry: "Nicht richtig. Versuch es noch einmal.",
      wrongAnswerLead: "Nicht richtig.",
      solutionLabel: "Richtige Antwort",
      nextQuestion: "Nächste Frage:",
      testFinished: "Wörterbuch-Test beendet.",
      selectedCountAdjusted: "In diesem Bereich gibt es weniger Wörter, deshalb starte ich mit allen verfügbaren Wörtern.",
      unavailable: "Dieser Wörterbuch-Bereich wurde nicht gefunden.",
      emptyDictionary: "In diesem Bereich gibt es noch keine Wörter.",
      blockedByQuiz: "Beende zuerst den aktuellen Test zum Thema.",
    };
  }

  return {
    listTitle: "Lug'at bo'limlari",
    emptyList: "Siz uchun hali lug'at bo'limi yo'q.",
    chooseSection: "Tanlash uchun pastdagi tugmalardan birini bosing.",
    sectionLabel: "Bo'lim",
    countLabel: "Juftliklar",
    practiceHint: "Pastdan nechta savol bilan test bo'lishini tanlang.",
    startFive: "5 ta",
    startTen: "10 ta",
    startTwenty: "20 ta",
    questionDeToUz: "Nemischa so'zni o'zbekchaga tarjima qiling:",
    questionUzToDe: "O'zbekcha so'zni nemischaga tarjima qiling:",
    correct: "To'g'ri.",
    retry: "Noto'g'ri. Yana urinib ko'ring.",
    wrongAnswerLead: "Noto'g'ri.",
    solutionLabel: "To'g'ri javob",
    nextQuestion: "Keyingi savol:",
    testFinished: "Lug'at testi tugadi.",
    selectedCountAdjusted: "Bu bo'limda tanlangan sondan kamroq so'z bor, shuning uchun hammasi bilan boshladim.",
    unavailable: "Bu lug'at bo'limi topilmadi.",
    emptyDictionary: "Bu bo'limda hali so'z yo'q.",
    blockedByQuiz: "Avval mavzu testini tugating.",
  };
}

function formatDictionaryList(dictionaries, { emptyText, countLabel }) {
  if (!dictionaries.length) {
    return emptyText;
  }

  return dictionaries
    .map((dictionary) => `#${dictionary.id} - ${dictionary.title}\n${countLabel}: ${Number(dictionary.entry_count || 0)}`)
    .join("\n\n");
}

function buildEmployeeDictionaryInlineKeyboard(dictionaries) {
  return {
    inline_keyboard: [
      [{ text: "+ Yangi bo'lim", callback_data: "dictionary_create" }],
      ...dictionaries.map((dictionary) => [
        {
          text: dictionary.title,
          callback_data: `employee_dictionary:${dictionary.id}`,
        },
      ]),
    ],
  };
}

function buildEmployeeDictionaryActionsKeyboard(dictionaryId) {
  return {
    inline_keyboard: [
      [
        { text: "Qo'shish", callback_data: `dictionary_add:${dictionaryId}` },
        { text: "Yangilash", callback_data: `dictionary_replace:${dictionaryId}` },
      ],
      [{ text: "O'chirish", callback_data: `dictionary_delete:${dictionaryId}` }],
    ],
  };
}

function buildDeleteDictionaryConfirmKeyboard(dictionaryId) {
  return {
    inline_keyboard: [
      [
        { text: "Ha, o'chir", callback_data: `dictionary_delete_confirm:${dictionaryId}` },
        { text: "Bekor", callback_data: "dictionary_delete_cancel" },
      ],
    ],
  };
}

function buildStudentDictionaryInlineKeyboard(dictionaries) {
  if (!dictionaries.length) {
    return null;
  }

  return {
    inline_keyboard: dictionaries.map((dictionary) => [
      {
        text: dictionary.title,
        callback_data: `student_dictionary:${dictionary.id}`,
      },
    ]),
  };
}

function buildStudentDictionaryActionsKeyboard(dictionaryId, languageCode = "uz") {
  const ui = getStudentDictionaryText(languageCode);

  return {
    inline_keyboard: [
      [
        { text: ui.startFive, callback_data: `dictionary_practice_start:${dictionaryId}:5` },
        { text: ui.startTen, callback_data: `dictionary_practice_start:${dictionaryId}:10` },
        { text: ui.startTwenty, callback_data: `dictionary_practice_start:${dictionaryId}:20` },
      ],
    ],
  };
}

function buildDictionaryQuestionText({ entry, direction, languageCode = "uz", currentNumber = null, totalQuestions = null }) {
  const ui = getStudentDictionaryText(languageCode);
  const prompt = direction === "de_to_uz" ? ui.questionDeToUz : ui.questionUzToDe;
  const term = direction === "de_to_uz" ? entry.german_text : entry.uzbek_text;
  const progress = currentNumber && totalQuestions ? `${currentNumber}/${totalQuestions}\n` : "";
  return `${progress}${prompt}\n\n${term}`;
}

function splitTextByLines(text, maxLength = 3500) {
  const lines = String(text || "").split("\n");
  const parts = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > maxLength && current) {
      parts.push(current);
      current = line;
      continue;
    }

    current = next;
  }

  if (current) {
    parts.push(current);
  }

  return parts.filter(Boolean);
}

function shuffleArray(items) {
  const cloned = Array.isArray(items) ? items.slice() : [];

  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = cloned[index];
    cloned[index] = cloned[randomIndex];
    cloned[randomIndex] = current;
  }

  return cloned;
}

function parseId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildQuizQuestionMessage(question, totalQuestions) {
  return `${question.question_order}/${totalQuestions}-savol:\n${question.question_text}`;
}

function formatSourceSnippets({ question, chunks, languageCode }) {
  const relevantChunks = selectRelevantChunks(question, chunks, config.topicSourceSnippetLimit);

  if (!relevantChunks.length) {
    return "";
  }

  const language = getLanguageMeta(languageCode);

  return [
    "",
    `${language.sourcesTitle}:`,
    ...relevantChunks.map((chunk, index) => `${index + 1}. ${shortText(chunk, 240)}`),
  ].join("\n");
}

function withSourceSnippets({ answer, question, chunks, languageCode }) {
  const sourceText = formatSourceSnippets({ question, chunks, languageCode });
  return `${answer}${sourceText ? `\n\n${sourceText}` : ""}`;
}

function formatEmployeeResults(stats, recentResults) {
  if (!stats.length && !recentResults.length) {
    return "Hozircha studentlar yoki test natijalari yo'q.";
  }

  const totalStudents = stats.length;
  const testedStudents = stats.filter((item) => Number(item.attempt_count || 0) > 0).length;
  const totalAttempts = stats.reduce((sum, item) => sum + Number(item.attempt_count || 0), 0);
  const totalCorrect = stats.reduce((sum, item) => sum + Number(item.correct_answers || 0), 0);
  const totalAnswers = stats.reduce((sum, item) => sum + Number(item.total_answers || 0), 0);
  const overallPercent = totalAnswers ? ((totalCorrect / totalAnswers) * 100).toFixed(1) : "0.0";

  return [
    "Employee natijalari",
    `Studentlar: ${totalStudents}`,
    `Test topshirganlar: ${testedStudents}`,
    `Jami testlar: ${totalAttempts}`,
    `Umumiy aniqlik: ${overallPercent}%`,
    "",
    "Studentlar kesimida:",
    ...(stats.length
      ? stats.slice(0, 8).map((item) => {
          const attempts = Number(item.attempt_count || 0);
          const percent = Number(item.avg_percent || 0).toFixed(1);
          return `- ${item.full_name}: ${percent}% (${attempts} ta test)`;
        })
      : ["- Hali student yo'q."]),
    "",
    "So'nggi testlar:",
    ...(recentResults.length
      ? recentResults.slice(0, 6).map((item) => `- ${item.student_full_name} | ${item.topic_title} | ${item.correct_answers}/${item.total_questions} (${item.percent}%)`)
      : ["- Hali tugallangan test yo'q."]),
  ].join("\n");
}

function formatWeakStudents(stats) {
  const weakStudents = stats.filter(
    (item) => Number(item.attempt_count || 0) > 0 && Number(item.avg_percent || 0) < config.weakStudentThresholdPercent,
  );

  if (!weakStudents.length) {
    return `Hozircha ${config.weakStudentThresholdPercent}% dan past student topilmadi.`;
  }

  return [
    `Kuchsiz studentlar (< ${config.weakStudentThresholdPercent}%)`,
    ...weakStudents.map(
      (item) =>
        `- ${item.full_name}: ${Number(item.avg_percent || 0).toFixed(1)}% | testlar: ${Number(item.attempt_count || 0)} | telegram_id: ${item.telegram_user_id}`,
    ),
  ].join("\n");
}

function formatMistakeSummary(mistakes, languageCode) {
  const language = getLanguageMeta(languageCode);

  if (!mistakes.length) {
    return language.noMistakes;
  }

  return mistakes
    .map(
      (item, index) =>
        `${index + 1}. ${item.question_text}\n${language.yourAnswerLabel}: ${item.student_answer || "-"}\n${language.correctAnswerLabel}: ${item.expected_answer || "-"}`,
    )
    .join("\n\n");
}

function buildDictionaryMistake(entry, direction, studentAnswer) {
  const promptText = direction === "de_to_uz" ? entry.german_text : entry.uzbek_text;
  const expectedAnswer = direction === "de_to_uz" ? entry.uzbek_text : entry.german_text;

  return {
    direction,
    promptText,
    expectedAnswer,
    studentAnswer: cleanText(studentAnswer) || "-",
  };
}

function formatEmployeeDictionaryResult({
  studentName,
  dictionaryTitle,
  correctAnswers,
  totalQuestions,
  durationText,
  mistakes,
}) {
  return [
    "Lug'at test natijasi",
    `Student: ${studentName}`,
    `Bo'lim: ${dictionaryTitle}`,
    `Natija: ${correctAnswers}/${totalQuestions}`,
    `Sarflangan vaqt: ${durationText}`,
    "",
    mistakes.length
      ? [
          "Noto'g'ri javoblar:",
          ...mistakes.map(
            (item, index) =>
              `${index + 1}. ${item.promptText}\nYo'nalish: ${item.direction === "de_to_uz" ? "nemischa -> o'zbekcha" : "o'zbekcha -> nemischa"}\nTo'g'ri javob: ${item.expectedAnswer}\nStudent javobi: ${item.studentAnswer || "-"}`,
          ),
        ].join("\n\n")
      : "Barcha javoblar to'g'ri.",
  ].join("\n");
}

function isVideoDocument(document) {
  return Boolean(document?.mime_type && String(document.mime_type).toLowerCase().startsWith("video/"));
}

function getIncomingVideo(message) {
  if (message.video) {
    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      fileSize: message.video.file_size || 0,
      mimeType: "video/mp4",
      fileName: `video-${message.video.file_unique_id || message.video.file_id}.mp4`,
    };
  }

  if (isVideoDocument(message.document)) {
    const extension = String(message.document.file_name || "video.mp4").split(".").pop() || "mp4";
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileSize: message.document.file_size || 0,
      mimeType: message.document.mime_type || "video/mp4",
      fileName: message.document.file_name || `video-${message.document.file_unique_id || message.document.file_id}.${extension}`,
    };
  }

  return null;
}

class UstozBot {
  constructor() {
    this.offset = 0;
  }

  async start() {
    console.log("Ustoz AI bot started.");
    console.log(`OpenAI configured: ${hasOpenAi() ? "yes" : "no"}`);

    try {
      // Clear old updates to avoid spamming on restart
      const initialUpdates = await getUpdates();
      if (initialUpdates && initialUpdates.length > 0) {
        this.offset = initialUpdates[initialUpdates.length - 1].update_id + 1;
        await getUpdates(this.offset);
        console.log(`Cleared ${initialUpdates.length} old updates on startup.`);
      }
    } catch (error) {
      console.error("Failed to clear old updates:", error);
    }

    while (true) {
      try {
        const updates = await getUpdates(this.offset);

        for (const update of updates) {
          this.offset = update.update_id + 1;

          try {
            await this.handleUpdate(update);
          } catch (error) {
            console.error("Update handling failed:", error);
          }
        }
      } catch (error) {
        console.error("Polling failed:", error);
        await sleep(config.pollRetryDelayMs);
      }
    }
  }

  async handleUpdate(update) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;

    if (!message || !message.from || !message.chat) {
      return;
    }

    console.log(
      "[update]",
      JSON.stringify({
        updateId: update.update_id,
        chatId: message.chat.id,
        fromId: message.from.id,
        messageId: message.message_id,
        text: message.text || null,
        hasVideo: Boolean(getIncomingVideo(message)),
      }),
    );

    let actor = await this.resolveActor(message.from);
    const isStartCommand = message.text && splitCommand(message.text)?.command === "/start";

    if (!actor && isStartCommand) {
      actor = await ensureStudent({
        telegramUserId: message.from.id,
        fullName: buildTelegramDisplayName(message.from),
        username: message.from.username || null,
      });

      const staffMembers = await listStaffMembers();
      for (const staff of staffMembers) {
        try {
          await sendMessage(
            staff.telegram_user_id,
            `Yangi student ro'yxatdan o'tdi: ${actor.full_name} (@${actor.username || "yo'q"})`
          );
        } catch (err) {
          console.error("Yangi student haqida xabar yuborishda xatolik:", err);
        }
      }
    }

    if (!actor) {
      await sendMessage(
        message.chat.id,
        "Siz botdan foydalanish uchun /start tugmasini bosing.",
      );
      return;
    }

    if (message.text) {
      const command = splitCommand(message.text);

      if (command) {
        await this.handleCommand({ actor, chatId: message.chat.id, command });
        return;
      }

      await this.handleTextMessage({ actor, chatId: message.chat.id, message });
      return;
    }

    if (getIncomingVideo(message)) {
      await this.handleVideoMessage({ actor, chatId: message.chat.id, message });
      return;
    }

    await sendMessage(message.chat.id, "Hozircha text va video message bilan ishlayman.");
  }

  async resolveActor(from) {
    const profile = {
      telegramUserId: from.id,
      fullName: buildTelegramDisplayName(from),
      username: from.username || null,
    };

    if (config.superadminTelegramId && from.id === config.superadminTelegramId) {
      return ensureSuperadmin(profile);
    }

    if (!config.superadminTelegramId) {
      const existingSuperadmin = await findAnySuperadmin();

      if (!existingSuperadmin) {
        return ensureSuperadmin(profile);
      }
    }

    const existing = await findByTelegramUserId(from.id);

    if (!existing) {
      return null;
    }

    return touchKnownUser(profile);
  }

  async handleCommand({ actor, chatId, command }) {
    switch (command.command) {
      case "/start":
      case "/help":
        await this.sendRoleMenu({ actor, chatId });
        return;

      case "/cancel":
        await clearPendingAction(actor.id);
        await sendMessage(chatId, "Kutilayotgan action bekor qilindi.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;

      case "/makeemployee":
        await this.handleMakeEmployee({ actor, chatId, argsText: command.argsText });
        return;

      case "/addstudent":
        await this.handleAddStudent({ actor, chatId, argsText: command.argsText });
        return;

      case "/newtopic":
        await this.handleNewTopic({ actor, chatId, argsText: command.argsText });
        return;

      case "/topics":
        await this.handleListEmployeeTopics({ actor, chatId });
        return;

      case "/use":
        await this.handleUseTopic({ actor, chatId, argsText: command.argsText });
        return;

      case "/assigntopic":
        await this.handleAssignTopic({ actor, chatId, argsText: command.argsText });
        return;

      case "/results":
        await this.showEmployeeResults({ actor, chatId });
        return;

      case "/weakstudents":
        await this.showWeakStudents({ actor, chatId });
        return;

      case "/checkai":
        if (actor.role !== "superadmin") {
          await sendMessage(chatId, "Bu buyruq faqat superadmin uchun.");
          return;
        }

        try {
          const result = await gradeQuizAnswer({
            topicTitle: "Test",
            question: "Checking AI",
            expectedAnswer: "Success",
            studentAnswer: "Success",
          });
          await sendMessage(chatId, `AI holati: OK ✅\nFeedback: ${result.feedback}`);
        } catch (error) {
          await sendMessage(chatId, `AI holati: XATO ❌\nSabab: ${error.message}`);
        }
        return;

      case "/uploadvideo":
        await this.handlePrepareVideoUpload({ actor, chatId, argsText: command.argsText });
        return;

      case "/uploadtext":
        await this.handlePrepareTextUpload({ actor, chatId, argsText: command.argsText });
        return;

      case "/dictionaries":
        if (isStaff(actor.role)) {
          await this.showEmployeeDictionaries({ actor, chatId });
          return;
        }

        if (actor.role === "student") {
          await this.showStudentDictionaries({ actor, chatId });
          return;
        }

        await sendMessage(chatId, "Bu buyruq siz uchun ochiq emas.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;

      case "/mytopics":
        if (actor.role === "student") {
          await clearDictionarySession(actor.id);
        }
        await this.handleListStudentTopics({ actor, chatId });
        return;

      case "/topic":
        await this.handleSelectTopic({ actor, chatId, argsText: command.argsText });
        return;

      case "/mistakes":
        if (actor.role === "student") {
          await clearDictionarySession(actor.id);
        }
        await this.showStudentMistakes({ actor, chatId });
        return;

      default:
        await sendMessage(chatId, "Noma'lum buyruq. /help ni yozib ko'ring.", {
          reply_markup: getRoleMenu(actor.role),
        });
    }
  }

  async sendRoleMenu({ actor, chatId, extraText }) {
    const parts = [];

    if (extraText) {
      parts.push(extraText);
    }

    parts.push(roleHelp(actor.role));

    await sendMessage(chatId, parts.join("\n\n"), {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async handleCallbackQuery(callbackQuery) {
    console.log(
      "[callback]",
      JSON.stringify({
        callbackId: callbackQuery.id,
        fromId: callbackQuery.from?.id,
        data: callbackQuery.data || null,
      }),
    );

    if (!callbackQuery.from || !callbackQuery.message) {
      return;
    }

    const actor = await this.resolveActor(callbackQuery.from);

    if (!actor) {
      await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
      return;
    }

    const parts = String(callbackQuery.data || "").split(":");
    const action = parts[0] || "";
    const rawId = parts[1] || "";
    const rawExtra = parts[2] || "";
    const topicId = parseId(rawId);
    const extraId = parseId(rawExtra);

    if (action === "employee_use_topic" && topicId) {
      const topic = await getTopicByIdForEmployee(topicId, actor.id);

      if (!topic) {
        await answerCallbackQuery(callbackQuery.id, "Topic topilmadi.");
        return;
      }

      await setActiveTopic(actor.id, topic.id);
      await clearPendingAction(actor.id);
      await answerCallbackQuery(callbackQuery.id, "Aktiv qilindi.");
      await sendMessage(
        callbackQuery.message.chat.id,
        `Aktiv mavzu: #${topic.id} - ${topic.title}\nEndi text yoki video'ni oddiy yuboravering.`,
        { reply_markup: getRoleMenu(actor.role) },
      );
      return;
    }

    if (action === "student_select_topic" && topicId) {
      await answerCallbackQuery(callbackQuery.id, "Mavzu tanlandi.");
      await this.selectTopicForStudent({
        actor,
        chatId: callbackQuery.message.chat.id,
        topicId,
      });
      return;
    }

    if (action === "set_lang" && rawId) {
      const languageCode = String(rawId).toLowerCase();

      if (!["uz", "de"].includes(languageCode)) {
        await answerCallbackQuery(callbackQuery.id, "Til topilmadi.");
        return;
      }

      await setPreferredLanguage(actor.id, languageCode);
      const label = getLanguageMeta(languageCode).label;
      await answerCallbackQuery(callbackQuery.id, label);
      await sendMessage(
        callbackQuery.message.chat.id,
        `Tushuntirish tili saqlandi: ${label}`,
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (action === "assign_student" && topicId) {
      await answerCallbackQuery(callbackQuery.id, "Student biriktirilmoqda.");
      await this.assignActiveTopicToStudent({
        actor,
        chatId: callbackQuery.message.chat.id,
        studentUserId: topicId,
      });
      return;
    }

    if (action === "reexplain_last" && rawId) {
      const languageCode = String(rawId).toLowerCase();

      if (!["uz", "de"].includes(languageCode)) {
        await answerCallbackQuery(callbackQuery.id, "Til topilmadi.");
        return;
      }

      await setPreferredLanguage(actor.id, languageCode);
      await answerCallbackQuery(callbackQuery.id, `Tilda: ${getLanguageMeta(languageCode).label}`);
      await clearDictionarySession(actor.id);
      await this.reexplainLastStudentQuestion({
        actor,
        chatId: callbackQuery.message.chat.id,
        languageCode,
      });
      return;
    }

    if (action === "restyle_last" && rawId) {
      const mode = String(rawId).toLowerCase();

      if (!["simple", "example"].includes(mode)) {
        await answerCallbackQuery(callbackQuery.id, "Rejim topilmadi.");
        return;
      }

      await answerCallbackQuery(callbackQuery.id, mode === "simple" ? "Soddalashtiraman." : "Misol bilan tushuntiraman.");
      await this.reexplainLastStudentQuestion({
        actor,
        chatId: callbackQuery.message.chat.id,
        languageCode: getPreferredLanguageCode(await getUserState(actor.id)),
        teachingMode: mode,
      });
      return;
    }

    if (action === "student_topic_summary") {
      await answerCallbackQuery(callbackQuery.id, "Qisqacha tushuntiraman.");
      await clearDictionarySession(actor.id);
      await this.sendTopicSummary({
        actor,
        chatId: callbackQuery.message.chat.id,
      });
      return;
    }

    if (action === "student_quiz_start") {
      await answerCallbackQuery(callbackQuery.id, "Test boshlanmoqda.");
      await clearDictionarySession(actor.id);
      await this.startQuizFromActiveTopic({
        actor,
        chatId: callbackQuery.message.chat.id,
      });
      return;
    }

    if (action === "student_show_mistakes") {
      await answerCallbackQuery(callbackQuery.id, "Xatolar ko'rsatilmoqda.");
      await clearDictionarySession(actor.id);
      await this.showStudentMistakes({
        actor,
        chatId: callbackQuery.message.chat.id,
      });
      return;
    }

    if (action === "student_retry_mistakes") {
      await answerCallbackQuery(callbackQuery.id, "Xatolar bo'yicha mashq boshlanmoqda.");
      await clearDictionarySession(actor.id);
      await this.startMistakePractice({
        actor,
        chatId: callbackQuery.message.chat.id,
      });
      return;
    }

    if (action === "dictionary_create") {
      if (!isStaff(actor.role)) {
        await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
        return;
      }

      await answerCallbackQuery(callbackQuery.id, "Yangi bo'lim yaratilmoqda.");
      await setPendingAction({
        userId: actor.id,
        pendingAction: "creating_dictionary_title",
      });
      await sendMessage(callbackQuery.message.chat.id, "1/2 Yangi lug'at bo'limi nomini yuboring.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (action === "employee_dictionary" && topicId) {
      await answerCallbackQuery(callbackQuery.id, "Bo'lim ochildi.");
      await this.openEmployeeDictionary({
        actor,
        chatId: callbackQuery.message.chat.id,
        dictionaryId: topicId,
      });
      return;
    }

    if (action === "student_dictionary" && topicId) {
      await answerCallbackQuery(callbackQuery.id, "Bo'lim tanlandi.");
      await this.openStudentDictionary({
        actor,
        chatId: callbackQuery.message.chat.id,
        dictionaryId: topicId,
      });
      return;
    }

    if (action === "dictionary_add" && topicId) {
      if (!isStaff(actor.role)) {
        await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
        return;
      }

      const dictionary = await getDictionaryByIdForEmployee(topicId, actor.id);

      if (!dictionary) {
        await answerCallbackQuery(callbackQuery.id, "Bo'lim topilmadi.");
        return;
      }

      await answerCallbackQuery(callbackQuery.id, "Qo'shish rejimi.");
      await setPendingAction({
        userId: actor.id,
        pendingAction: "adding_dictionary_entries",
        pendingPayload: {
          dictionaryId: dictionary.id,
        },
      });
      await sendMessage(
        callbackQuery.message.chat.id,
        this.buildDictionaryImportPrompt(`"${dictionary.title}" bo'limiga qo'shadigan juftliklarni yuboring.`),
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (action === "dictionary_replace" && topicId) {
      if (!isStaff(actor.role)) {
        await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
        return;
      }

      const dictionary = await getDictionaryByIdForEmployee(topicId, actor.id);

      if (!dictionary) {
        await answerCallbackQuery(callbackQuery.id, "Bo'lim topilmadi.");
        return;
      }

      await answerCallbackQuery(callbackQuery.id, "Yangilash rejimi.");
      await setPendingAction({
        userId: actor.id,
        pendingAction: "replacing_dictionary_entries",
        pendingPayload: {
          dictionaryId: dictionary.id,
        },
      });
      await sendMessage(
        callbackQuery.message.chat.id,
        this.buildDictionaryImportPrompt(`"${dictionary.title}" bo'limi to'liq yangilanadi. Yangi juftliklarni yuboring.`),
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (action === "dictionary_delete" && topicId) {
      if (!isStaff(actor.role)) {
        await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
        return;
      }

      const dictionary = await getDictionaryByIdForEmployee(topicId, actor.id);

      if (!dictionary) {
        await answerCallbackQuery(callbackQuery.id, "Bo'lim topilmadi.");
        return;
      }

      await answerCallbackQuery(callbackQuery.id, "Tasdiqlang.");
      await sendMessage(
        callbackQuery.message.chat.id,
        `"${dictionary.title}" bo'limini o'chirmoqchimisiz?`,
        {
          reply_markup: buildDeleteDictionaryConfirmKeyboard(dictionary.id),
        },
      );
      return;
    }

    if (action === "dictionary_delete_confirm" && topicId) {
      if (!isStaff(actor.role)) {
        await answerCallbackQuery(callbackQuery.id, "Sizga ruxsat yo'q.");
        return;
      }

      const dictionary = await getDictionaryByIdForEmployee(topicId, actor.id);

      if (!dictionary) {
        await answerCallbackQuery(callbackQuery.id, "Bo'lim topilmadi.");
        return;
      }

      await deleteDictionary(dictionary.id);
      await answerCallbackQuery(callbackQuery.id, "O'chirildi.");
      await this.showEmployeeDictionaries({
        actor,
        chatId: callbackQuery.message.chat.id,
        extraText: `"${dictionary.title}" bo'limi o'chirildi.`,
      });
      return;
    }

    if (action === "dictionary_delete_cancel") {
      await answerCallbackQuery(callbackQuery.id, "Bekor qilindi.");
      return;
    }

    if (action === "dictionary_practice_start" && topicId && extraId) {
      await answerCallbackQuery(callbackQuery.id, "Savol-javob boshlandi.");
      await this.startDictionaryPractice({
        actor,
        chatId: callbackQuery.message.chat.id,
        dictionaryId: topicId,
        questionLimit: extraId,
        sourceMessageId: callbackQuery.message.message_id,
      });
      return;
    }

    await answerCallbackQuery(callbackQuery.id, "Noma'lum action.");
  }

  async handleMakeEmployee({ actor, chatId, argsText }) {
    if (actor.role !== "superadmin") {
      await sendMessage(chatId, "Bu buyruq faqat superadmin uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "adding_employee",
      });
      await sendMessage(chatId, "Employee ma'lumotini yuboring:\ntelegram_id | ism", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const [telegramIdRaw, fullName] = parsePipeArgs(argsText);
    const telegramUserId = parseId(telegramIdRaw);

    if (!telegramUserId || !fullName) {
      await sendMessage(chatId, "Format: /makeemployee <telegram_id> | <ism>");
      return;
    }

    const employee = await createManagedUser({
      telegramUserId,
      fullName,
      username: null,
      role: "employee",
      createdByUserId: actor.id,
    });

    await sendMessage(chatId, `Employee tayyor: ${employee.full_name} (${employee.telegram_user_id})`, {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async handleSuperadminTextMessage({ actor, chatId, message }) {
    const state = await getUserState(actor.id);
    const text = cleanText(message.text);
    const normalizedText = normalizeText(message.text);

    if (normalizedText === "yordam") {
      await this.sendRoleMenu({ actor, chatId });
      return;
    }

    if (normalizedText === "employee qo'shish") {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "adding_employee",
      });
      await sendMessage(chatId, "1/1 Employee ma'lumotini yuboring:\ntelegram_id | ism", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (state?.pending_action === "adding_employee") {
      const [telegramIdRaw, fullName] = parsePipeArgs(message.text);
      const telegramUserId = parseId(telegramIdRaw);

      if (!telegramUserId || !fullName) {
        await sendMessage(chatId, "Format: telegram_id | ism", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      const employee = await createManagedUser({
        telegramUserId,
        fullName,
        username: null,
        role: "employee",
        createdByUserId: actor.id,
      });

      await clearPendingAction(actor.id);
      await this.sendRoleMenu({
        actor,
        chatId,
        extraText: `Employee qo'shildi: ${employee.full_name} (${employee.telegram_user_id})`,
      });
      return;
    }

    await this.handleEmployeeTextMessage({ actor, chatId, message });
  }

  async handleAddStudent({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "adding_student",
      });
      await sendMessage(chatId, "Student ma'lumotini yuboring:\ntelegram_id | ism", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const [telegramIdRaw, fullName] = parsePipeArgs(argsText);
    const telegramUserId = parseId(telegramIdRaw);

    if (!telegramUserId || !fullName) {
      await sendMessage(chatId, "Format: /addstudent <telegram_id> | <ism>");
      return;
    }

    const student = await createManagedUser({
      telegramUserId,
      fullName,
      username: null,
      role: "student",
      createdByUserId: actor.id,
    });

    await sendMessage(chatId, `Student qo'shildi: ${student.full_name} (${student.telegram_user_id})`, {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async handleNewTopic({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "creating_topic_title",
      });
      await sendMessage(chatId, "Yangi mavzu nomini yuboring.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const [title, description] = parsePipeArgs(argsText);

    if (!title) {
      await sendMessage(chatId, "Format: /newtopic <nom> | <izoh ixtiyoriy>");
      return;
    }

    const topic = await createTopic({
      employeeUserId: actor.id,
      title,
      description,
    });

    await setActiveTopic(actor.id, topic.id);
    await sendMessage(
      chatId,
      `Mavzu yaratildi va aktiv qilindi: #${topic.id} - ${topic.title}\nEndi text yoki video'ni oddiy yuboravering.`,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async handleListEmployeeTopics({ actor, chatId }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    const state = await getUserState(actor.id);
    const topics = await listTopicsByEmployeeWithStats(actor.id);
    await sendMessage(chatId, formatEmployeeTopicList(topics, state?.active_topic_id || null), {
      reply_markup: buildTopicInlineKeyboard(topics, "employee") || getRoleMenu(actor.role),
    });
  }

  async handleUseTopic({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      await this.handleListEmployeeTopics({ actor, chatId });
      return;
    }

    const topicId = parseId(argsText);

    if (!topicId) {
      await sendMessage(chatId, "Format: /use <topic_id>");
      return;
    }

    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Topic topilmadi yoki sizga tegishli emas.");
      return;
    }

    await setActiveTopic(actor.id, topic.id);
    await clearPendingAction(actor.id);
    await sendMessage(
      chatId,
      `Aktiv mavzu: #${topic.id} - ${topic.title}\nEndi text yoki video'ni oddiy yuboravering.`,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async handleAssignTopic({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      const state = await getUserState(actor.id);

      if (!state?.active_topic_id) {
        await sendMessage(chatId, "Avval aktiv mavzuni tanlang. Mavzularim tugmasini bosing.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      await setPendingAction({
        userId: actor.id,
        pendingAction: "assigning_student_to_active_topic",
        pendingTopicId: state.active_topic_id,
      });
      await this.showAssignStudentPicker({
        actor,
        chatId,
        topicId: state.active_topic_id,
      });
      return;
    }

    const [studentTelegramIdRaw, topicIdRaw] = String(argsText || "").trim().split(/\s+/);
    const studentTelegramId = parseId(studentTelegramIdRaw);
    const topicId = parseId(topicIdRaw);

    if (!studentTelegramId || !topicId) {
      await sendMessage(chatId, "Format: /assigntopic <student_telegram_id> <topic_id>");
      return;
    }

    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Bunday mavzu topilmadi yoki u sizga tegishli emas.");
      return;
    }

    const student = await findByTelegramUserId(studentTelegramId);

    if (!student || student.role !== "student") {
      await sendMessage(chatId, "Bunday student topilmadi.");
      return;
    }

    await assignTopicToStudent({
      studentUserId: student.id,
      topicId: topic.id,
      assignedByUserId: actor.id,
    });

    await sendMessage(chatId, `${student.full_name} ga #${topic.id} mavzu biriktirildi.`, {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async handlePrepareVideoUpload({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    const [topicIdRaw, title] = parsePipeArgs(argsText);
    const topicId = parseId(topicIdRaw);

    if (!topicId || !title) {
      await sendMessage(
        chatId,
        "Eski usul ham ishlaydi, lekin qulayroq yo'l:\n/use <topic_id>\nkeyin videoni oddiy yuboring.\n\nEski format: /uploadvideo <topic_id> | <sarlavha>",
      );
      return;
    }

    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Topic topilmadi yoki u sizga tegishli emas.");
      return;
    }

    await setPendingAction({
      userId: actor.id,
      pendingAction: "awaiting_video",
      pendingTopicId: topic.id,
      pendingTitle: title,
    });

    await sendMessage(chatId, "Endi shu chatga video yuboring. Men DBga faqat Telegram file_id saqlayman.");
  }

  async handlePrepareTextUpload({ actor, chatId, argsText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu buyruq faqat employee uchun.");
      return;
    }

    const [topicIdRaw, title] = parsePipeArgs(argsText);
    const topicId = parseId(topicIdRaw);

    if (!topicId || !title) {
      await sendMessage(
        chatId,
        "Eski usul ham ishlaydi, lekin qulayroq yo'l:\n/use <topic_id>\nkeyin textni oddiy yuboring.\n\nEski format: /uploadtext <topic_id> | <sarlavha>",
      );
      return;
    }

    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Topic topilmadi yoki u sizga tegishli emas.");
      return;
    }

    await setPendingAction({
      userId: actor.id,
      pendingAction: "awaiting_text",
      pendingTopicId: topic.id,
      pendingTitle: title,
    });

    await sendMessage(chatId, "Endi shu chatga dars textini yoki transcriptni yuboring.");
  }

  async handleListStudentTopics({ actor, chatId }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu buyruq faqat student uchun.");
      return;
    }

    const topics = await listTopicsForStudent(actor.id);
    const message = `${formatTopicList(topics, "Sizga hali mavzu biriktirilmagan.")}\n\nTanlash uchun pastdagi tugmani bosing.`;
    await sendMessage(chatId, message, {
      reply_markup: buildTopicInlineKeyboard(topics, "student") || getRoleMenu(actor.role),
    });
  }

  async handleSelectTopic({ actor, chatId, argsText }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu buyruq faqat student uchun.");
      return;
    }

    if (!String(argsText || "").trim()) {
      await this.handleListStudentTopics({ actor, chatId });
      return;
    }

    const topicId = parseId(argsText);

    if (!topicId) {
      await sendMessage(chatId, "Format: /topic <topic_id>");
      return;
    }

    await this.selectTopicForStudent({ actor, chatId, topicId });
  }

  async selectTopicForStudent({ actor, chatId, topicId }) {
    const hasAccess = await studentHasTopicAccess(actor.id, topicId);

    if (!hasAccess) {
      await sendMessage(chatId, "Sizga bu mavzu biriktirilmagan.");
      return;
    }

    const topic = await getTopicById(topicId);

    if (!topic) {
      await sendMessage(chatId, "Mavzu topilmadi.");
      return;
    }

    await clearDictionarySession(actor.id);
    await setActiveTopic(actor.id, topic.id);
    await upsertStudentSession({
      studentUserId: actor.id,
      topicId: topic.id,
      state: "asking",
      activeQuizAttemptId: null,
      questionCount: 0,
      lastUserMessage: null,
    });

    const videos = await getTopicVideos(topic.id);

    await sendMessage(
      chatId,
      [
        `Mavzu tanlandi: ${topic.title}`,
        topic.description ? topic.description : "",
        "",
        "Savol berishingiz mumkin.",
        "Xohlasangiz tilni ham tanlang.",
        "Tayyor tugmalar: Qisqacha tushuntir, Soddaroq tushuntir, Misol bilan, Test boshlash, Xatolarim.",
      ]
        .filter(Boolean)
        .join("\n"),
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );

    for (const video of videos) {
      if (video.telegram_file_id) {
        await sendVideo(chatId, video.telegram_file_id, video.title || topic.title);
      }
    }

    const state = await getUserState(actor.id);
    await sendMessage(chatId, buildLanguageChoiceText(getPreferredLanguageCode(state)), {
      reply_markup: buildLanguageInlineKeyboard(),
    });
  }

  async handleVideoMessage({ actor, chatId, message }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Video qabul qilindi, lekin hozircha video yuklash faqat employee uchun ochiq.");
      return;
    }

    const state = await getUserState(actor.id);
    let topicId = null;
    let title = null;

    if (state?.pending_action === "awaiting_video" && state.pending_topic_id) {
      topicId = state.pending_topic_id;
      title = state.pending_title || null;
    } else if (state?.active_topic_id) {
      const activeTopic = await getTopicByIdForEmployee(state.active_topic_id, actor.id);

      if (activeTopic) {
        topicId = activeTopic.id;
        title = message.caption || `Video ${new Date().toISOString()}`;
      }
    }

    if (!topicId) {
      await sendMessage(chatId, "Avval /newtopic oching yoki /use <topic_id> bilan mavzuni aktiv qiling.");
      return;
    }

    const video = getIncomingVideo(message);

    if (!video) {
      await sendMessage(chatId, "Video formati aniqlanmadi.");
      return;
    }

    await saveVideoMaterial({
      topicId,
      uploadedByUserId: actor.id,
      title,
      telegramFileId: video.fileId,
      telegramFileUniqueId: video.fileUniqueId,
      sourceChatId: message.chat.id,
      sourceMessageId: message.message_id,
    });

    if (state?.pending_action === "awaiting_video") {
      await clearPendingAction(actor.id);
      if (state.active_topic_id) {
        await setActiveTopic(actor.id, state.active_topic_id);
      }
    }

    const transcriptStatus = await this.tryAutoTranscribeVideo({
      actor,
      chatId,
      topicId,
      title,
      video,
    });

    await sendMessage(
      chatId,
      transcriptStatus,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async tryAutoTranscribeVideo({ actor, chatId, topicId, title, video }) {
    const baseMessage = "Video saqlandi. DBga mp4 yozilmadi, faqat Telegram file_id va metadata saqlandi.";

    if (!hasOpenAi()) {
      return `${baseMessage}\nAI kalit ulanganida avtomatik transcript ham yaratiladi.`;
    }

    if (!video.fileSize || Number(video.fileSize) > config.telegramDownloadLimitBytes) {
      const maxMb = Math.round(config.telegramDownloadLimitBytes / (1024 * 1024));
      return `${baseMessage}\nAvtomatik transcript o'tkazib yuborildi: Telegram Bot API orqali ${maxMb} MB dan katta faylni yuklab bo'lmaydi. Shu video uchun text yoki transcriptni alohida yuboring.`;
    }

    try {
      await sendChatAction(chatId, "typing").catch(() => null);
      const file = await getFile(video.fileId);

      if (!file?.file_path) {
        throw new Error("Telegram file_path topilmadi");
      }

      const buffer = await downloadTelegramFile(file.file_path);
      const transcript = await transcribeMedia({
        fileBuffer: buffer,
        filename: video.fileName,
        mimeType: video.mimeType,
        prompt: "Educational lesson transcription. Keep terms accurate.",
      });
      const processedText = cleanText(transcript);
      const chunks = chunkText(processedText);

      if (!chunks.length) {
        throw new Error("Transcript bo'sh qaytdi");
      }

      await saveTextMaterial({
        topicId,
        uploadedByUserId: actor.id,
        title: `${title || "Video"} transcript`,
        rawText: transcript,
        processedText,
        chunks,
        materialType: "transcript",
      });

      return `${baseMessage}\nAvtomatik transcript ham yaratildi: ${chunks.length} ta knowledge chunk qo'shildi.`;
    } catch (error) {
      console.error("Auto transcription failed:", error);
      return `${baseMessage}\nAvtomatik transcript olinmadi. Xohlasangiz transcript yoki textni qo'lda yuboring.`;
    }
  }

  async handleTextMessage({ actor, chatId, message }) {
    const normalizedText = normalizeText(message.text);
    const state = await getUserState(actor.id);
    let pendingAction = state?.pending_action;

    const menuButtons = [
      "bekor qilish", "yordam", "lug'atlar", "lugatlar", 
      "employee qo'shish", "natijalar", "kuchsiz studentlar", "xatolarim"
    ];

    if (menuButtons.includes(normalizedText)) {
      if (pendingAction === "german_chat") {
        await clearPendingAction(actor.id);
        pendingAction = null;
      }
    }

    if (normalizedText === "nemis tilida suhbat") {
      await clearDictionarySession(actor.id);
      await setPendingAction({
        userId: actor.id,
        pendingAction: "german_chat",
      });
      await sendMessage(chatId, "Hallo! Lass uns auf Deutsch sprechen. Wie geht es dir heute?", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (pendingAction === "german_chat") {
      await this.handleGermanChat({ actor, chatId, message, state });
      return;
    }

    if (actor.role === "superadmin") {
      await this.handleSuperadminTextMessage({ actor, chatId, message });
      return;
    }

    if (isStaff(actor.role)) {
      await this.handleEmployeeTextMessage({ actor, chatId, message });
      return;
    }

    if (actor.role === "student") {
      await this.handleStudentTextMessage({ actor, chatId, message });
      return;
    }

    await sendMessage(chatId, roleHelp(actor.role));
  }

  async handleGermanChat({ actor, chatId, message, state }) {
    await sendChatAction(chatId, "typing");
    const history = Array.isArray(state.german_chat_history) ? state.german_chat_history : [];
    
    const aiResponse = await generateGermanChatResponse(message.text, history);
    
    history.push({ role: "user", content: message.text });
    history.push({ role: "assistant", content: aiResponse });
    
    // Keep only last 10 messages (5 turns)
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }

    await setGermanChatHistory(actor.id, history);

    await sendMessage(chatId, aiResponse);
  }

  async showEmployeeActiveTopic({ actor, chatId }) {
    const state = await getUserState(actor.id);

    if (!state?.active_topic_id) {
      await sendMessage(chatId, "Aktiv mavzu yo'q. /newtopic qiling yoki Mavzularimdan tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const topic = await getTopicByIdForEmployee(state.active_topic_id, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Aktiv mavzu topilmadi. Mavzularimdan qayta tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    await sendMessage(chatId, `Aktiv mavzu: #${topic.id} - ${topic.title}`, {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async showAssignStudentPicker({ actor, chatId, topicId }) {
    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await sendMessage(chatId, "Aktiv mavzu topilmadi. Mavzularimdan qayta tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const students = await listManagedUsersByRole({
      createdByUserId: actor.id,
      role: "student",
    });

    if (!students.length) {
      await sendMessage(chatId, "Avval student qo'shing, keyin biriktirish osonlashadi.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    await sendMessage(
      chatId,
      `Qaysi studentga #${topic.id} - ${topic.title} mavzusini biriktiray? Pastdagi tugmadan tanlang yoki telegram ID yuboring.`,
      {
        reply_markup: buildStudentPickerInlineKeyboard(students),
      },
    );
  }

  async assignActiveTopicToStudent({ actor, chatId, studentUserId }) {
    const state = await getUserState(actor.id);
    const topicId = state?.pending_topic_id || state?.active_topic_id;

    if (!topicId) {
      await sendMessage(chatId, "Aktiv mavzu topilmadi. Avval mavzuni tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const topic = await getTopicByIdForEmployee(topicId, actor.id);

    if (!topic) {
      await clearPendingAction(actor.id);
      await sendMessage(chatId, "Mavzu topilmadi yoki sizga tegishli emas.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const students = await listManagedUsersByRole({
      createdByUserId: actor.id,
      role: "student",
    });
    const student = students.find((item) => Number(item.id) === Number(studentUserId)) || null;

    if (!student) {
      await sendMessage(chatId, "Student topilmadi yoki sizga tegishli emas.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    await assignTopicToStudent({
      studentUserId: student.id,
      topicId: topic.id,
      assignedByUserId: actor.id,
    });

    await clearPendingAction(actor.id);
    await sendMessage(chatId, `${student.full_name} ga #${topic.id} - ${topic.title} biriktirildi.`, {
      reply_markup: getRoleMenu(actor.role),
    });

    try {
      await sendMessage(
        student.telegram_user_id,
        `Sizga yangi mavzu biriktirildi: ${topic.title}\nBotga /start yuborib, Mavzularim bo'limidan tanlang.`,
      );
    } catch (error) {
      console.error("Student notification failed:", error);
    }
  }

  async showStudentActiveTopic({ actor, chatId }) {
    const state = await getUserState(actor.id);
    const session = await getStudentSession(actor.id);
    const topicId = state?.active_topic_id || session?.topic_id;

    if (!topicId) {
      await sendMessage(chatId, "Aktiv mavzu tanlanmagan. Mavzularim tugmasini bosing.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const topic = await getTopicById(topicId);

    if (!topic) {
      await sendMessage(chatId, "Aktiv mavzu topilmadi. Mavzularimdan qayta tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    await sendMessage(chatId, `Aktiv mavzu: #${topic.id} - ${topic.title}`, {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async showLanguagePicker({ actor, chatId }) {
    const state = await getUserState(actor.id);
    await sendMessage(chatId, buildLanguageChoiceText(getPreferredLanguageCode(state)), {
      reply_markup: buildLanguageInlineKeyboard(),
    });
  }

  async showEmployeeResults({ actor, chatId }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu bo'lim faqat employee uchun.");
      return;
    }

    const [stats, recentResults] = await Promise.all([
      listEmployeeStudentStats(actor.id),
      listRecentQuizResultsForEmployee(actor.id),
    ]);

    await sendMessage(chatId, formatEmployeeResults(stats, recentResults), {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async showWeakStudents({ actor, chatId }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu bo'lim faqat employee uchun.");
      return;
    }

    const stats = await listEmployeeStudentStats(actor.id);
    await sendMessage(chatId, formatWeakStudents(stats), {
      reply_markup: getRoleMenu(actor.role),
    });
  }

  async notifyStudentsAboutDictionaryUpdate({ employeeUserId, dictionaryTitle, mode, count }) {
    const students = await listAccessibleStudentsForEmployee(employeeUserId);

    if (!students.length) {
      return;
    }

    const lead =
      mode === "create"
        ? `Yangi lug'at bo'limi qo'shildi: ${dictionaryTitle}`
        : mode === "append"
          ? `Lug'at bo'limiga ${count} ta yangi so'z qo'shildi: ${dictionaryTitle}`
          : `Lug'at bo'limi yangilandi: ${dictionaryTitle}`;
    const text = `${lead}\nYodlab ishlang va Lug'atlar bo'limidan mashq qiling.`;

    for (const student of students) {
      await sendMessage(student.telegram_user_id, text).catch((error) => {
        console.error("Dictionary student notification failed:", error);
      });
    }
  }

  async sendEmployeeDictionaryResult({ actor, dictionary, dictionarySession, correctAnswers, mistakes }) {
    const staff = await listStaffMembers();

    const startedAt = dictionarySession?.active_attempt_started_at
      ? new Date(dictionarySession.active_attempt_started_at)
      : null;
    const durationSeconds = startedAt ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) : 0;
    const totalQuestions = Number(dictionarySession?.total_questions || 0);

    const reportText = formatEmployeeDictionaryResult({
      studentName: actor.full_name,
      dictionaryTitle: dictionary.title,
      correctAnswers,
      totalQuestions,
      durationText: formatDurationUz(durationSeconds),
      mistakes,
    });

    for (const member of staff) {
      if (member.telegram_user_id) {
        sendMessage(member.telegram_user_id, reportText).catch((error) => {
          console.error(`Employee dictionary result notification failed for ${member.full_name}:`, error);
        });
      }
    }
  }

  async finishDictionaryPractice({ actor, chatId, dictionary, dictionarySession, languageCode, introText, correctAnswers, mistakes }) {
    const ui = getStudentDictionaryText(languageCode);
    const totalQuestions = Number(dictionarySession.total_questions || 0);

    await clearDictionarySession(actor.id);
    await sendMessage(chatId, `${introText}\n\n${ui.testFinished} ${correctAnswers}/${totalQuestions}`, {
      reply_markup: getRoleMenu(actor.role),
    });
    await this.sendEmployeeDictionaryResult({
      actor,
      dictionary,
      dictionarySession,
      correctAnswers,
      mistakes,
    });
  }

  async showEmployeeDictionaries({ actor, chatId, extraText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu bo'lim faqat employee uchun.");
      return;
    }

    const dictionaries = actor.role === "superadmin"
      ? await listAllDictionaries()
      : await listDictionariesByEmployee(actor.id);
    const parts = [];

    if (extraText) {
      parts.push(extraText);
    }

    parts.push("Lug'at bo'limlari");
    parts.push(
      formatDictionaryList(dictionaries, {
        emptyText: "Hozircha lug'at bo'limi yo'q.",
        countLabel: "Juftliklar",
      }),
    );
    parts.push("Yangi bo'lim yaratish yoki mavjud bo'limni tanlash uchun pastdagi tugmani bosing.");

    await sendMessage(chatId, parts.join("\n\n"), {
      reply_markup: buildEmployeeDictionaryInlineKeyboard(dictionaries),
    });
  }

  async openEmployeeDictionary({ actor, chatId, dictionaryId, extraText }) {
    if (!isStaff(actor.role)) {
      await sendMessage(chatId, "Bu bo'lim faqat employee uchun.");
      return;
    }

    const dictionary = await getDictionaryByIdForEmployee(dictionaryId, actor.id);

    if (!dictionary) {
      await sendMessage(chatId, "Lug'at bo'limi topilmadi yoki sizga tegishli emas.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const parts = [];

    if (extraText) {
      parts.push(extraText);
    }

    parts.push(`Bo'lim: ${dictionary.title}`);
    parts.push(`Juftliklar: ${Number(dictionary.entry_count || 0)}`);
    parts.push("Amalni tanlang.");

    await sendMessage(chatId, parts.join("\n"), {
      reply_markup: buildEmployeeDictionaryActionsKeyboard(dictionary.id),
    });
  }

  async showStudentDictionaries({ actor, chatId }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu bo'lim faqat student uchun.");
      return;
    }

    const state = await getUserState(actor.id);
    const languageCode = getPreferredLanguageCode(state);
    const ui = getStudentDictionaryText(languageCode);
    const dictionaries = await listDictionariesForStudent(actor.id);

    await clearDictionarySession(actor.id);

    const parts = [ui.listTitle];
    parts.push(
      formatDictionaryList(dictionaries, {
        emptyText: ui.emptyList,
        countLabel: ui.countLabel,
      }),
    );

    if (dictionaries.length) {
      parts.push(ui.chooseSection);
    }

    await sendMessage(chatId, parts.join("\n\n"), {
      reply_markup: buildStudentDictionaryInlineKeyboard(dictionaries) || getRoleMenu(actor.role),
    });
  }

  async openStudentDictionary({ actor, chatId, dictionaryId }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu bo'lim faqat student uchun.");
      return;
    }

    const state = await getUserState(actor.id);
    const languageCode = getPreferredLanguageCode(state);
    const ui = getStudentDictionaryText(languageCode);
    const dictionary = await getDictionaryByIdForStudent(dictionaryId, actor.id);

    if (!dictionary) {
      await sendMessage(chatId, ui.unavailable, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    await clearDictionarySession(actor.id);
    const entries = await listDictionaryEntries(dictionary.id);

    if (!entries.length) {
      await sendMessage(chatId, ui.emptyDictionary, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const bodyLines = entries.map((entry, index) => `${index + 1}. ${entry.german_text} - ${entry.uzbek_text}`);
    const previewText = [
      `${ui.sectionLabel}: ${dictionary.title}`,
      `${ui.countLabel}: ${Number(dictionary.entry_count || 0)}`,
      "",
      ...bodyLines,
      "",
      ui.practiceHint,
    ].join("\n");
    const chunks = splitTextByLines(previewText, 3500);
    const previewMessageIds = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const isLast = index === chunks.length - 1;
      const sentMessage = await sendMessage(chatId, chunks[index], {
        reply_markup: isLast ? buildStudentDictionaryActionsKeyboard(dictionary.id, languageCode) : undefined,
      });

      if (sentMessage?.message_id) {
        previewMessageIds.push(sentMessage.message_id);
      }
    }

    await upsertDictionarySession({
      studentUserId: actor.id,
      dictionaryId: dictionary.id,
      state: "idle",
      currentEntryId: null,
      currentDirection: null,
      attemptsUsed: 0,
      previewMessageIds,
    });
  }

  buildDictionaryImportPrompt(actionText) {
    return [
      actionText,
      "Har qatorda 1 ta juftlik yuboring.",
      "Qabul qilinadigan formatlar: `Haus | uy`, `Haus - uy`, `Haus (uy)`",
      "",
      "Misol:",
      "Haus | uy",
      "Der Tisch - stol",
      "Die Sonne (quyosh)",
      "Baum | daraxt",
    ].join("\n");
  }

  buildDictionaryImportError(invalidLines) {
    const preview = invalidLines.slice(0, 6).map((line, index) => `${index + 1}. ${line}`).join("\n");
    const extra = invalidLines.length > 6 ? `\n... yana ${invalidLines.length - 6} ta qator` : "";

    return [
      "Lug'at saqlanmadi.",
      "Qabul qilinadigan asosiy formatlar:",
      "Haus | uy",
      "Der Tisch - stol",
      "Die Sonne (quyosh)",
      "Baum | daraxt",
      "",
      invalidLines.length ? `Noto'g'ri qatorlar:\n${preview}${extra}` : "Hech qanday yaroqli qator topilmadi.",
    ].join("\n");
  }

  async handleEmployeeDictionaryImport({ actor, chatId, mode, title = null, dictionaryId = null, text }) {
    let parsed = parseDictionaryText(text);
    let usedAi = false;

    const skipThreshold = 0.2;
    const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim()).length;
    const skippedCount = parsed.ignoredLines.length + parsed.invalidLines.length;

    if (hasOpenAi() && (parsed.entries.length < 2 || skippedCount / lines > skipThreshold)) {
      try {
        const aiEntries = await parseDictionaryTextWithAi(text);
        if (aiEntries.length > parsed.entries.length) {
          parsed = {
            entries: aiEntries,
            ignoredLines: [],
            invalidLines: [],
            totalLines: lines,
          };
          usedAi = true;
        }
      } catch (error) {
        console.error("AI dictionary parsing failed:", error);
      }
    }

    if (!parsed.entries.length) {
      await sendMessage(chatId, this.buildDictionaryImportError(parsed.invalidLines), {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    try {
      if (mode === "create") {
        const dictionary = await createDictionary({
          employeeUserId: actor.id,
          title,
          entries: parsed.entries,
        });
        const ignoredNote = parsed.ignoredLines.length ? ` ${parsed.ignoredLines.length} ta sarlavha yoki izoh qatori o'tkazib yuborildi.` : "";

        await clearPendingAction(actor.id);
        await this.openEmployeeDictionary({
          actor,
          chatId,
          dictionaryId: dictionary.id,
          extraText: `Bo'lim yaratildi. ${Number(dictionary.inserted_count || 0)} ta juftlik saqlandi.${ignoredNote}`,
        });
        await this.notifyStudentsAboutDictionaryUpdate({
          employeeUserId: actor.id,
          dictionaryTitle: dictionary.title,
          mode: "create",
          count: Number(dictionary.inserted_count || 0),
        });
        return;
      }

      const dictionary = await getDictionaryByIdForEmployee(dictionaryId, actor.id);

      if (!dictionary) {
        await clearPendingAction(actor.id);
        await sendMessage(chatId, "Lug'at bo'limi topilmadi yoki sizga tegishli emas.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      const updatedDictionary =
        mode === "append"
          ? await addDictionaryEntries({ dictionaryId: dictionary.id, entries: parsed.entries })
          : await replaceDictionaryEntries({ dictionaryId: dictionary.id, entries: parsed.entries });

      const ignoredNote = parsed.ignoredLines.length ? ` ${parsed.ignoredLines.length} ta sarlavha yoki izoh qatori o'tkazib yuborildi.` : "";
      const aiNote = usedAi ? " (Format AI yordamida aniqlandi ✨)" : "";

      await clearPendingAction(actor.id);
      await this.openEmployeeDictionary({
        actor,
        chatId,
        dictionaryId: updatedDictionary.id,
        extraText:
          mode === "append"
            ? `${Number(updatedDictionary.inserted_count || 0)} ta yangi juftlik qo'shildi.${ignoredNote}${aiNote}`
            : `Bo'lim to'liq yangilandi. ${Number(updatedDictionary.inserted_count || 0)} ta juftlik saqlandi.${ignoredNote}${aiNote}`,
      });
      if (mode !== "append" || Number(updatedDictionary.inserted_count || 0) > 0) {
        await this.notifyStudentsAboutDictionaryUpdate({
          employeeUserId: actor.id,
          dictionaryTitle: updatedDictionary.title,
          mode: mode === "append" ? "append" : "replace",
          count: Number(updatedDictionary.inserted_count || 0),
        });
      }
    } catch (error) {
      if (error?.code === "23505" && mode === "create") {
        await setPendingAction({
          userId: actor.id,
          pendingAction: "creating_dictionary_title",
        });
        await sendMessage(chatId, "Shu nomli bo'lim allaqachon bor. Boshqa nom yuboring.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      throw error;
    }
  }

  async getNextDictionaryQuestion(dictionaryId, excludeEntryId = null) {
    let entry = await getRandomDictionaryEntry({
      dictionaryId,
      excludeEntryId,
    });

    if (!entry && excludeEntryId) {
      entry = await getRandomDictionaryEntry({ dictionaryId });
    }

    if (!entry) {
      return null;
    }

    return {
      entry,
      direction: Math.random() < 0.5 ? "de_to_uz" : "uz_to_de",
    };
  }

  async sendDictionaryQuestion({ chatId, entry, direction, languageCode, introText = "", currentNumber = null, totalQuestions = null }) {
    const ui = getStudentDictionaryText(languageCode);
    const questionText = buildDictionaryQuestionText({
      entry,
      direction,
      languageCode,
      currentNumber,
      totalQuestions,
    });

    const messageText = introText ? `${introText}\n\n${ui.nextQuestion}\n${questionText}` : questionText;

    await sendMessage(chatId, messageText, {
      reply_markup: getRoleMenu("student"),
    });
  }

  async startDictionaryPractice({ actor, chatId, dictionaryId, questionLimit, sourceMessageId = null }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu bo'lim faqat student uchun.");
      return;
    }

    const [state, topicSession, dictionary, dictionarySession] = await Promise.all([
      getUserState(actor.id),
      getStudentSession(actor.id),
      getDictionaryByIdForStudent(dictionaryId, actor.id),
      getDictionarySession(actor.id),
    ]);
    const languageCode = getPreferredLanguageCode(state);
    const ui = getStudentDictionaryText(languageCode);

    if (topicSession?.state === "quiz_pending" || topicSession?.state === "quiz_active") {
      await sendMessage(chatId, ui.blockedByQuiz, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (!dictionary) {
      await sendMessage(chatId, ui.unavailable, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }
    const entries = await listDictionaryEntries(dictionary.id);

    if (!entries.length) {
      await sendMessage(chatId, ui.emptyDictionary, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const shuffledEntryIds = shuffleArray(entries.map((entry) => entry.id));
    const limitedIds = shuffledEntryIds.slice(0, Math.min(Number(questionLimit || 0), shuffledEntryIds.length));

    if (!limitedIds.length) {
      await sendMessage(chatId, ui.emptyDictionary, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const [currentEntryId, ...remainingEntryIds] = limitedIds;
    const currentEntry = entries.find((entry) => Number(entry.id) === Number(currentEntryId)) || null;

    if (!currentEntry) {
      await sendMessage(chatId, ui.unavailable, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const direction = Math.random() < 0.5 ? "de_to_uz" : "uz_to_de";
    const introText = limitedIds.length < Number(questionLimit || 0) ? ui.selectedCountAdjusted : "";

    await upsertDictionarySession({
      studentUserId: actor.id,
      dictionaryId: dictionary.id,
      state: "active",
      currentEntryId,
      currentDirection: direction,
      attemptsUsed: 0,
      remainingEntryIds,
      totalQuestions: limitedIds.length,
      answeredQuestions: 0,
      correctAnswers: 0,
      mistakes: [],
      activeAttemptStartedAt: new Date().toISOString(),
      previewMessageIds: [],
    });

    const previewMessageIds = Array.isArray(dictionarySession?.preview_message_ids)
      ? dictionarySession.preview_message_ids
      : [];
    const idsToDelete = previewMessageIds.length
      ? previewMessageIds
      : sourceMessageId
        ? [sourceMessageId]
        : [];

    for (const messageId of idsToDelete) {
      await deleteMessage(chatId, messageId).catch(() => null);
    }

    await this.sendDictionaryQuestion({
      chatId,
      entry: currentEntry,
      direction,
      languageCode,
      introText,
      currentNumber: 1,
      totalQuestions: limitedIds.length,
    });
  }

  async handleDictionaryAnswer({ actor, chatId, dictionarySession, studentAnswer, languageCode }) {
    const ui = getStudentDictionaryText(languageCode);
    const [dictionary, entry] = await Promise.all([
      getDictionaryByIdForStudent(dictionarySession.dictionary_id, actor.id),
      getDictionaryEntryById(dictionarySession.current_entry_id),
    ]);

    if (!dictionary || !entry || dictionarySession.state !== "active") {
      await clearDictionarySession(actor.id);
      await sendMessage(chatId, ui.unavailable, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const expectedAnswer = dictionarySession.current_direction === "de_to_uz" ? entry.uzbek_text : entry.german_text;
    const remainingEntryIds = Array.isArray(dictionarySession.remaining_entry_ids) ? dictionarySession.remaining_entry_ids : [];
    const totalQuestions = Number(dictionarySession.total_questions || 0);
    const answeredQuestions = Number(dictionarySession.answered_questions || 0);
    const correctAnswers = Number(dictionarySession.correct_answers || 0);
    const mistakes = Array.isArray(dictionarySession.mistakes) ? dictionarySession.mistakes : [];

    let isCorrect = matchDictionaryAnswer(expectedAnswer, studentAnswer);

    if (!isCorrect && hasOpenAi()) {
      const originalWord = dictionarySession.current_direction === "de_to_uz" ? entry.german_text : entry.uzbek_text;
      const aiResult = await gradeDictionaryAnswerWithAi({
        originalWord,
        expectedAnswer,
        studentAnswer,
        languageCode,
      });
      isCorrect = aiResult.correct;
    }

    if (isCorrect) {
      if (!remainingEntryIds.length) {
        await this.finishDictionaryPractice({
          actor,
          chatId,
          dictionary,
          dictionarySession,
          languageCode,
          introText: ui.correct,
          correctAnswers: correctAnswers + 1,
          mistakes,
        });
        return;
      }

      const [nextEntryId, ...nextRemainingEntryIds] = remainingEntryIds;
      const nextQuestion = await getDictionaryEntryById(nextEntryId);

      if (!nextQuestion) {
        await this.finishDictionaryPractice({
          actor,
          chatId,
          dictionary,
          dictionarySession,
          languageCode,
          introText: ui.correct,
          correctAnswers: correctAnswers + 1,
          mistakes,
        });
        return;
      }

      const nextDirection = Math.random() < 0.5 ? "de_to_uz" : "uz_to_de";

      await upsertDictionarySession({
        studentUserId: actor.id,
        dictionaryId: dictionary.id,
        state: "active",
        currentEntryId: nextQuestion.id,
        currentDirection: nextDirection,
        attemptsUsed: 0,
        remainingEntryIds: nextRemainingEntryIds,
        totalQuestions,
        answeredQuestions: answeredQuestions + 1,
        correctAnswers: correctAnswers + 1,
        mistakes,
        previewMessageIds: [],
      });

      await this.sendDictionaryQuestion({
        chatId,
        entry: nextQuestion,
        direction: nextDirection,
        languageCode,
        introText: ui.correct,
        currentNumber: answeredQuestions + 2,
        totalQuestions,
      });
      return;
    }

    const attemptsUsed = Number(dictionarySession.attempts_used || 0);

    if (attemptsUsed < 1) {
      await upsertDictionarySession({
        studentUserId: actor.id,
        dictionaryId: dictionary.id,
        state: "active",
        currentEntryId: entry.id,
        currentDirection: dictionarySession.current_direction,
        attemptsUsed: attemptsUsed + 1,
        remainingEntryIds,
        totalQuestions,
        answeredQuestions,
        correctAnswers,
        mistakes,
        previewMessageIds: [],
      });

      await sendMessage(chatId, ui.retry, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const nextMistakes = [...mistakes, buildDictionaryMistake(entry, dictionarySession.current_direction, studentAnswer)];
    const introText = `${ui.wrongAnswerLead}\n${ui.solutionLabel}: ${expectedAnswer}`;

    if (!remainingEntryIds.length) {
      await this.finishDictionaryPractice({
        actor,
        chatId,
        dictionary,
        dictionarySession,
        languageCode,
        introText,
        correctAnswers,
        mistakes: nextMistakes,
      });
      return;
    }

    const [nextEntryId, ...nextRemainingEntryIds] = remainingEntryIds;
    const nextQuestion = await getDictionaryEntryById(nextEntryId);

    if (!nextQuestion) {
      await this.finishDictionaryPractice({
        actor,
        chatId,
        dictionary,
        dictionarySession,
        languageCode,
        introText,
        correctAnswers,
        mistakes: nextMistakes,
      });
      return;
    }

    const nextDirection = Math.random() < 0.5 ? "de_to_uz" : "uz_to_de";

    await upsertDictionarySession({
      studentUserId: actor.id,
      dictionaryId: dictionary.id,
      state: "active",
      currentEntryId: nextQuestion.id,
      currentDirection: nextDirection,
      attemptsUsed: 0,
      remainingEntryIds: nextRemainingEntryIds,
      totalQuestions,
      answeredQuestions: answeredQuestions + 1,
      correctAnswers,
      mistakes: nextMistakes,
      previewMessageIds: [],
    });

    await this.sendDictionaryQuestion({
      chatId,
      entry: nextQuestion,
      direction: nextDirection,
      languageCode,
      introText,
      currentNumber: answeredQuestions + 2,
      totalQuestions,
    });
  }

  async getStudentTopicContext(actor) {
    const state = await getUserState(actor.id);
    const session = await getStudentSession(actor.id);
    const topicId = state?.active_topic_id || session?.topic_id;

    if (!topicId) {
      return {
        state,
        session,
        topic: null,
      };
    }

    const topic = await getTopicById(topicId);

    return {
      state,
      session,
      topic,
    };
  }

  async buildTopicAnswer({ topic, question, languageCode, teachingMode = "normal", sourceQuery = question }) {
    const chunks = await getKnowledgeChunks(topic.id);
    const answer = await answerTopicQuestion({
      topic,
      chunks,
      question,
      languageCode,
      teachingMode,
    });

    return withSourceSnippets({
      answer,
      question: sourceQuery,
      chunks,
      languageCode,
    });
  }

  async sendTopicSummary({ actor, chatId, languageCode }) {
    const { state, topic } = await this.getStudentTopicContext(actor);
    const resolvedLanguageCode = languageCode || getPreferredLanguageCode(state);

    if (!topic) {
      await sendMessage(chatId, "Avval mavzuni tanlang. Mavzularim tugmasini bosing.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const summaryPrompt = getLanguageMeta(resolvedLanguageCode).summaryPrompt;

    try {
      await sendChatAction(chatId, "typing").catch(() => null);
      const answer = await this.buildTopicAnswer({
        topic,
        question: summaryPrompt,
        languageCode: resolvedLanguageCode,
        teachingMode: "summary",
        sourceQuery: `${topic.title} ${topic.description || ""}`.trim(),
      });

      await sendMessage(chatId, answer, {
        reply_markup: buildStudentQuickActionsKeyboard(),
      });
    } catch (error) {
      console.error("Topic summary failed:", error);
      await sendMessage(chatId, "Qisqacha tushuntirishda xatolik bo'ldi.", {
        reply_markup: getRoleMenu(actor.role),
      });
    }
  }

  async reexplainLastStudentQuestion({ actor, chatId, languageCode, teachingMode = "normal" }) {
    const { session, topic } = await this.getStudentTopicContext(actor);

    if (!topic || !session?.last_user_message) {
      await sendMessage(chatId, "Avval savol bering, keyin uni boshqa tilda qayta tushuntiraman.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    try {
      await sendChatAction(chatId, "typing").catch(() => null);
      const answer = await this.buildTopicAnswer({
        topic,
        question: session.last_user_message,
        languageCode,
        teachingMode,
        sourceQuery: session.last_user_message,
      });

      await sendMessage(chatId, answer, {
        reply_markup: buildStudentQuickActionsKeyboard(),
      });
    } catch (error) {
      console.error("Reexplain failed:", error);
      await sendMessage(chatId, "Qayta tushuntirishda xatolik bo'ldi.", {
        reply_markup: getRoleMenu(actor.role),
      });
    }
  }

  async showStudentMistakes({ actor, chatId }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu bo'lim faqat student uchun.");
      return;
    }

    const { state, topic } = await this.getStudentTopicContext(actor);
    const languageCode = getPreferredLanguageCode(state);
    const mistakes = await listStudentMistakes({
      studentUserId: actor.id,
      topicId: topic?.id || null,
      limit: config.studentMistakeLimit,
    });

    await sendMessage(chatId, formatMistakeSummary(mistakes, languageCode), {
      reply_markup: buildMistakeActionsKeyboard({
        canRetry: Boolean(topic && mistakes.length),
        canStartQuiz: Boolean(topic),
      }),
    });
  }

  async startMistakePractice({ actor, chatId }) {
    if (actor.role !== "student") {
      await sendMessage(chatId, "Bu bo'lim faqat student uchun.");
      return;
    }

    const { session, topic } = await this.getStudentTopicContext(actor);

    if (!topic) {
      await sendMessage(chatId, "Avval mavzuni tanlang. Mavzularim tugmasini bosing.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const mistakes = await listStudentMistakes({
      studentUserId: actor.id,
      topicId: topic.id,
      limit: config.quizQuestionCount,
    });

    if (!mistakes.length) {
      await sendMessage(chatId, "Bu mavzu bo'yicha qayta mashq qiladigan xatolar topilmadi.", {
        reply_markup: buildStudentQuickActionsKeyboard(),
      });
      return;
    }

    await this.startQuiz({
      actor,
      chatId,
      topic,
      session,
      questionsOverride: mistakes.map((item) => ({
        question: item.question_text,
        answer: item.expected_answer || "",
      })),
      introText: "Oldingi xatolar bo'yicha qayta mashq boshlandi.",
    });
  }

  async startQuizFromActiveTopic({ actor, chatId }) {
    const { session, topic } = await this.getStudentTopicContext(actor);

    if (!topic) {
      await sendMessage(chatId, "Avval mavzuni tanlang. Mavzularim tugmasini bosing.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (session?.state === "quiz_active" && session.active_quiz_attempt_id) {
      const currentQuestion = await getNextUnansweredQuestion(session.active_quiz_attempt_id);

      if (currentQuestion) {
        const attempt = await getAttemptById(session.active_quiz_attempt_id);
        await sendMessage(chatId, buildQuizQuestionMessage(currentQuestion, attempt.total_questions), {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }
    }

    await clearDictionarySession(actor.id);
    await this.startQuiz({
      actor,
      chatId,
      topic,
      session,
    });
  }

  async handleEmployeeTextMessage({ actor, chatId, message }) {
    const state = await getUserState(actor.id);
    const text = cleanText(message.text);
    const normalizedText = normalizeText(message.text);

    if (!text) {
      await sendMessage(chatId, "Text bo'sh ko'rinyapti.");
      return;
    }

    if (normalizedText === "yordam") {
      await this.sendRoleMenu({ actor, chatId });
      return;
    }

    if (normalizedText === "bekor qilish") {
      await clearPendingAction(actor.id);
      await sendMessage(chatId, "Action bekor qilindi.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (normalizedText === "lug'atlar" || normalizedText === "lugatlar") {
      await this.showEmployeeDictionaries({ actor, chatId });
      return;
    }

    if (normalizedText === "natijalar") {
      await this.showEmployeeResults({ actor, chatId });
      return;
    }

    if (normalizedText === "kuchsiz studentlar") {
      await this.showWeakStudents({ actor, chatId });
      return;
    }

    if (state?.pending_action === "creating_topic_title") {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "creating_topic_description",
        pendingTitle: message.text.trim(),
      });
      await sendMessage(chatId, "2/2 Izoh yuboring. Kerak bo'lmasa `-` deb yozing.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (state?.pending_action === "creating_topic_description") {
      const description = text === "-" ? null : message.text.trim();
      const topic = await createTopic({
        employeeUserId: actor.id,
        title: state.pending_title,
        description,
      });

      await clearPendingAction(actor.id);
      await setActiveTopic(actor.id, topic.id);
      await sendMessage(
        chatId,
        `Mavzu yaratildi va aktiv qilindi: #${topic.id} - ${topic.title}\nEndi text yoki video'ni oddiy yuboravering.`,
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (state?.pending_action === "creating_dictionary_title") {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "creating_dictionary_entries",
        pendingTitle: message.text.trim(),
      });
      await sendMessage(
        chatId,
        this.buildDictionaryImportPrompt(`2/2 "${message.text.trim()}" bo'limi uchun juftliklarni yuboring.`),
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (state?.pending_action === "creating_dictionary_entries" && state.pending_title) {
      await this.handleEmployeeDictionaryImport({
        actor,
        chatId,
        mode: "create",
        title: state.pending_title,
        text: message.text,
      });
      return;
    }

    if (state?.pending_action === "adding_dictionary_entries" && state.pending_payload?.dictionaryId) {
      await this.handleEmployeeDictionaryImport({
        actor,
        chatId,
        mode: "append",
        dictionaryId: Number(state.pending_payload.dictionaryId),
        text: message.text,
      });
      return;
    }

    if (state?.pending_action === "replacing_dictionary_entries" && state.pending_payload?.dictionaryId) {
      await this.handleEmployeeDictionaryImport({
        actor,
        chatId,
        mode: "replace",
        dictionaryId: Number(state.pending_payload.dictionaryId),
        text: message.text,
      });
      return;
    }

    if (state?.pending_action === "adding_student") {
      const [telegramIdRaw, fullName] = parsePipeArgs(message.text);
      const telegramUserId = parseId(telegramIdRaw);

      if (!telegramUserId || !fullName) {
        await sendMessage(chatId, "Format: telegram_id | ism", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      const student = await createManagedUser({
        telegramUserId,
        fullName,
        username: null,
        role: "student",
        createdByUserId: actor.id,
      });

      await clearPendingAction(actor.id);
      await sendMessage(chatId, `Student qo'shildi: ${student.full_name} (${student.telegram_user_id})`, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (state?.pending_action === "assigning_student_to_active_topic" && state.pending_topic_id) {
      const studentTelegramId = parseId(text);

      if (!studentTelegramId) {
        await sendMessage(chatId, "Faqat student telegram ID sini yuboring.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      const topic = await getTopicByIdForEmployee(state.pending_topic_id, actor.id);
      const student = await findByTelegramUserId(studentTelegramId);

      if (!topic) {
        await clearPendingAction(actor.id);
        await sendMessage(chatId, "Aktiv topic topilmadi. Qaytadan urinib ko'ring.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      if (!student || student.role !== "student") {
        await sendMessage(chatId, "Bunday student topilmadi.", {
          reply_markup: getRoleMenu(actor.role),
        });
        return;
      }

      await assignTopicToStudent({
        studentUserId: student.id,
        topicId: topic.id,
        assignedByUserId: actor.id,
      });

      await clearPendingAction(actor.id);
      await sendMessage(chatId, `${student.full_name} ga #${topic.id} mavzu biriktirildi.`, {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    if (normalizedText === "newtopic" || normalizedText === "/newtopic") {
      await setPendingAction({
        userId: actor.id,
        pendingAction: "creating_topic_title",
      });
      await sendMessage(chatId, "1/2 Mavzu nomini yuboring.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    let topicId = null;
    let title = null;

    if (state?.pending_action === "awaiting_text" && state.pending_topic_id) {
      topicId = state.pending_topic_id;
      title = state.pending_title || null;
    } else if (state?.active_topic_id) {
      const activeTopic = await getTopicByIdForEmployee(state.active_topic_id, actor.id);

      if (activeTopic) {
        topicId = activeTopic.id;
        title = `Text ${new Date().toISOString()}`;
      }
    }

    if (!topicId) {
      await sendMessage(
        chatId,
        "Avval mavzu yarating yoki tanlang.\nTugmalar: `Mavzu yaratish` yoki `Mavzularim`",
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    const chunks = chunkText(text);

    await saveTextMaterial({
      topicId,
      uploadedByUserId: actor.id,
      title,
      rawText: message.text,
      processedText: text,
      chunks,
    });

    if (state?.pending_action === "awaiting_text") {
      await clearPendingAction(actor.id);
      if (state.active_topic_id) {
        await setActiveTopic(actor.id, state.active_topic_id);
      }
    }
    await sendMessage(
      chatId,
      `Text material saqlandi. ${chunks.length} ta knowledge chunk yaratildi.`,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async handleStudentTextMessage({ actor, chatId, message }) {
    const state = await getUserState(actor.id);
    const session = await getStudentSession(actor.id);
    const dictionarySession = await getDictionarySession(actor.id);
    const normalizedText = normalizeText(message.text);
    const activeTopicId = state?.active_topic_id || session?.topic_id;
    const languageCode = getPreferredLanguageCode(state);

    if (normalizedText === "yordam") {
      await clearDictionarySession(actor.id);
      await this.sendRoleMenu({ actor, chatId });
      return;
    }

    if (normalizedText === "lug'atlar" || normalizedText === "lugatlar") {
      await this.showStudentDictionaries({ actor, chatId });
      return;
    }

    if (normalizedText === "xatolarim") {
      await clearDictionarySession(actor.id);
      await this.showStudentMistakes({ actor, chatId });
      return;
    }

    if (normalizedText === "test boshlash") {
      await clearDictionarySession(actor.id);
      await this.startQuizFromActiveTopic({ actor, chatId });
      return;
    }

    if (dictionarySession?.state === "active" && dictionarySession.current_entry_id) {
      await this.handleDictionaryAnswer({
        actor,
        chatId,
        dictionarySession,
        studentAnswer: message.text,
        languageCode,
      });
      return;
    }

    const explicitLanguageChoice = parseLanguageChoice(message.text);

    if (explicitLanguageChoice) {
      await setPreferredLanguage(actor.id, explicitLanguageChoice);
      await sendMessage(
        chatId,
        `Tushuntirish tili saqlandi: ${getLanguageMeta(explicitLanguageChoice).label}`,
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      return;
    }

    if (!activeTopicId) {
      await sendMessage(chatId, "Avval Mavzularim tugmasini bosing va mavzuni tanlang.", {
        reply_markup: getRoleMenu(actor.role),
      });
      return;
    }

    const topic = await getTopicById(activeTopicId);

    if (!topic) {
      await sendMessage(chatId, "Active topic topilmadi.");
      return;
    }

    if (session?.state === "quiz_pending") {
      if (!isAffirmative(message.text)) {
        await upsertStudentSession({
          studentUserId: actor.id,
          topicId: activeTopicId,
          state: "asking",
          activeQuizAttemptId: null,
          questionCount: session.question_count || 0,
          lastUserMessage: message.text,
        });

        await sendMessage(chatId, "Mayli, unda savollar berishda davom eting.");
        return;
      }

      await this.startQuiz({ actor, chatId, topic, session });
      return;
    }

    if (session?.state === "quiz_active" && session.active_quiz_attempt_id) {
      await this.handleQuizAnswer({
        actor,
        chatId,
        topic,
        session,
        studentAnswer: message.text,
      });
      return;
    }

    if (isQuizRequest(message.text)) {
      await upsertStudentSession({
        studentUserId: actor.id,
        topicId: activeTopicId,
        state: "quiz_pending",
        activeQuizAttemptId: null,
        questionCount: session?.question_count || 0,
        lastUserMessage: message.text,
      });

      await sendMessage(chatId, "5 ta test savolini boshlaymi? Agar ha bo'lsa, 'ha' deb yozing.");
      return;
    }

    const chunks = await getKnowledgeChunks(activeTopicId);
    let answer;

    try {
      await sendChatAction(chatId, "typing").catch(() => null);
      answer = withSourceSnippets({
        answer: await answerTopicQuestion({
          topic,
          chunks,
          question: message.text,
          languageCode,
        }),
        question: message.text,
        chunks,
        languageCode,
      });
    } catch (error) {
      console.error("Topic answer failed:", error);
      await sendMessage(chatId, "AI javobini olishda xatolik bo'ldi. Bir ozdan keyin qayta urinib ko'ring.");
      return;
    }

    const nextCount = (session?.question_count || 0) + 1;

    await upsertStudentSession({
      studentUserId: actor.id,
      topicId: activeTopicId,
      state: "asking",
      activeQuizAttemptId: null,
      questionCount: nextCount,
      lastUserMessage: message.text,
    });

    await sendMessage(
      chatId,
      answer,
      {
        reply_markup: buildStudentQuickActionsKeyboard(),
      },
    );
  }

  async startQuiz({ actor, chatId, topic, session, questionsOverride = null, introText = "" }) {
    const state = await getUserState(actor.id);
    const languageCode = getPreferredLanguageCode(state);
    let questions;

    if (Array.isArray(questionsOverride) && questionsOverride.length) {
      questions = questionsOverride.slice(0, config.quizQuestionCount);
    } else {
      const chunks = await getKnowledgeChunks(topic.id);

      try {
        await sendChatAction(chatId, "typing").catch(() => null);
        questions = await generateQuiz({
          topic,
          chunks,
          count: config.quizQuestionCount,
          languageCode,
        });
      } catch (error) {
        console.error("Quiz generation failed:", error);
        await sendMessage(chatId, "Quiz yaratishda xatolik bo'ldi. Keyinroq yana urinib ko'ring.");
        return;
      }
    }

    if (!questions.length) {
      await sendMessage(
        chatId,
        "Quiz yaratish uchun yetarli text material topilmadi. Employee avval transcript yoki text yuklasin.",
      );
      return;
    }

    const attempt = await createQuizAttempt({
      studentUserId: actor.id,
      topicId: topic.id,
      employeeUserId: topic.employee_user_id,
      questions,
    });

    await upsertStudentSession({
      studentUserId: actor.id,
      topicId: topic.id,
      state: "quiz_active",
      activeQuizAttemptId: attempt.id,
      questionCount: session?.question_count || 0,
      lastUserMessage: null,
    });

    const firstQuestion = await getNextUnansweredQuestion(attempt.id);
    await sendMessage(
      chatId,
      `${introText ? `${introText}\n\n` : ""}Quiz boshlandi. 1/${attempt.total_questions}\n\n${buildQuizQuestionMessage(firstQuestion, attempt.total_questions)}`,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async handleQuizAnswer({ actor, chatId, topic, session, studentAnswer }) {
    const attempt = await getAttemptById(session.active_quiz_attempt_id);
    const state = await getUserState(actor.id);
    const languageCode = getPreferredLanguageCode(state);

    if (!attempt) {
      await upsertStudentSession({
        studentUserId: actor.id,
        topicId: topic.id,
        state: "asking",
        activeQuizAttemptId: null,
        questionCount: session.question_count || 0,
        lastUserMessage: studentAnswer,
      });
      await sendMessage(chatId, "Active quiz topilmadi. Qaytadan 'savollarim tugadi' deb yozing.");
      return;
    }

    const currentQuestion = await getNextUnansweredQuestion(attempt.id);

    if (!currentQuestion) {
      await this.finishQuiz({ actor, chatId, attemptId: attempt.id, topicId: topic.id, questionCount: session.question_count || 0 });
      return;
    }

    const uncertainAnswer = isUncertainAnswer(studentAnswer);
    let grade;
    let recoveryText = "";

    if (uncertainAnswer) {
      grade = {
        correct: false,
        feedback: getLanguageMeta(languageCode).uncertainFeedback,
      };

      try {
        await sendChatAction(chatId, "typing").catch(() => null);
        const chunks = await getKnowledgeChunks(topic.id);
        recoveryText = await generateQuizRecovery({
          topic,
          chunks,
          question: currentQuestion.question_text,
          expectedAnswer: currentQuestion.expected_answer,
          languageCode,
        });
      } catch (error) {
        console.error("Quiz recovery generation failed:", error);
        recoveryText = `${getLanguageMeta(languageCode).correctAnswerLabel}: ${currentQuestion.expected_answer}`;
      }
    } else {
      try {
        grade = await gradeQuizAnswer({
          topicTitle: topic.title,
          question: currentQuestion.question_text,
          expectedAnswer: currentQuestion.expected_answer,
          studentAnswer,
          languageCode,
        });
      } catch (error) {
        console.error("Quiz grading failed:", error);
        await sendMessage(chatId, "Javobni tekshirishda xatolik bo'ldi. Iltimos, shu javobni yana yuboring.");
        return;
      }
    }

    await saveQuestionAnswer({
      questionId: currentQuestion.id,
      studentAnswer,
      isCorrect: grade.correct,
      feedbackText: [grade.feedback, recoveryText].filter(Boolean).join("\n\n"),
    });

    if (currentQuestion.question_order >= attempt.total_questions) {
      await sendMessage(
        chatId,
        `${currentQuestion.question_order}/${attempt.total_questions} qabul qilindi.\n${grade.feedback}${recoveryText ? `\n\n${recoveryText}` : ""}`,
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      await this.finishQuiz({ actor, chatId, attemptId: attempt.id, topicId: topic.id, questionCount: session.question_count || 0 });
      return;
    }

    const nextQuestion = await getNextUnansweredQuestion(attempt.id);

    if (!nextQuestion) {
      await sendMessage(
        chatId,
        `${currentQuestion.question_order}/${attempt.total_questions} qabul qilindi.\n${grade.feedback}${recoveryText ? `\n\n${recoveryText}` : ""}`,
        {
          reply_markup: getRoleMenu(actor.role),
        },
      );
      await this.finishQuiz({ actor, chatId, attemptId: attempt.id, topicId: topic.id, questionCount: session.question_count || 0 });
      return;
    }

    await sendMessage(
      chatId,
      `${currentQuestion.question_order}/${attempt.total_questions} qabul qilindi.\n${grade.feedback}${recoveryText ? `\n\n${recoveryText}` : ""}\n\nKeyingi savol:\n${buildQuizQuestionMessage(nextQuestion, attempt.total_questions)}`,
      {
        reply_markup: getRoleMenu(actor.role),
      },
    );
  }

  async finishQuiz({ actor, chatId, attemptId, topicId, questionCount }) {
    const finalized = await finalizeAttempt(attemptId);
    const summary = await getAttemptSummary(attemptId);

    await upsertStudentSession({
      studentUserId: actor.id,
      topicId,
      state: "asking",
      activeQuizAttemptId: null,
      questionCount,
      lastUserMessage: null,
    });

    if (!summary.attempt) {
      await sendMessage(chatId, "Quiz tugadi, lekin summary topilmadi.");
      return;
    }

    await sendMessage(
      chatId,
      `Test yakunlandi. Natija: ${finalized.correct_answers} / ${finalized.total_questions} to'g'ri.\nXohlasangiz Xatolarim tugmasi orqali xatolarni ko'rib, qayta mashq qilishingiz mumkin.`,
      {
        reply_markup: buildStudentQuickActionsKeyboard(),
      },
    );

    const mistakes = summary.questions
      .filter((item) => item.is_correct === false)
      .map((item) => `${item.question_order}. ${item.question_text}\nJavob: ${item.student_answer || "-"}`)
      .join("\n\n");

    const reportText = [
      "Student test natijasi",
      `Student: ${summary.attempt.student_full_name}`,
      `Mavzu: ${summary.attempt.topic_title}`,
      `Natija: ${summary.attempt.correct_answers} / ${summary.attempt.total_questions}`,
      summary.attempt.finished_at ? `Tugagan vaqti: ${new Date(summary.attempt.finished_at).toISOString()}` : "",
      mistakes ? `Xato javoblar:\n${mistakes}` : "Barcha javoblar to'g'ri.",
    ]
      .filter(Boolean)
      .join("\n");

    const staff = await listStaffMembers();
    let sentCount = 0;

    for (const member of staff) {
      if (member.telegram_user_id) {
        try {
          await sendMessage(member.telegram_user_id, reportText);
          sentCount++;
        } catch (error) {
          console.error(`Employee quiz report notification failed for ${member.full_name}:`, error);
        }
      }
    }

    if (sentCount > 0) {
      await markReportSent(attemptId);
    } else {
      await sendMessage(
        chatId,
        "Natija saqlandi, lekin employee larga yuborib bo'lmadi. Employee lar botni avval start qilgan bo'lishi kerak.",
      );
    }
  }
}

module.exports = {
  UstozBot,
};
