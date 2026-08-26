# Best School Guide Sikar — Setup Guide

This project is split into clean files and is built to be **secure and free**.

```
bestschoolguide/
├── index.html            ← the website (upload to cPanel)
├── css/styles.css        ← all styling
├── js/config.js          ← paste your PUBLIC Supabase keys here
├── js/app.js             ← site logic (no admin, no passwords)
├── data/schools.js       ← the school directory data (edit to update schools)
└── supabase/
    ├── setup.sql         ← run once in Supabase SQL Editor
    └── functions/
        ├── generate-blog-draft/   ← daily: RSS → Gemini → draft → Telegram
        └── telegram-approve/      ← your Approve/Reject buttons
```

---

## PART A — Put the website live (cPanel)

1. In cPanel → **File Manager** → open `public_html` (or your domain's folder).
2. Upload **everything inside `bestschoolguide/`** EXCEPT the `supabase/` folder
   (that folder is not part of the website — it runs on Supabase).
   So upload: `index.html`, `css/`, `js/`, `data/`.
3. Visit your domain — the site works immediately with demo blog posts.

That's the whole website. It's just static files. **Nothing secret is in them.**

---

## PART B — Turn on the blog system (Supabase, free)

### B1. Create the database
1. supabase.com → your project → **SQL Editor** → paste all of `supabase/setup.sql` → **Run**.
   (If cron lines error, go **Database → Extensions**, enable `pg_cron` and `pg_net`, run again.)
2. In `setup.sql` replace `YOUR-PROJECT-REF` with your real project ref before running the cron part.

### B2. Connect the website to Supabase
1. **Project Settings → API**, copy **Project URL** and **anon public** key.
2. Open `js/config.js`, paste both values, re-upload that one file to cPanel.
   > These two keys are SAFE to expose. RLS means a visitor can only READ published blogs.

### B3. Make a Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **bot token**.
2. Message your new bot once (say "hi"), then open:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Find `"chat":{"id":123456789}` — that number is your **chat id**.

### B4. Add the secrets (server-side only — never in the website)
**Project Settings → Edge Functions → Secrets**, add:
- `SB_SERVICE_KEY` = your service_role key (Settings → API)
- `GEMINI_API_KEY` = from Google AI Studio (aistudio.google.com, free)
- `TELEGRAM_BOT_TOKEN` = the bot token from B3
- `TELEGRAM_CHAT_ID` = your chat id from B3
- `TG_WEBHOOK_SECRET` = any long random string you invent (e.g. 40 random characters)

### B5. Deploy the two functions
Install the Supabase CLI, then from the project root:
```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy generate-blog-draft
supabase functions deploy telegram-approve
```

### B6. Point Telegram's buttons at your approve function
Register the webhook (one command, replace the pieces):
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://YOUR-PROJECT-REF.functions.supabase.co/telegram-approve&secret_token=<YOUR_TG_WEBHOOK_SECRET>"
```

Done. Every morning you'll get a draft in Telegram with **✅ Approve** / **❌ Reject**.
Tap Approve → it goes live on the site. Tap Reject → it's deleted. Nothing publishes without you.

---

## How this is secure

- **The website code is visible** (all websites are — that's normal). But it contains
  **no secrets** — only the public anon key, which by design can only read published posts.
- **The database is locked by RLS.** Even if someone grabs the anon key from the page and
  opens the browser console, they can only READ published blogs. They cannot insert, edit,
  delete, or see drafts. There are simply no policies allowing it.
- **All writing happens server-side** in Edge Functions using the service_role key, which
  lives only in Supabase secrets and never touches the browser.
- **Approvals are locked to you.** The approve function checks the Telegram secret header
  AND that the tapping user's id equals your chat id. A stranger who finds the URL can't publish.
- **The generator only writes ORIGINAL posts** (Gemini rewrites a topic; it never copies the
  article or its images) and credits the source — keeping you clear of copyright problems.

## Cost
- Supabase free tier, RSS feeds, Gemini free tier, Telegram → **₹0/month** at this scale.
- The daily cron keeps the free Supabase project from pausing.

## To add or edit schools
Edit `data/schools.js` and re-upload it. No database needed for schools.
