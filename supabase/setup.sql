-- ============================================================
--  Best School Guide Sikar — database setup
--  Run this whole file once in Supabase -> SQL Editor -> Run.
-- ============================================================

-- 1) The blog table
create table if not exists blog_posts (
  id          bigint generated always as identity primary key,
  title       text not null,
  category    text not null default 'Parenting',
  author      text not null default 'Editorial',
  body        text not null,
  image_url   text,
  status      text not null default 'draft',   -- 'draft' or 'published'
  source_name text,
  source_url  text,
  created_at  timestamptz not null default now()
);

-- 2) Row-Level Security: the public site (anon key) may ONLY read
--    PUBLISHED posts. It cannot insert, edit, delete, or see drafts.
--    All writing is done server-side by the Edge Functions using the
--    service_role key, which bypasses RLS and is never in the website.
alter table blog_posts enable row level security;

drop policy if exists "public reads published posts" on blog_posts;
create policy "public reads published posts"
  on blog_posts for select
  using ( status = 'published' );

-- (No insert/update/delete policies for anon => the public site
--  physically cannot write to this table. Good.)

-- 3) Schedule the daily draft generator (09:00 IST = 03:30 UTC).
--    Requires the pg_cron and pg_net extensions (enable them under
--    Database -> Extensions if this errors).
--    Replace YOUR-PROJECT-REF with your project ref.
select cron.schedule(
  'daily-blog-draft',
  '30 3 * * *',
  $$
  select net.http_post(
    url := 'https://axswincjhsbwqgfgdicn.functions.supabase.co/generate-blog-draft',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);

-- To change the time later:  select cron.unschedule('daily-blog-draft');  then re-run above.
-- To see scheduled jobs:      select * from cron.job;
