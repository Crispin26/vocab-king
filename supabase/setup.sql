-- ═══════════════════════════════════════════════════
-- 쏙쏙 어휘왕 · Vocab King — Secure Database Setup (v2)
-- KDU Korean Program · Built by ALINGILYA CRISPIN NJEWA
--
-- Run this whole script in Supabase → SQL Editor.
-- It upgrades the original setup (students / progress / fail_words) in place
-- and is safe to run more than once. Existing rows are kept.
--
-- What it adds:
--   • Supabase Auth accounts linked to student profiles (email + password)
--   • Login with Student ID OR email
--   • Cohorts, app settings (certificate + contact) and admins stored in the DB
--   • Row Level Security: students only see/write their own data,
--     admins see everything, nobody can write scores for someone else
-- ═══════════════════════════════════════════════════


-- ───────────────────────────────────────────────────
-- 1. COHORTS (semester groups)
-- ───────────────────────────────────────────────────
create table if not exists public.cohorts (
  id         text primary key,
  name       text not null,
  semester   text,
  year       int,
  active     boolean not null default false,
  created_at timestamptz not null default now()
);
-- At most one active cohort at a time
create unique index if not exists cohorts_one_active on public.cohorts (active) where active;

insert into public.cohorts (id, name, semester, year, active) values
  ('2026-1', '2026 Spring Cohort', 'Spring', 2026, true),
  ('2025-2', '2025 Fall Cohort',   'Fall',   2025, false),
  ('2025-1', '2025 Spring Cohort', 'Spring', 2025, false),
  ('2024-2', '2024 Fall Cohort',   'Fall',   2024, false),
  ('alumni', 'Alumni / Former Students', 'Former', 2024, false)
on conflict (id) do nothing;


-- ───────────────────────────────────────────────────
-- 2. STUDENTS — link to Supabase Auth
-- ───────────────────────────────────────────────────
alter table public.students add column if not exists user_id uuid unique references auth.users(id) on delete cascade;
alter table public.students add column if not exists email   text;
alter table public.students add column if not exists cohort  text references public.cohorts(id) on update cascade on delete set null;

update public.students set cohort = (select id from public.cohorts where active limit 1) where cohort is null;


-- ───────────────────────────────────────────────────
-- 3. ADMINS (linked to Supabase Auth accounts)
-- ───────────────────────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null,
  role       text not null check (role in ('super', 'academic', 'co-admin')),
  created_at timestamptz not null default now()
);


-- ───────────────────────────────────────────────────
-- 4. APP SETTINGS (certificate template, contact channels)
-- ───────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.app_settings (key, value) values
  ('cert_config', '{}'::jsonb),
  ('contact_config', '{}'::jsonb)
on conflict (key) do nothing;


-- ───────────────────────────────────────────────────
-- 5. HELPER FUNCTIONS (used by policies)
-- ───────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'super');
$$;

create or replace function public.my_student_id() returns text
language sql stable security definer set search_path = public as $$
  select student_id from public.students where user_id = auth.uid();
$$;


-- ───────────────────────────────────────────────────
-- 6. SIGN-UP TRIGGER: create the student profile from sign-up data
--    The app sends student_id, name, nickname and cohort as user metadata.
--    Accounts without a student_id (e.g. admins added in the dashboard) get no profile.
-- ───────────────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  sid      text  := upper(trim(coalesce(meta->>'student_id', '')));
  v_cohort text;
begin
  if sid = '' then
    return new;
  end if;

  select id into v_cohort from public.cohorts where id = meta->>'cohort';
  if v_cohort is null then
    select id into v_cohort from public.cohorts where active limit 1;
  end if;

  -- A student ID from the old (password-less) app can be claimed once by its owner
  insert into public.students (user_id, student_id, name, nickname, email, cohort)
  values (new.id, sid, upper(trim(coalesce(meta->>'name', ''))), nullif(trim(meta->>'nickname'), ''), lower(new.email), v_cohort)
  on conflict (student_id) do update
    set user_id = excluded.user_id, name = excluded.name, nickname = excluded.nickname,
        email = excluded.email, cohort = excluded.cohort, last_seen = now()
    where public.students.user_id is null;

  if not found then
    raise exception 'STUDENT_ID_TAKEN';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep students.email in sync when a user changes their email
create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.students set email = lower(new.email) where user_id = new.id;
  update public.admins   set email = lower(new.email) where user_id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();


-- ───────────────────────────────────────────────────
-- 7. PUBLIC RPCs (callable before login)
-- ───────────────────────────────────────────────────
create or replace function public.is_student_id_available(p_student_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.students
    where student_id = upper(trim(p_student_id)) and user_id is not null
  );
$$;

-- Lets students sign in with their Student ID: returns the email linked to it.
-- (Supabase Auth itself only signs in by email.)
create or replace function public.login_email_for(p_identifier text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_email text;
begin
  if position('@' in coalesce(p_identifier, '')) > 0 then
    return lower(trim(p_identifier));
  end if;
  select email into v_email from public.students
  where student_id = upper(trim(p_identifier)) and user_id is not null;
  return v_email;
end $$;


-- ───────────────────────────────────────────────────
-- 8. STUDENT RPCs (score writes go through these, never direct table writes)
-- ───────────────────────────────────────────────────
create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update public.students set last_seen = now() where user_id = auth.uid();
$$;

-- Saves a level attempt, keeping the best result and counting attempts
create or replace function public.record_level_result(
  p_prog_day int, p_book_day int, p_correct int, p_wrong int, p_best_streak int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  sid text := public.my_student_id();
  pct int;
begin
  if sid is null then raise exception 'NOT_A_STUDENT'; end if;
  if p_prog_day not between 1 and 5 or p_book_day not between 1 and 49
     or p_correct < 0 or p_wrong < 0 or p_correct + p_wrong > 30
     or p_best_streak < 0 or p_best_streak > 30 then
    raise exception 'INVALID_RESULT';
  end if;
  pct := case when p_correct + p_wrong > 0 then round(100.0 * p_correct / (p_correct + p_wrong)) else 0 end;

  insert into public.progress as pr
    (student_id, prog_day, book_day, level_key, completed, correct, wrong, score_pct, best_streak, attempts, updated_at)
  values
    (sid, p_prog_day, p_book_day, p_prog_day || '_' || p_book_day, p_correct >= 24, p_correct, p_wrong, pct, p_best_streak, 1, now())
  on conflict (student_id, level_key) do update set
    completed   = pr.completed or excluded.completed,
    wrong       = case when excluded.correct >= pr.correct then excluded.wrong else pr.wrong end,
    correct     = greatest(pr.correct, excluded.correct),
    score_pct   = greatest(pr.score_pct, excluded.score_pct),
    best_streak = greatest(pr.best_streak, excluded.best_streak),
    attempts    = pr.attempts + 1,
    updated_at  = now();
end $$;

-- Saves a final exam attempt; only a better score replaces the stored one.
-- updated_at is the date of the best attempt (used as the certificate issue date).
create or replace function public.record_exam_result(p_correct int, p_total int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sid text := public.my_student_id();
  pct int;
  r   public.progress;
begin
  if sid is null then raise exception 'NOT_A_STUDENT'; end if;
  if p_total <> 30 or p_correct not between 0 and p_total then raise exception 'INVALID_RESULT'; end if;
  pct := round(100.0 * p_correct / p_total);

  insert into public.progress as pr
    (student_id, prog_day, book_day, level_key, completed, correct, wrong, score_pct, best_streak, attempts, updated_at)
  values
    (sid, 0, 0, 'final_exam', pct >= 80, p_correct, p_total - p_correct, pct, p_correct, 1, now())
  on conflict (student_id, level_key) do update set
    completed  = pr.completed or excluded.completed,
    correct    = case when excluded.score_pct > pr.score_pct then excluded.correct    else pr.correct    end,
    wrong      = case when excluded.score_pct > pr.score_pct then excluded.wrong      else pr.wrong      end,
    updated_at = case when excluded.score_pct > pr.score_pct then excluded.updated_at else pr.updated_at end,
    score_pct  = greatest(pr.score_pct, excluded.score_pct),
    attempts   = pr.attempts + 1
  returning * into r;

  return jsonb_build_object('best', r.score_pct, 'passed', r.completed, 'date', r.updated_at);
end $$;

-- Adds failed words (array of {w, e, t}); repeated fails increase fail_count
create or replace function public.add_fail_words(p_words jsonb, p_prog_day int, p_book_day int) returns void
language plpgsql security definer set search_path = public as $$
declare sid text := public.my_student_id();
begin
  if sid is null then raise exception 'NOT_A_STUDENT'; end if;
  if jsonb_typeof(p_words) <> 'array' or jsonb_array_length(p_words) > 60 then raise exception 'INVALID_WORDS'; end if;

  insert into public.fail_words as fw (student_id, word_kr, word_en, word_type, prog_day, book_day, fail_count, last_failed)
  select distinct on (x->>'w') sid, left(x->>'w', 60), left(x->>'e', 200), left(x->>'t', 20), p_prog_day, p_book_day, 1, now()
  from jsonb_array_elements(p_words) x
  where coalesce(x->>'w', '') <> '' and coalesce(x->>'e', '') <> ''
  on conflict (student_id, word_kr) do update set
    fail_count  = fw.fail_count + 1,
    word_en     = excluded.word_en,
    last_failed = now();
end $$;

-- Removes words the student has now mastered
create or replace function public.clear_fail_words(p_words text[]) returns void
language plpgsql security definer set search_path = public as $$
declare sid text := public.my_student_id();
begin
  if sid is null then raise exception 'NOT_A_STUDENT'; end if;
  delete from public.fail_words where student_id = sid and word_kr = any(p_words);
end $$;


-- ───────────────────────────────────────────────────
-- 9. ADMIN RPCs
-- ───────────────────────────────────────────────────
create or replace function public.set_active_cohort(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  update public.cohorts set active = false where active;
  if p_id is not null then
    update public.cohorts set active = true where id = p_id;
  end if;
end $$;

-- Gives admin access to an existing account (the person must have an account first:
-- either they registered in the app, or you added them in Authentication → Users)
create or replace function public.grant_admin(p_email text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_super_admin() then raise exception 'NOT_ALLOWED'; end if;
  if p_role not in ('super', 'academic', 'co-admin') then raise exception 'INVALID_ROLE'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.admins (user_id, email, name, role)
  values (v_uid, lower(trim(p_email)), trim(p_name), p_role)
  on conflict (user_id) do update set name = excluded.name, role = excluded.role;
end $$;

create or replace function public.revoke_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'NOT_ALLOWED'; end if;
  if p_user_id = auth.uid() then raise exception 'CANNOT_REMOVE_SELF'; end if;
  delete from public.admins where user_id = p_user_id;
end $$;


-- ───────────────────────────────────────────────────
-- 10. FUNCTION PERMISSIONS
-- ───────────────────────────────────────────────────
revoke execute on function public.is_student_id_available(text)          from public;
revoke execute on function public.login_email_for(text)                  from public;
revoke execute on function public.touch_last_seen()                      from public;
revoke execute on function public.record_level_result(int,int,int,int,int) from public;
revoke execute on function public.record_exam_result(int,int)            from public;
revoke execute on function public.add_fail_words(jsonb,int,int)          from public;
revoke execute on function public.clear_fail_words(text[])               from public;
revoke execute on function public.set_active_cohort(text)                from public;
revoke execute on function public.grant_admin(text,text,text)            from public;
revoke execute on function public.revoke_admin(uuid)                     from public;
revoke execute on function public.handle_new_user()                      from public;
revoke execute on function public.handle_user_email_change()             from public;

grant execute on function public.is_student_id_available(text)            to anon, authenticated;
grant execute on function public.login_email_for(text)                    to anon, authenticated;
grant execute on function public.touch_last_seen()                        to authenticated;
grant execute on function public.record_level_result(int,int,int,int,int) to authenticated;
grant execute on function public.record_exam_result(int,int)              to authenticated;
grant execute on function public.add_fail_words(jsonb,int,int)            to authenticated;
grant execute on function public.clear_fail_words(text[])                 to authenticated;
grant execute on function public.set_active_cohort(text)                  to authenticated;
grant execute on function public.grant_admin(text,text,text)              to authenticated;
grant execute on function public.revoke_admin(uuid)                       to authenticated;


-- ───────────────────────────────────────────────────
-- 11. ROW LEVEL SECURITY — remove the old "anyone can …" policies
-- ───────────────────────────────────────────────────
drop policy if exists "Anyone can read students"       on public.students;
drop policy if exists "Anyone can register"            on public.students;
drop policy if exists "Students can update own record" on public.students;
drop policy if exists "Anyone can read progress"       on public.progress;
drop policy if exists "Anyone can write progress"      on public.progress;
drop policy if exists "Anyone can update progress"     on public.progress;
drop policy if exists "Anyone can read fails"          on public.fail_words;
drop policy if exists "Anyone can write fails"         on public.fail_words;
drop policy if exists "Anyone can update fails"        on public.fail_words;
drop policy if exists "Anyone can delete fails"        on public.fail_words;

alter table public.students     enable row level security;
alter table public.progress     enable row level security;
alter table public.fail_words   enable row level security;
alter table public.cohorts      enable row level security;
alter table public.admins       enable row level security;
alter table public.app_settings enable row level security;

-- STUDENTS: read your own profile (admins read all); edit only safe columns of your own profile
drop policy if exists "students_select" on public.students;
create policy "students_select" on public.students for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "students_update_own" on public.students;
create policy "students_update_own" on public.students for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.students from anon, authenticated;
grant update (name, nickname, cohort, last_seen) on public.students to authenticated;

-- PROGRESS & FAIL WORDS: read your own (admins read all). Writes only via the RPCs above.
drop policy if exists "progress_select" on public.progress;
create policy "progress_select" on public.progress for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());

drop policy if exists "fail_words_select" on public.fail_words;
create policy "fail_words_select" on public.fail_words for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());

revoke insert, update, delete on public.progress   from anon, authenticated;
revoke insert, update, delete on public.fail_words from anon, authenticated;

-- COHORTS: everyone can read (needed on the sign-up form); admins manage
drop policy if exists "cohorts_select" on public.cohorts;
create policy "cohorts_select" on public.cohorts for select to anon, authenticated using (true);
drop policy if exists "cohorts_admin_write" on public.cohorts;
create policy "cohorts_admin_write" on public.cohorts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- APP SETTINGS: everyone can read (contact page, certificates); admins edit
drop policy if exists "settings_select" on public.app_settings;
create policy "settings_select" on public.app_settings for select to anon, authenticated using (true);
drop policy if exists "settings_admin_write" on public.app_settings;
create policy "settings_admin_write" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ADMINS: only admins can see the admin list; changes only via grant_admin / revoke_admin
drop policy if exists "admins_select" on public.admins;
create policy "admins_select" on public.admins for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.admins from anon, authenticated;


-- ───────────────────────────────────────────────────
-- 12. LEADERBOARD VIEW — public-safe columns only (no full names, IDs or emails)
--     Runs with the view owner's rights so it can rank everyone,
--     but only exposes display name, cohort and scores. Signed-in users only.
-- ───────────────────────────────────────────────────
drop view if exists public.leaderboard;
create view public.leaderboard with (security_invoker = false) as
select
  coalesce(nullif(s.nickname, ''), split_part(s.name, ' ', 1)) as display_name,
  s.cohort,
  (s.user_id = auth.uid())         as is_me,
  coalesce(p.levels_done, 0)       as levels_done,
  coalesce(p.words_mastered, 0)    as words_mastered,
  coalesce(p.avg_score, 0)         as avg_score,
  coalesce(p.best_streak, 0)       as best_streak
from public.students s
left join (
  select student_id,
         count(*) filter (where completed)       as levels_done,
         sum(correct)                            as words_mastered,
         avg(score_pct)::int                     as avg_score,
         max(best_streak)                        as best_streak
  from public.progress
  where level_key <> 'final_exam'
  group by student_id
) p on p.student_id = s.student_id
join auth.users u on u.id = s.user_id
where u.email_confirmed_at is not null;   -- only verified accounts appear

revoke all on public.leaderboard from anon;
grant select on public.leaderboard to authenticated;


-- ═══════════════════════════════════════════════════
-- 13. MAKE YOURSELF SUPER ADMIN  (edit and run once)
--
--   a) Supabase → Authentication → Users → "Add user" → "Create new user"
--      enter your admin email + a strong password, tick "Auto Confirm User".
--   b) Replace the email below with that email, then run just this statement:
--
-- insert into public.admins (user_id, email, name, role)
-- select id, lower(email), 'Alingilya Crispin Njewa', 'super'
-- from auth.users where lower(email) = lower('YOUR-ADMIN-EMAIL@example.com')
-- on conflict (user_id) do update set role = 'super';
--
--   After that, add Prof. Yoon (and others) from the app: Admin → Admin Access.
-- ═══════════════════════════════════════════════════
