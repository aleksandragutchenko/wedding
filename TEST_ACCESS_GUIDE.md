# Professor test access

**Status: deployed.** The professor test is available at `https://friends-included.vercel.app/test.html`. The sandbox tables are installed in Supabase, and the bot accepts Telegram confirmation buttons. Fictional records sync to the [Test Ledger tab](https://docs.google.com/spreadsheets/d/1uZKXgt7zArY6v48QflwMgLxB6mfx-tB1OHnxr_GFYzI/edit?gid=567335621#gid=567335621) with link-based Viewer access. The original Sales and Expenses tabs are unchanged.

## What a professor does

1. Open the submitted website and select **Test this system**. The page starts a private seven-day browser workspace. No login or manager code is needed.
2. Open `@weddiing_hire_task_bot` in Telegram, press **Start**, and send `/id`.
3. Select Richard, Anastasia, Jean-Claude, or Kevin on the test page; enter the Chat ID returned by `/start` or `/id`; request a confirmation button. Tap **Confirm this test link** in Telegram within ten minutes. The website detects confirmation automatically. No code is copied.
4. Submit a unique test sale or expense on the page, or send the complete `/sale` or `/expense` command to the bot from that verified chat. The chosen fictional employee must match the command: Richard, Anastasia, or Jean-Claude for sales; Kevin for expenses.
5. In the page's **test manager** section, approve the pending sale with a final 100% split or allocate the expense. That action is limited to the current workspace's transactions.
6. See the decision in the same Telegram chat. In the website audit list, check the reference, saved owner, final decision, delivery state, Sheet sync state, and calculated totals. Press **Refresh my test records** after a bot submission. Open the Test Ledger tab and find the reference; its original row shows the proposed and final split.
7. If Telegram delivery or Sheet sync is marked failed, use its **Retry** button. To try another fictional role with the same Telegram account, repeat step 3; existing transaction owners and destinations remain unchanged. When finished, use **Disconnect my test bot link**. **Reset my test records** soft-archives only this workspace's active test transactions and marks their Sheet rows Reset.

The database remains the source of truth. The Test Ledger is a separate tab in the existing workbook, and it contains only fictional transaction fields. It excludes chat IDs, session identifiers, customers, and descriptions. Anyone with the workbook link can view the Test Ledger and the original Sales and Expenses tabs; website test sessions still isolate reads and decisions. If the original homework tabs later need private access, move Test Ledger to a separate public workbook before restricting this workbook.

## Isolation and access checks

- Test session tokens are generated server-side, stored as SHA-256 hashes, and sent only in an HttpOnly, SameSite=Strict cookie with Secure on HTTPS. There is no session identifier in form fields or API responses.
- Every test read and write is constrained by the resolved session ID. Direct calls to the real manager API still require a signed-in Svetlana account. A visitor's fictional test role never becomes an application administrator role.
- `test_*` tables have RLS enabled. Anonymous and authenticated Supabase Data API roles have no table permissions or policies; only the server's service role can access them. The bot token and service key stay in Vercel's server environment.
- A chat link is created only after an atomic, single-use, expiring Telegram callback. The bot checks that the sender's Telegram user ID equals the private chat ID that received the button. The opaque callback ID is not proof when sent through the website API.
- Test records never enter `sales`, `expenses`, or `delivery_events`, or the original Sales and Expenses tabs. Each test record gets a unique permanent Test Ledger row keyed by its database UUID. Approval updates that same row, retaining proposed and final splits. Reset sets `reset_at` on the current session's records, removing them from active totals and marking their Sheet rows Reset. The same reference can be reused after reset because the UUID remains distinct.
- Telegram Bot API does not provide an exactly-once delivery transaction across the database and Telegram. A retry after a worker timed out following a successful send could duplicate one chat message; the UI marks this condition before retry. Record creation and decisions remain single-use.

## Verified production journey

On 27 September 2026, a browser session linked a private Telegram chat using the confirmation button, submitted fictional sale ST2719 through the bot, approved it in the test manager view with a changed 40/30/30 split, received the decision in the same chat, and still showed the approved record and delivered status after refresh. Repeating the same bot command did not create a second record. A separate browser origin showed no records from the first session. The two disposable records created during that check were reset. The existing S92718 bot sale was backfilled into Test Ledger row 2. A live website sale STSHEET27 synced to row 5 as Pending approval, then updated that same row to Approved with both 50/30/20 proposed and 40/30/30 final splits. A second sale STSHEETBOT27 was sent through the live Telegram client; it appeared in the same website session and Test Ledger row 6, then a manager test decision updated row 6 to Approved with the original 50/30/20 and final 20/30/50 splits. Telegram displayed the decision reply. The website showed Sheets Synced and Telegram decision Delivered after refresh. S01–S05 and E01–E07 remained in their original tabs. The automated suite passed 21 tests, including unauthorized sheet retry, duplicate events, and sheet delivery failure and retry.

Staff account invitations and assignments remain an owner task described in `ACCESS_GUIDE.md`; they are not needed for this professor test. Workbook sharing and credential rotation were not changed.
