# Friends Included finance desk

A Vercel web application and Telegram bot for the fictional Day 4 homework. Supabase stores all financial records. Google Sheets receives an automatically synchronized copy. No AI API is needed.

## What is implemented

- Five demonstration roles, checked in the server processing layer.
- Sales and expense submission by website or Telegram, with shared validation.
- Manager approval and allocation changes that preserve original proposals.
- Dynamic project and company results, commission rounding, pending records, and separate Sheets and Telegram delivery states.
- Fixed Sheets row numbers per transaction, so approval and retry update the same row.
- Telegram user ID linking by the manager; bot messages use the saved originating chat for later decisions.
- Manager decision forms include one-time Sheets and Telegram failure switches for the homework's retry test. The saved decision and financial totals remain in Supabase; retry from the record status badges.

## Account setup

1. Create a Supabase project. In its SQL Editor, run `db/schema.sql`. Copy the project URL and **secret** API key (or legacy service role key) into server-side environment variables. Keep the key private.
2. Create a Telegram bot using BotFather. Copy its token to `TELEGRAM_BOT_TOKEN`. Generate a random `TELEGRAM_WEBHOOK_SECRET` (letters, digits, underscore or hyphen, 1–256 characters). After the Vercel deployment, set the webhook with `POST https://api.telegram.org/bot<TOKEN>/setWebhook` and JSON body `{"url":"https://YOUR-VERCEL-URL/api/telegram","secret_token":"YOUR_WEBHOOK_SECRET"}`. Start the bot in a private chat and send `/id`.
3. In Google Cloud, enable the Sheets API, create a service account and a JSON key. Create a spreadsheet with tabs named **Sales** and **Expenses**. Share it with the service account email as Editor. Put the email, private key, and spreadsheet ID in Vercel server-side environment variables. Give the instructor Viewer access to the Sheet.
4. Create a GitHub repository, push this folder, and import it into Vercel. Set all variables in `.env.example` in Vercel Project Settings → Environment Variables. Redeploy after changes. Use the actual public bot, Sheet, and GitHub URLs for the three `PUBLIC_*` values. These are non-secret.
5. Set `DISPLAY_NAME` to the name that should appear on the page. Do not commit `.env` or service-account JSON.
6. Open `/api/health` to confirm configuration flags. Select Svetlana on the site and enter the Telegram user ID and chat ID from `/id`, linked to Richard. Submit S01 in the bot, then relink the same user to Kevin and submit E01. Continue with the other homework entries using the website.

The website selector is deliberately a demonstration identity mechanism, as the homework specifies. Anyone who can open the page can select Svetlana. Use fictional data only.

## Local checks

Use Node.js 20 or later: `npm test`. `node server-local.js` serves the interface at `http://localhost:3000`; local transactions require the environment variables and a configured Supabase project. The Telegram webhook requires a public HTTPS URL.

## Telegram commands

`/id` shows the IDs needed for manager linking. Example submissions:

```
/sale S01 | Olivia Rose | A | One proud uncle and an emotional grandmother | 1000.00 | 50/30/20
/expense E01 | Rented suit and fake pearl necklace for the relatives | Materials | 120.00 | A
```

The bot rejects unlinked users and does not support self-assigned roles.

## Test values

The application has no preset transactions or hard-coded result totals. The test fixtures in `tests/rules.test.js` verify the homework's expected results. Live Test 1 and Test 2 must be entered through the configured services; S01 and E01 specifically require the real Telegram bot.
