# Ustoz AI Bot

Bu repo `Ustoz AI` uchun Node.js + PostgreSQL MVP.

Asosiy qoida:

- DB ichiga umuman `mp4`, `mov`, `avi`, `pdf` binary yozilmaydi
- video uchun faqat Telegram reference saqlanadi:
  - `telegram_file_id`
  - `telegram_file_unique_id`
  - `source_chat_id`
  - `source_message_id`

Shuning uchun server storage kichik bo'lsa ham bot ishlaydi.

## Hozirgi flow

- `superadmin` employee ochadi
- `employee` student ochadi
- `employee` mavzu yaratadi
- `employee` mavzuga video yuklaydi
- bot DBga faqat video reference yozadi
- video kichik bo'lsa bot avtomatik transcript ham oladi
- `employee` text yoki transcript yuboradi
- text `knowledge_chunks` ga bo'linadi
- `student` mavzu tanlaydi
- bot video'ni Telegram `file_id` bilan qayta yuboradi
- `student` faqat shu mavzu bo'yicha savol beradi
- `student` javobni `Qisqacha`, `Soddaroq`, `Misol bilan` rejimlarida qayta so'raydi
- `student` `Xatolarim` bo'limida oldingi xatolarini ko'radi va qayta mashq qiladi
- `student` `savollarim tugadi` desa, bot 5 ta savol beradi
- natija employeega yuboriladi
- `employee` `Natijalar` va `Kuchsiz studentlar` bo'limida analytics ko'radi

## AI provider

Hozir loyiha Groq bilan ishlashga moslangan.

- base URL: `https://api.groq.com/openai/v1`
- model default: `openai/gpt-oss-20b`

Kod OpenAI-compatible endpoint ishlatadi, shuning uchun keyin xohlasangiz boshqa providerga ham o'tkazish oson.

## Superadmin bootstrap

Agar `.env` ichida `SUPERADMIN_TELEGRAM_ID=0` bo'lsa:

- botga birinchi yozgan odam avtomatik `superadmin` bo'ladi

Bu sizga Telegram user ID topmasdan tez boshlash imkonini beradi.

## O'rnatish

`.env` fayl yaratib qo'yilgan.

Unda:

- Telegram bot token joylangan
- Groq API key joylangan
- local Postgres uchun default `DATABASE_URL` qo'yilgan

Sizga kerak bo'ladigani:

1. PostgreSQL ishga tushirish
2. schema ni qo'llash
3. botni start qilish

## PostgreSQL

Default connection:

```bash
postgresql://postgres:postgres@localhost:5432/ustoz_ai
```

Repo ichida [docker-compose.yml](/Users/furb-x/Desktop/ustozaibot/docker-compose.yml) ham bor, lekin shu kompyuterda `docker` o'rnatilmagan, shuning uchun men uni bu yerda ishga tushira olmadim.

Agar sizda Docker bo'lsa:

```bash
docker compose up -d
```

Yoki local Postgres bo'lsa, shu DB va userni o'zingiz ochasiz.

## Ishga tushirish

1. Schema ni bazaga qo'llang:

```bash
npm run db:migrate
```

2. Botni ishga tushiring:

```bash
npm start
```

## Asosiy ishlash

Endi botda asosiy usul `tugmalar` bilan ishlash:

- superadmin: `Employee qo'shish`
- employee: `Mavzu yaratish`, `Mavzularim`, `Student qo'shish`, `Studentga biriktirish`, `Aktiv mavzu`
- employee: `Natijalar`, `Kuchsiz studentlar`
- student: `Mavzularim`, `Aktiv mavzu`, `Qisqacha tushuntir`, `Soddaroq tushuntir`
- student: `Misol bilan`, `Test boshlash`, `Xatolarim`, `Til tanlash`

Buyruqlar hali ham ishlaydi, lekin endi majburiy emas.

## Yangi imkoniyatlar

- Student topic tanlaganda bot so'raydi:
  - `Qaysi tilda tushuntiray?`
  - `O'zbekcha / Русский / English`
- Tanlangan til keyingi explanation va quiz uchun saqlanadi
- Quiz qat'iy `5 ta savol` bilan ishlaydi
- 5-javobdan keyin bot boshqa savol bermaydi va testni yakunlaydi
- Javob oxirida manba snippetlari ko'rsatiladi
- Employee topicni studentga inline tugma bilan biriktira oladi

## Buyruqlar

### Superadmin

- `/makeemployee <telegram_id> | <ism>`

### Employee

- `/addstudent <telegram_id> | <ism>`
- `/newtopic <nom> | <izoh ixtiyoriy>`
- `/topics`
- `/use <topic_id>`
- `/assigntopic <student_telegram_id> <topic_id>`
- `/results`
- `/weakstudents`
- `/cancel`

Eng qulay flow:

1. `/newtopic Photosintez`
2. Bot shu topicni `active` qiladi
3. Keyin text yoki video'ni oddiy yuborasiz
4. Bot avtomatik shu mavzuga saqlaydi

### Student

- `/mytopics`
- `/topic <topic_id>`
- `/mistakes`
- `savollarim tugadi`

## Video qismi qanday ishlaydi

Employee avval topic ochadi yoki `/use <topic_id>` bilan topic tanlaydi, keyin video'ni oddiy yuboradi.

Bot quyidagini saqlaydi:

- `video.file_id`
- `video.file_unique_id`
- yuborilgan message `chat.id`
- yuborilgan `message_id`

Bot quyidagini saqlamaydi:

- mp4 fayl
- binary blob
- local storage copy
- DB blob

Student mavzu tanlaganda video qayta upload qilinmaydi. Bot `sendVideo(file_id)` bilan yuboradi.

AI ulangan bo'lsa va video `20 MB` dan kichik bo'lsa, bot video'dan avtomatik transcript ham oladi.
Katta video bo'lsa ham video reference saqlanadi, faqat transcriptni qo'lda yuborish kerak bo'ladi.

## AI qismi

Employee yuborgan text yoki transcript:

1. tozalanadi
2. bo'laklarga ajratiladi
3. `knowledge_chunks` jadvaliga yoziladi

Student savol berganda:

1. active topic olinadi
2. shu topic chunklari olinadi
3. eng relevant chunklar tanlanadi
4. AIga faqat shu context yuboriladi

## Qo'shimcha qulayliklar

- Student javobni o'sha zahoti boshqa tilga o'tkazishi mumkin
- `Soddaroq` rejimi murakkab javobni osonlashtiradi
- `Misol bilan` rejimi real-life misollar bilan tushuntiradi
- `Xatolarim` bo'limi oldingi xatolarni ko'rsatadi
- `Qayta mashq` aynan xatolar bo'yicha mini test ochadi
- Employee panel student kesimidagi natijalarni ko'rsatadi

## Asosiy fayllar

- env: [.env](/Users/furb-x/Desktop/ustozaibot/.env)
- bot entry: [src/index.js](/Users/furb-x/Desktop/ustozaibot/src/index.js)
- bot logic: [src/bot.js](/Users/furb-x/Desktop/ustozaibot/src/bot.js)
- schema: [db/schema.sql](/Users/furb-x/Desktop/ustozaibot/db/schema.sql)
- config: [src/config.js](/Users/furb-x/Desktop/ustozaibot/src/config.js)
- Telegram API: [src/services/telegram-api.js](/Users/furb-x/Desktop/ustozaibot/src/services/telegram-api.js)
- AI service: [src/services/openai-service.js](/Users/furb-x/Desktop/ustozaibot/src/services/openai-service.js)
# Germany_course
