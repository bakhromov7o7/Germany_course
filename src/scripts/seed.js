const fs = require("fs/promises");
const path = require("path");
const { pool } = require("../db");
const { ensureDefaultUsers } = require("../repositories/users");
const { listTopicsByEmployee, createTopic } = require("../repositories/topics");
const { saveTextMaterial } = require("../repositories/materials");
const { listAllDictionaries, createDictionary } = require("../repositories/dictionaries");
const { chunkText } = require("../utils/chunking");

async function bootstrapDatabase() {
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);

  const { teacher } = await ensureDefaultUsers();

  const existingTopics = await listTopicsByEmployee(teacher.id);
  const hasA11 = existingTopics.some((t) => t.title && t.title.includes("Begrüßung"));
  if (!hasA11) {
    const topic1 = await createTopic({
      employeeUserId: teacher.id,
      title: "A1.1 — Salomlashish va Tanishuv (Begrüßung)",
      description: "Nemis tilida salomlashish, xayrlashish va o'zini tanishtirish iboralari.",
      status: "active",
    });

    const content1 = [
      "Nemis tilida salomlashish (Begrüßung) rasmiy va norasmiy holatlarga bo'linadi.",
      "1. Rasmiy salomlashish: Guten Morgen! (Xayrli tong - soat 11:00 gacha), Guten Tag! (Xayrli kun - 11:00 dan 18:00 gacha), Guten Abend! (Xayrli kech - 18:00 dan keyin).",
      "2. Norasmiy salomlashish (do'stlar orasida): Hallo! (Salom), Hi! (Salom), Servus! (Janubiy Germaniya va Avstriyada).",
      "3. O'zini tanishtirish: Ich heiße Sardor (Mening ismim Sardor). Mein Name ist Sardor (Mening ismim Sardor). Ich bin 22 Jahre alt (Men 22 yoshdaman). Ich komme aus Usbekistan (Men O'zbekistondanman).",
      "4. Hol-ahvol so'rash: Wie geht es Ihnen? (Rasmiy: Ishlaringiz qalay?) — Danke, gut. Und Ihnen? | Wie geht es dir? (Norasmiy: Qalaysan?) — Super, danke! Und dir?",
      "5. Xayrlashish: Auf Wiedersehen! (Rasmiy: Ko'rishguncha xayr), Tschüss! (Norasmiy: Xayr), Bis bald! (Tez orada ko'rishguncha), Gute Nacht! (Xayrli tun - uxlashdan oldin).",
    ].join("\n\n");

    await saveTextMaterial({
      topicId: topic1.id,
      uploadedByUserId: teacher.id,
      title: "Salomlashish va Tanishuv qoidalari",
      rawText: content1,
      processedText: content1,
      chunks: chunkText(content1),
    });

    const topic2 = await createTopic({
      employeeUserId: teacher.id,
      title: "A1.2 — Shaxs olmoshlari va 'sein' fe'li (Personalpronomen)",
      description: "Nemis tilida kishilik olmoshlari hamda 'bo'lmoq' (sein) va 'ega bo'lmoq' (haben) fe'llarining tuslanishi.",
      status: "active",
    });

    const content2 = [
      "Nemis tilida kishilik olmoshlari (Personalpronomen) va 'sein' (bo'lmoq) fe'lining hozirgi zamonda (Präsens) tuslanishi:",
      "ich bin — men ...man (masalan: Ich bin Student — Men talabaman).",
      "du bist — sen ...san (masalan: Du bist klug — Sen aqllisan).",
      "er / sie / es ist — u ...dir (masalan: Er ist Lehrer — U o'qituvchi, Sie ist Ärztin — U shifokor).",
      "wir sind — biz ...miz (masalan: Wir sind Freunde — Biz do'stmiz).",
      "ihr seid — sizlar ...sizlar (masalan: Ihr seid fleißig — Sizlar tirishqoqsizlar).",
      "sie / Sie sind — ular / Siz (hurmat) ...siz (masalan: Sie sind sehr nett — Siz juda muloyimsiz).",
      "'haben' (ega bo'lmoq / bor bo'lmoq) fe'li tuslanishi: ich habe, du hast, er/sie/es hat, wir haben, ihr habt, sie/Sie haben. Misol: Ich habe ein Buch (Menda kitob bor).",
    ].join("\n\n");

    await saveTextMaterial({
      topicId: topic2.id,
      uploadedByUserId: teacher.id,
      title: "Sein va Haben fe'llari",
      rawText: content2,
      processedText: content2,
      chunks: chunkText(content2),
    });
  }

  const existingDicts = await listAllDictionaries();
  if (existingDicts.length === 0) {
    await createDictionary({
      employeeUserId: teacher.id,
      title: "A1 — Kundalik Asosiy So'zlar",
      entries: [
        { german: "der Tisch", uzbek: "stol" },
        { german: "das Buch", uzbek: "kitob" },
        { german: "die Schule", uzbek: "maktab" },
        { german: "der Lehrer", uzbek: "o'qituvchi" },
        { german: "das Haus", uzbek: "uy" },
        { german: "das Wasser", uzbek: "suv" },
        { german: "das Brot", uzbek: "non" },
        { german: "der Freund", uzbek: "do'st" },
        { german: "lernen", uzbek: "o'rganmoq" },
        { german: "sprechen", uzbek: "gapirmoq" },
        { german: "verstehen", uzbek: "tushunmoq" },
        { german: "kaufen", uzbek: "sotib olmoq" },
      ],
    });
  }

  // Ensure rich sample quiz attempts exist for Teacher Analytics Dashboard
  const finishedAttemptsRes = await pool.query(
    "select count(*) as cnt from quiz_attempts where finished_at is not null",
  );
  const finishedCount = Number(finishedAttemptsRes.rows[0]?.cnt || 0);

  if (finishedCount < 4) {
    const topicsRes = await pool.query("select id, employee_user_id from topics order by id asc limit 4");
    const studentsRes = await pool.query("select id from users where role = 'student' order by id asc limit 6");

    if (topicsRes.rows.length > 0 && studentsRes.rows.length > 0) {
      const sampleQuizzes = [
        {
          studentIdx: 0,
          topicIdx: 0,
          questions: [
            {
              q: "Nemis tilida 'Xayrli tong' qanday aytiladi?",
              exp: "Guten Morgen",
              ans: "Guten Morgen",
              ok: true,
              fb: "Juda to'g'ri! Ertalabki salomlashish.",
            },
            {
              q: "'Men O'zbekistondanman' gapini nemischaga tarjima qiling.",
              exp: "Ich komme aus Usbekistan",
              ans: "Ich komme aus Usbekistan",
              ok: true,
              fb: "Ajoyib! Grammatik jihatdan to'liq to'g'ri.",
            },
            {
              q: "Rasmiy xayrlashish iborasi qaysi?",
              exp: "Auf Wiedersehen",
              ans: "Tschüss",
              ok: false,
              fb: "'Tschüss' norasmiy xayrlashish, rasmiy holatda 'Auf Wiedersehen' ishlatiladi.",
            },
            {
              q: "'Mening ismim Sardor' nemischada qanday bo'ladi?",
              exp: "Ich heiße Sardor",
              ans: "Ich heiße Sardor",
              ok: true,
              fb: "To'g'ri javob!",
            },
            {
              q: "'Wie geht es Ihnen?' qanday ma'noni bildiradi?",
              exp: "Ishlaringiz qalay? (Rasmiy)",
              ans: "Ishlaringiz qalay",
              ok: true,
              fb: "To'g'ri!",
            },
          ],
        },
        {
          studentIdx: 1,
          topicIdx: 0,
          questions: [
            {
              q: "'sein' fe'li 'ich' (men) olmoshi bilan qanday tuslanadi?",
              exp: "ich bin",
              ans: "ich ist",
              ok: false,
              fb: "Xato: 'ich' bilan 'bin' ishlatiladi ('ich bin'). 'ist' esa er/sie/es uchun.",
            },
            {
              q: "'du' (sen) olmoshi bilan 'haben' fe'li qanday bo'ladi?",
              exp: "du hast",
              ans: "du haben",
              ok: false,
              fb: "Xato: 'du hast' bo'lishi kerak ('b' harfi tushib qoladi).",
            },
            {
              q: "'Biz do'stmiz' gapini nemischada yozing.",
              exp: "Wir sind Freunde",
              ans: "Wir sind Freunde",
              ok: true,
              fb: "To'g'ri!",
            },
            {
              q: "'Ular' (sie) bilan 'sein' fe'li qanday tuslanadi?",
              exp: "sie sind",
              ans: "sie ist",
              ok: false,
              fb: "Ko'plikdagi 'sie' (ular) bilan 'sind' ishlatiladi.",
            },
            {
              q: "'Menda kitob bor' — nemischaga tarjima qiling.",
              exp: "Ich habe ein Buch",
              ans: "Ich habe ein Buch",
              ok: true,
              fb: "Barakalla!",
            },
          ],
        },
        {
          studentIdx: 2,
          topicIdx: Math.min(1, topicsRes.rows.length - 1),
          questions: [
            {
              q: "'Kitob' so'zining artikli qaysi?",
              exp: "das Buch",
              ans: "der Buch",
              ok: false,
              fb: "Buch so'zi Neutrum (o'rta rod) hisoblanadi: 'das Buch'.",
            },
            {
              q: "'Maktab' nemischada qanday aytiladi?",
              exp: "die Schule",
              ans: "die Schule",
              ok: true,
              fb: "To'g'ri!",
            },
            {
              q: "'lernen' fe'lining ma'nosi nima?",
              exp: "o'rganmoq",
              ans: "o'rganmoq",
              ok: true,
              fb: "To'g'ri!",
            },
            {
              q: "'sprechen' fe'li 'er' olmoshi bilan qanday tuslanadi?",
              exp: "er spricht",
              ans: "er sprecht",
              ok: false,
              fb: "Kuchli fe'l bo'lgani uchun 'e' harfi 'i' ga o'zgaradi: 'er spricht'.",
            },
            {
              q: "'Guten Abend' qachon ishlatiladi?",
              exp: "Kechqurun (Xayrli kech)",
              ans: "Kechqurun",
              ok: true,
              fb: "To'g'ri!",
            },
          ],
        },
        {
          studentIdx: Math.min(3, studentsRes.rows.length - 1),
          topicIdx: Math.min(2, topicsRes.rows.length - 1),
          questions: [
            {
              q: "'Stol' nemischada artikli bilan qanday yoziladi?",
              exp: "der Tisch",
              ans: "der Tisch",
              ok: true,
              fb: "To'g'ri!",
            },
            {
              q: "'Suv' nemischada qanday bo'ladi?",
              exp: "das Wasser",
              ans: "das Wasser",
              ok: true,
              fb: "To'g'ri!",
            },
            {
              q: "'sotib olmoq' fe'li nemischada nima?",
              exp: "kaufen",
              ans: "kaufen",
              ok: true,
              fb: "Ajoyib!",
            },
            {
              q: "'tushunmoq' nemischada qanday aytiladi?",
              exp: "verstehen",
              ans: "verstehen",
              ok: true,
              fb: "Barakalla!",
            },
            {
              q: "'Uy' so'zining nemischa tarjimasi?",
              exp: "das Haus",
              ans: "das Haus",
              ok: true,
              fb: "100% to'g'ri!",
            },
          ],
        },
      ];

      for (const sample of sampleQuizzes) {
        const st = studentsRes.rows[sample.studentIdx % studentsRes.rows.length];
        const tp = topicsRes.rows[sample.topicIdx % topicsRes.rows.length];
        const correctCnt = sample.questions.filter((x) => x.ok).length;

        const attRes = await pool.query(
          `
            insert into quiz_attempts (
              student_user_id,
              topic_id,
              employee_user_id,
              total_questions,
              correct_answers,
              started_at,
              finished_at
            )
            values ($1, $2, $3, $4, $5, now() - interval '2 hours', now() - interval '1 hour')
            returning id
          `,
          [st.id, tp.id, tp.employee_user_id || teacher.id, sample.questions.length, correctCnt],
        );

        const attId = attRes.rows[0].id;
        for (let i = 0; i < sample.questions.length; i++) {
          const item = sample.questions[i];
          await pool.query(
            `
              insert into quiz_questions (
                quiz_attempt_id,
                question_order,
                question_text,
                expected_answer,
                student_answer,
                is_correct,
                feedback_text,
                checked_at
              )
              values ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 hour')
            `,
            [attId, i + 1, item.q, item.exp, item.ans, item.ok, item.fb],
          );
        }
      }
    }
  }
}

module.exports = { bootstrapDatabase };
