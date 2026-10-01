-- Platzhalter für die Teile, die Supabase mitbringt (nur für Tests mit einem normalen Postgres)
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', (select email from auth.users where id = auth.uid())) $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create schema if not exists cron;
create table if not exists cron.job (jobid serial, jobname text, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create or replace function cron.unschedule(i int) returns bool language sql as $$ delete from cron.job where jobid = i returning true $$;
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'l.fischereder@solpro.at', now() - interval '1 day') on conflict do nothing;
