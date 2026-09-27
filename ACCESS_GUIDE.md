# Friends Included access and test guide

## Current status

The private staff interface and the isolated public professor test are deployed. Both database migrations have been applied, a CSV backup of the existing financial tables was saved privately, and `SUPABASE_PUBLISHABLE_KEY` is configured in Vercel Production. S01–S05 and E01–E07 remain in the homework ledger. The old manager access code is no longer used by the deployed application.

The five staff Auth accounts and role assignments have **not** been created. Until the owner completes those steps, the private finance desk cannot be used. The public **Test this system** journey works independently. The Google Sheet sharing and existing server credentials have not been changed.

Vercel Authentication currently uses **Standard Protection**, which protects deployment URLs while leaving the production domain public. Keep that protection enabled for historical deployments, which contain older application code.

After staff sign-in works, the owner may separately decide whether to restrict Sheet sharing and rotate old service credentials. Those changes are not needed for the professor test.

## Remaining owner setup for private staff access

1. In Supabase Authentication → URL Configuration, set the Site URL to `https://friends-included.vercel.app/`. In Authentication → Email Templates → Magic Link, send `{{ .Token }}` as the sign-in code rather than a confirmation URL. Keep the invitation email template usable. In Authentication → Providers → Email, keep email OTP enabled. Set a short OTP lifetime and the project's normal rate limits.
2. In Authentication → Users, use **Invite user** for Svetlana's private email. After the Auth user appears, use SQL Editor to assign that exact account (replace the placeholder locally, not in GitHub or chat):

   ```sql
   insert into public.app_user_roles(auth_user_id, employee_id, active)
   select id, 'svetlana', true
   from auth.users where lower(email)=lower('SVETLANA_EMAIL_HERE')
   on conflict (employee_id) do update
   set auth_user_id=excluded.auth_user_id, active=true, assigned_at=now();
   ```

   Confirm the SQL affected one row. Do not assign any other account to `svetlana`.
3. Svetlana signs in at the site using her invited email and the one-time code. In Manager → Assign an invited user, assign Richard, Anastasia, Jean-Claude, and Kevin after inviting each separate email in Supabase Authentication → Users. Use one role per account. No password or manager code needs to be sent to anyone.
4. If the owner wants the raw homework Sheet private, change Google Sheets → Share → General access to **Restricted**, retaining the service account as Editor and granting a manager Viewer separately. This does not affect the isolated public test.
5. After staff sign-in, bot, and Sheet sync are verified, rotate the Supabase secret API key, Telegram token, and Google service-account key; update their Vercel Production variables and redeploy. Revoke each predecessor in its provider. Remove these credentials from Vercel Preview scope, and remove `MANAGER_ACCESS_CODE` from all scopes. Reconnect the Telegram webhook after token rotation. The new code has no manager-code endpoint.

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
