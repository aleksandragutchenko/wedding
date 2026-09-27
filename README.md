# Friends Included finance desk

The deployed site is currently on the **old** public role-selector version. This directory contains the proposed account-based implementation and a self-service professor test workspace. Do not deploy it or change sharing until the owner approves the rollout in `ACCESS_GUIDE.md` and `TEST_ACCESS_GUIDE.md`.

## Architecture

Supabase Auth verifies invited email one-time codes. The server stores short-lived access and rotating refresh tokens in secure HttpOnly cookies and looks up an active `app_user_roles` assignment on every request. The browser never sends a role and never receives the Supabase service key. Server mutations use the service key only after authorization. Supabase RLS grants authenticated users read access to their own records, or all records for Svetlana, while direct Data API writes are revoked. The server is the only writer.

Richard, Anastasia, and Jean-Claude submit and view their own sales. Kevin submits and views his expenses. Svetlana views all records and totals, approves sales, allocates expenses, assigns or revokes invited accounts, sees verified Telegram links, retries failed deliveries, and manages selected practice resets. The Records view is the authenticated audit view for each role.

Each signed-in user generates a one-time `/link CODE` command and sends it from their own private Telegram chat. A database function consumes the code atomically and checks the Telegram user ID equals the private chat ID. Future bot commands use the active assigned role. Each transaction freezes the notification chat at submission, so linking one chat to a different role does not move old records or notifications.

Existing S01–S05 and E01–E07 are preserved and unmarked as practice. New website entries can be explicitly marked practice. Svetlana can preview exactly which selected practice IDs will leave active totals, create and download a database backup, archive those records, and restore them. The Sheet retains archived rows with a `Record state` column rather than deleting financial history. A failed Sheet update is visible and can be retried.

## Self-service professor workspace

The homepage links to `/test.html`. Each visitor gets a cryptographically random, HttpOnly browser cookie for a separate seven-day sandbox. Test transactions live only in `test_*` Supabase tables; they never enter the real sales, expenses, manager records, or Google Sheet. The server scopes every sandbox read, decision, retry, and soft reset to that cookie's session. A fictional employee selection is valid only inside that session. Server checks and RLS prevent using it to access the real manager API or another tester's data.

The tester starts the bot, reads the Chat ID, enters it on the test page, and taps an in-Telegram confirmation button. The page detects the confirmation automatically; the visitor copies no code and needs no invitation or manager password. The bot routes messages from that verified private user/chat pair to the sandbox's current fictional employee. Each transaction saves its owner and notification chat at creation, so later relinking does not move its approval notification. A failed notification can be retried from the same test session. See `TEST_ACCESS_GUIDE.md` for the detailed journey.

## Local checks

Run `npm test` with Node.js 20 or later. `node server-local.js` serves the interface at `http://localhost:3000`; real sign-in requires the environment variables, Auth setup, and migration. The Telegram webhook requires a public HTTPS URL. Tests mock external services and do not create live transactions.

The migrations for the existing project are `db/2026-09-27-access.sql` and `db/2026-09-27-test-sandbox.sql`. A new project first needs `db/schema.sql`, then both migrations. See `ACCESS_GUIDE.md` and `TEST_ACCESS_GUIDE.md` for the exact owner actions and rollout order.
