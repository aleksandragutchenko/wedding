# Friends Included access and test guide

## Approval boundary

The code in this directory is ready for review but is **not deployed**. No Supabase policy, Auth setting, Vercel variable, Telegram link, or Google Sheet sharing change has been applied. The live site still uses its earlier access model. Approving rollout would authorize these specific changes:

1. Apply `db/2026-09-27-access.sql` in the existing Supabase project after taking a database backup. It creates account assignments, one-time Telegram link challenges, practice reset backups, RLS read policies, and server-only write permissions. It preserves all sales and expenses, including S01–S05 and E01–E07.
2. Configure Supabase Auth email OTP and invite the five people to five separate email accounts. Bootstrap only Svetlana as manager. Add `SUPABASE_PUBLISHABLE_KEY` to Vercel Production. Deploy the reviewed code, then remove the obsolete `MANAGER_ACCESS_CODE` variable after verifying manager sign-in.
3. Change the Google Sheet from **Anyone with the link** to **Restricted**, retaining owner access and the Sheets Writer service account as Editor. Grant Svetlana Viewer separately only if she needs the raw Sheet. Ordinary testers use the authenticated Records view. No other sharing changes are proposed.
4. Replace and revoke the **old** Supabase secret API key, Telegram bot token, and Google service-account key after the new production deployment is verified. Update Production with the replacements, then remove these server secrets from Preview scope. Older Vercel deployment URLs may still retain their original environment snapshots, so revoking the old keys is needed to stop those deployments from touching shared data. The Telegram webhook must be reconnected with the replacement token. Require existing manually linked Telegram accounts to reconnect with one-time codes. Historical sales, expenses, delivery events, and original chat destinations remain stored.

## Owner setup after approval

1. In Supabase Dashboard → Database → Backups, take or verify a recoverable backup. Export the five existing tables as a second copy if your plan does not provide managed backups. Record the backup date and location privately.
2. Open Supabase → SQL Editor. Run `db/2026-09-27-access.sql` once. It does not mark or delete old transactions. Check that `app_user_roles`, `telegram_link_challenges`, and `practice_reset_backups` exist and RLS is enabled.
3. Open Authentication → URL Configuration and set the Site URL to `https://friends-included.vercel.app/`. In Authentication → Email Templates → Magic Link, send `{{ .Token }}` as the sign-in code rather than a confirmation URL. Keep the invitation email template usable. In Authentication → Providers → Email, keep email OTP enabled. Set a short OTP lifetime and the project's normal rate limits.
4. In Authentication → Users, use **Invite user** for Svetlana's private email. After the Auth user appears, use SQL Editor to assign that exact account (replace the placeholder locally, not in GitHub or chat):

   ```sql
   insert into public.app_user_roles(auth_user_id, employee_id, active)
   select id, 'svetlana', true
   from auth.users where lower(email)=lower('SVETLANA_EMAIL_HERE')
   on conflict (employee_id) do update
   set auth_user_id=excluded.auth_user_id, active=true, assigned_at=now();
   ```

   Confirm the SQL affected one row. Do not assign any other account to `svetlana`.
5. In Supabase → Project Settings → API Keys, copy the **publishable** key. In Vercel → friends-included → Settings → Environment Variables, add `SUPABASE_PUBLISHABLE_KEY` for Production. It is a server variable in this app; do not add the secret key to browser code. Deploy the reviewed source only after the owner approves.
6. Svetlana signs in at the site using her invited email and the one-time code. In Manager → Assign an invited user, assign Richard, Anastasia, Jean-Claude, and Kevin after inviting each separate email in Supabase Authentication → Users. Use one role per account. No password or manager code needs to be sent to anyone.
7. In Google Sheets → Share, change General access to **Restricted**. Keep the service account Editor entry and owner access. Add a manager Viewer only if raw Sheet access is required. Check a signed-out browser cannot open the Sheet. This step changes sharing and must wait for approval.
8. After the new production sign-in, bot, and Sheet sync are verified, rotate the Supabase secret API key, Telegram token, and Google service-account key; update their Vercel Production variables and redeploy. Revoke each predecessor in its provider. Remove these credentials from Vercel Preview scope, and remove `MANAGER_ACCESS_CODE` from all scopes. Reconnect the Telegram webhook from Svetlana's manager page after token rotation. Verify an old deployment URL can no longer write shared data. The new code has no manager-code endpoint.

## Each person's sign-in and Telegram setup

1. Open `https://friends-included.vercel.app/`, enter your own invited email, and submit the code from that inbox. The site shows your assigned role. Sharing an email account shares its role, so each person needs a separate account.
2. Open the Telegram tab and choose **Generate link command**. Send the displayed `/link CODE` to `@weddiing_hire_task_bot` from your own private chat within ten minutes. The code works once. `/start`, `/help`, and `/id` remain available. The bot checks both stable Telegram user ID and private chat ID; it never accepts a role named in a message.
3. Richard, Anastasia, and Jean-Claude may submit `/sale ...` or use New entry and see their own sales. Kevin may submit `/expense ...` or use New entry and see his own expenses. Svetlana sees all records and decisions, can unlink a verified Telegram chat, and can retry a failed Sheet or Telegram delivery from a record status badge.
4. Records is the authenticated audit view: stable reference, owner, status, source, Sheet state, Telegram submission and decision delivery. Svetlana's Overview also shows income, 10% commission expense, all recorded expenses, project totals, and company result. The Google Sheet is a secondary view and may lag if a sync failed; retry brings it back to the database state.

## Safe solo test with one Telegram account

Use two **separate invited email accounts** for Richard and Kevin. Sign in as Richard, link your Telegram chat, and submit the Richard test sale. Sign out of the website. Sign in as Kevin, generate a fresh link code, and send it from the same private Telegram chat. Future bot entries then belong to Kevin. S01 and every earlier sale keep their recorded owner and frozen notification chat; re-linking does not rewrite them. Do not submit S01 or E01 again merely to check access; use new unique practice references.

For Test 1 and Test 2, start with an agreed active dataset. Run Test 1, then Test 2 **cumulatively without a reset between them**. Mark only disposable records as practice. Website entries can be marked at submission. For bot entries or older records, Svetlana must inspect the Audit row and explicitly choose **Mark practice** after identifying it as disposable. Existing S01–S05 and E01–E07 are not automatically practice and are never selected by default.

## Practice reset and recovery

Svetlana selects only practice-marked records in Manager → Practice reset. **Preview selected records** lists the exact IDs, owners, amounts, and statuses. **Create and download backup** writes a JSON snapshot of those full rows and their delivery events to Supabase and downloads a second copy. Only then does the Archive button appear. Archive removes the selected records from active site results and totals; the Sheet keeps their historical rows, labeled `Archived practice`. A Sheet failure appears as `Sync failed` and can be retried. The backup list remains after refresh and provides Download and Restore actions. No other transaction is archived. If any selected row changes after backup, the database rejects the archive and requires a fresh backup.

## Revoking access

Svetlana uses Manager → Account assignments → Revoke for a non-manager role. Every API request then fails the active-role check, and the bot refuses new submissions even if its old link remains. For permanent account disablement, the owner may additionally ban the user in Supabase Authentication → Users. Keep the Auth user and old transactions for audit history. To replace Svetlana, the owner uses SQL Editor to change the single `svetlana` assignment after inviting the replacement; no employee can self-promote.

## Access boundaries and current limitations

- Do not give five testers Supabase Dashboard project membership. It offers broader project access than these roles require. The authenticated Records view provides the financial audit data they need. The owner can inspect Supabase directly in SQL Editor.
- Do not give every tester raw Google Sheet access. Its rows contain all roles' data and cannot enforce the same per-user filter. A manager Viewer invitation is optional after approval.
- Live sign-in, SMTP delivery, RLS enforcement in the actual Supabase project, real Telegram re-linking and notifications, and the Google Sheet sharing change cannot be completed before rollout approval. Local tests cover API authorization, validation, idempotency, sync recovery, and a mocked user journey.
- A Telegram send interrupted after Telegram accepts the message but before Supabase records `Delivered` can produce a duplicate when Svetlana retries the timed-out event. The UI labels that risk; financial transactions remain idempotent by reference.
