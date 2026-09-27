# Professor test access

**Status: deployed.** The professor test is available at `https://friends-included.vercel.app/test.html`. The sandbox tables are installed in Supabase, and the bot accepts Telegram confirmation buttons. The homework Sheet sharing has not been changed.

## What a professor does

1. Open the submitted website and select **Test this system**. The page starts a private seven-day browser workspace. No login or manager code is needed.
2. Open `@weddiing_hire_task_bot` in Telegram, press **Start**, and send `/id`.
3. Select Richard, Anastasia, Jean-Claude, or Kevin on the test page; enter the Chat ID returned by `/start` or `/id`; request a confirmation button. Tap **Confirm this test link** in Telegram within ten minutes. The website detects confirmation automatically. No code is copied.
4. Submit a unique test sale or expense on the page, or send the complete `/sale` or `/expense` command to the bot from that verified chat. The chosen fictional employee must match the command: Richard, Anastasia, or Jean-Claude for sales; Kevin for expenses.
5. In the page's **test manager** section, approve the pending sale with a final 100% split or allocate the expense. That action is limited to the current workspace's transactions.
6. See the decision in the same Telegram chat. In the website audit list, check the reference, saved owner, final decision, delivery state, and calculated totals. Press **Refresh my test records** after a bot submission.
7. If Telegram delivery is marked failed, use **Retry** on that event. To try another fictional role with the same Telegram account, repeat step 3; existing transaction owners and destinations remain unchanged. When finished, use **Disconnect my test bot link**. **Reset my test records** soft-archives only this workspace's active test transactions.

The test mode does not write to the homework Google Sheet. The website audit view is the test record of truth; the existing Sheet remains a view of the original homework ledger.

## Isolation and access checks

- Test session tokens are generated server-side, stored as SHA-256 hashes, and sent only in an HttpOnly, SameSite=Strict cookie with Secure on HTTPS. There is no session identifier in form fields or API responses.
- Every test read and write is constrained by the resolved session ID. Direct calls to the real manager API still require a signed-in Svetlana account. A visitor's fictional test role never becomes an application administrator role.
- `test_*` tables have RLS enabled. Anonymous and authenticated Supabase Data API roles have no table permissions or policies; only the server's service role can access them. The bot token and service key stay in Vercel's server environment.
- A chat link is created only after an atomic, single-use, expiring Telegram callback. The bot checks that the sender's Telegram user ID equals the private chat ID that received the button. The opaque callback ID is not proof when sent through the website API.
- Test records never enter `sales`, `expenses`, `delivery_events`, or the Google Sheet. Reset sets `reset_at` on the current session's records, retaining them for recovery by an administrator while removing them from active totals. The same reference can be reused after reset.
- Telegram Bot API does not provide an exactly-once delivery transaction across the database and Telegram. A retry after a worker timed out following a successful send could duplicate one chat message; the UI marks this condition before retry. Record creation and decisions remain single-use.

## Verified production journey

On 27 September 2026, a browser session linked a private Telegram chat using the confirmation button, submitted fictional sale ST2719 through the bot, approved it in the test manager view with a changed 40/30/30 split, received the decision in the same chat, and still showed the approved record and delivered status after refresh. Repeating the same bot command did not create a second record. A separate browser origin showed no records from the first session. The two disposable records created during this check were reset; S01–S05 and E01–E07 remained present. The automated suite passed 20 tests, including expired challenges, unauthorized requests, duplicate events, and delivery failure and retry.

Staff account invitations and assignments remain an owner task described in `ACCESS_GUIDE.md`; they are not needed for this professor test. Google Sheet sharing and credential rotation were not changed.
