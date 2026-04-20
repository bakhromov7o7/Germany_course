# Ustoz AI Bot — Tugatish Rejasi (2026-04-17)

> Bu fayl botni to'liq (production-ready) qilish uchun ketma-ket bajarilishi kerak bo'lgan tahlil va reja.
> Har bir task bajarilganidan keyin `[x]` qilib belgilanadi.

---

## Proyekt Holati (Tahlil)

Proyekt MVP darajasida tayyor. Asosiy flow ishlaydi:
- superadmin → employee → student role tizimi
- mavzu yaratish, text/video yuklash, knowledge chunks
- AI savol-javob (Groq/OpenAI compatible)
- quiz (5 ta savol), xatolar bo'yicha mashq
- lug'at tizimi (CRUD + practice)
- 2 til: O'zbekcha, Deutsch
- video transcription (Whisper)

---

## Yetishmayotgan narsalar va ketma-ket bajarish tartibi

### Phase 1: Kritik Tuzatishlar

- [x] **1.1** `.env` da `SUPERADMIN_TELEGRAM_ID=0` qilish (hozir `-1`, hech kim superadmin bo'la olmaydi)
- [x] **1.2** `.gitignore` ga `.env` qo'shish (tokenlar ochiq qolishi xavfli)
- [x] **1.3** Graceful shutdown qo'shish — `SIGINT`/`SIGTERM` handler (`src/index.js`)
- [x] **1.4** OpenAI service'ni `Groq` bilan mos qilish — `/chat/completions` endpoint ga fallback

### Phase 2: Funksionallik To'ldirish

- [x] **2.1** Employee uchun "Studentlarim" tugmasi va `/mystudents` buyrug'i
- [x] **2.2** Topic arxivlash va o'chirish — employee `/archivetopic` va inline keyboard orqali
- [x] **2.3** Student deaktivatsiya — employee `/removestudent` buyrug'i
- [x] **2.4** Employee deaktivatsiya — superadmin `/removeemployee` buyrug'i
- [x] **2.5** Knowledge material o'chirish — employee o'z topicidagi materialni o'chira olsin
- [x] **2.6** Lug'at practice natijalarini DBda saqlash — `dictionary_results` jadvali

### Phase 3: Polishing

- [x] **3.1** README havolalarini tuzatish (eski path'lar `ustozaibot` → `Germanybot`)
- [x] **3.2** `.env.example` ni yangilash
- [x] **3.3** Structured logging — `[INFO]`, `[ERROR]`, `[WARN]` format
- [x] **3.4** Asosiy unit testlar — text utils, dictionary parser, chunking

---

## Fayl Strukturasi

```
Germanybot/
├── .env                    # Real config (gitignore)
├── .env.example            # Namuna config
├── .gitignore
├── PLAN.md                 # <-- SHU FAYL
├── README.md
├── docker-compose.yml
├── package.json
├── db/
│   └── schema.sql          # PostgreSQL schema (enum + tables)
├── docs/
│   └── architecture.md     # Arxitektura hujjati
├── src/
│   ├── index.js            # Entry point
│   ├── bot.js              # Asosiy bot logic (3475 qator)
│   ├── config.js           # ENV config parser
│   ├── db.js               # PostgreSQL Pool + query helpers
│   ├── repositories/
│   │   ├── users.js        # CRUD users
│   │   ├── topics.js       # CRUD topics + stats
│   │   ├── materials.js    # Video/text/chunk saqlash
│   │   ├── state.js        # User state + session
│   │   ├── quiz.js         # Quiz attempts, grading, stats
│   │   └── dictionaries.js # Dictionary CRUD + sessions
│   ├── services/
│   │   ├── telegram-api.js # Telegram Bot API wrapper
│   │   └── openai-service.js # AI (Groq/OpenAI) wrapper
│   ├── utils/
│   │   ├── text.js         # Text normalization, JSON extract
│   │   ├── dictionary.js   # Dictionary text parser, answer matching
│   │   ├── chunking.js     # Text chunking + relevance scoring
│   │   └── time.js         # Sleep + format duration
│   └── scripts/
│       └── migrate.js      # DB migration runner
└── tests/                  # (yangi) Unit testlar
    └── ...
```

## Role tuzilmasi

| Role       | Kim yaratadi       | Nima qila oladi                                                           |
| ---------- | ------------------ | ------------------------------------------------------------------------- |
| superadmin | birinchi yozgan yoki ENV orqali | employee qo'shish/o'chirish                                   |
| employee   | superadmin         | mavzu yaratish, material yuklash, student qo'shish, lug'at yaratish, natijalar ko'rish |
| student    | employee           | mavzu tanlash, savol berish, test topshirish, lug'at mashq qilish         |

## AI Provider

- Base URL: `https://api.groq.com/openai/v1`
- 2 ta endpoint ishlashi kerak:
  - `/responses` (OpenAI Responses API)
  - `/chat/completions` (fallback, Groq standart)
- Model: `openai/gpt-oss-20b`
- Transcription: `whisper-large-v3-turbo`

## DB Schema

Schema `db/schema.sql` da. Idempotent (`IF NOT EXISTS` + `ALTER TABLE IF EXISTS ADD COLUMN IF NOT EXISTS`).

Asosiy jadvallar:
1. `users` — role enum (superadmin/employee/student)
2. `topics` — employee'ga tegishli, status enum (draft/active/archived)
3. `topic_materials` — video reference yoki text
4. `knowledge_chunks` — RAG uchun text bo'laklari
5. `student_topic_access` — qaysi student qaysi topicga kirishi mumkin
6. `user_states` — pending action, active topic, preferred language
7. `student_sessions` — quiz holati
8. `quiz_attempts` + `quiz_questions` — test natijalari
9. `dictionaries` + `dictionary_entries` — lug'at juftliklari
10. `dictionary_sessions` — lug'at practice holati
11. `notification_logs` — bildirishnomalar
12. `dictionary_results` — (yangi) lug'at test natijalari

---

## Muhim qoidalar

1. **DB'ga video binary saqlanmaydi** — faqat `telegram_file_id`
2. **AI uchun training yo'q** — topic-based RAG (knowledge_chunks)
3. **Quiz aniq 5 ta savol** — config orqali o'zgartirish mumkin
4. **Student faqat biriktirilgan mavzular bo'yicha savol beradi**
5. **Lug'at so'z juftliklari: nemischa ↔ o'zbekcha**
