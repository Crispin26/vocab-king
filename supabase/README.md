# Supabase setup — Vocab-King

Everything here is done in the **Supabase dashboard** on the **Free plan**.
You don't need Supabase's GitHub integration, a paid plan or a server.

Allow about 30 minutes. Do the steps in order.

---

## 1. Run the database script

1. Open your project → **SQL Editor** → **New query**.
2. Paste the whole of [`setup.sql`](setup.sql) and click **Run**.
3. It should finish with "Success. No rows returned".

The script upgrades your existing tables in place and keeps the data already there.
It is safe to run again later.

> **Students from the old app:** their progress is kept. When they register with the **same Student ID**,
> the new account takes over that profile automatically.

## 2. Make yourself Super Admin

1. **Authentication → Users → Add user → Create new user**.
   Enter your admin email and a strong password, and tick **Auto Confirm User**.
2. In the **SQL Editor**, run this with your email filled in:

   ```sql
   insert into public.admins (user_id, email, name, role)
   select id, lower(email), 'Alingilya Crispin Njewa', 'super'
   from auth.users where lower(email) = lower('YOUR-ADMIN-EMAIL@example.com')
   on conflict (user_id) do update set role = 'super';
   ```
3. In the app, click 🔐 and sign in with that email and password.
4. To add Prof. Yoon: create her account the same way (step 1), then go to **Admin → Admin Access → Grant Administrator Access**.

## 3. Turn on email confirmation and set the links

**Authentication → Sign In / Providers → Email**
- **Enable Email provider:** on
- **Confirm email:** on. Students must click the link in the welcome email before they can sign in.
- **Minimum password length:** 8

**Authentication → URL Configuration**
- **Site URL:** your Netlify address, for example `https://YOUR-SITE.netlify.app/`
- **Redirect URLs:** add both of these:
  - `https://YOUR-SITE.netlify.app/**`
  - `http://localhost:3000/**`

If you later add a custom domain in Netlify, add that address here too.

The verification and password-reset links only send people back to these addresses.

## 4. Set up email sending (needed for real students)

Supabase's built-in email service only sends to members of your Supabase team, and only a few per hour.
For students to get welcome and reset emails, connect your own SMTP.
Both options below are free:

| Option | Limit | What you need |
|---|---|---|
| **Gmail** | ~500 emails/day | A Gmail account with 2-Step Verification on, plus an **App Password** (Google Account → Security → App passwords) |
| **Brevo** | 300 emails/day | A free Brevo account with your sender email verified |

Then go to **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

| Field | Gmail | Brevo |
|---|---|---|
| Host | `smtp.gmail.com` | `smtp-relay.brevo.com` |
| Port | `465` | `587` |
| Username | your Gmail address | your Brevo SMTP login |
| Password | the 16-character App Password | your Brevo SMTP key |
| Sender email | your Gmail address | your verified sender |
| Sender name | `Vocab-King` | `Vocab-King` |

After that, go to **Authentication → Rate Limits** and raise **emails per hour** (for example to 100).

## 5. Use the Vocab-King email designs

**Authentication → Emails → Templates**

| Template | Subject | Body |
|---|---|---|
| **Confirm signup** (this is the welcome email every new student gets) | `👑 Welcome to Vocab-King! Please verify your email` | paste [`email-templates/confirm-signup.html`](email-templates/confirm-signup.html) |
| **Reset Password** | `🔑 Reset your Vocab-King password` | paste [`email-templates/reset-password.html`](email-templates/reset-password.html) |

## 6. Test it

1. Open the app and register as a test student with a real email you can check.
2. You should get the welcome email. Click **Verify My Email**, which brings you back to the app already signed in.
3. Sign out (🚪). Sign in again once with the **Student ID** and once with the **email**.
4. Use **Forgot your password?**, follow the email link, and set a new password.
5. Finish a level, then sign in on another device or browser. Your progress should be there.

---

## Keeping the free project awake

Free projects pause after **7 days with no activity**. Your data is kept, and you can restore the project from the dashboard.
During a semester, students using the app keep it awake. Over breaks, open the app once a week,
or set up a scheduled GitHub Action that visits the site every few days.

## How the security works

- The key in `app.js` is the **public anon key**. It is meant to be in the browser.
  The rules in `setup.sql` (Row Level Security) decide what each signed-in person can do.
- **Students** can only read their own profile, progress and review words.
  Scores are saved through database functions that check who is signed in and reject impossible results.
- **Admins** are whoever is listed in the `admins` table. They can read every student's data and edit cohorts and settings.
  Only Super Admins can add or remove admins.
- The **leaderboard** shows only nickname, cohort and scores. It never shows full names, Student IDs or emails,
  and only verified accounts appear.
- Passwords are stored and checked by Supabase Auth. They are never in the code or the database tables.
- Signing in with a Student ID works by looking up the email linked to that ID.
  So someone who knows a Student ID can find out which email it belongs to. They still need the password to sign in.
