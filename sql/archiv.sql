-- EAG-Förderungen – tägliche Archivierung der Förderliste
-- Einmal im Supabase-Dashboard → SQL Editor ausführen (kann gefahrlos mehrfach laufen).
-- Ergänzt sql/setup.sql, braucht sql/vorschlag-revision.sql NICHT.
--
-- Jeden Tag um 02:15 (Wien, Winterzeit; Sommerzeit 03:15):
--   1. foerder_archivieren(): Momentaufnahme ALLER Förderungen (auch Papierkorb) + Nutzerliste
--      in foerder_archiv – mit SHA-256 und dem Hash des Vortags (Kette).
--   2. Edge Function foerder-taeglich: legt die Sicherung als Datei in den privaten Storage-Bucket
--      "foerder-archiv", schickt sie als CSV (Excel) + JSON an die Admins (= Kopie außer Haus)
--      und vermerkt überfällige Fristen (wenn sql/vorschlag-revision.sql eingespielt ist).
-- Aufbewahrung: jeder Tag 90 Tage lang, danach der Monatserste für immer.
-- Wiederherstellen: in der App unter ☰ → Sicherungen (nur Admins), einzeln je Förderung.

-- ---------------------------------------------------------------
-- 1. Tabelle
-- ---------------------------------------------------------------
create table if not exists public.foerder_archiv (
  tag          date primary key,
  erstellt_am  timestamptz not null default now(),
  anzahl       int not null,
  daten        jsonb not null,               -- Array aller Zeilen aus foerderungen
  nutzer       jsonb not null default '[]'::jsonb,
  sha256       text not null,
  vorher_sha256 text,
  datei        text,                         -- Pfad im Bucket foerder-archiv, sobald abgelegt
  versendet_am timestamptz                   -- Mail an die Admins verschickt
);

-- Sicherungen sind unveränderbar. Erlaubt ist nur: Datei/Versand nachtragen und Löschen nach Ablauf.
create or replace function public.foerder_archiv_schutz()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.tag < (now() at time zone 'Europe/Vienna')::date - 90 and extract(day from old.tag) <> 1 then
      return old;
    end if;
    raise exception 'Sicherung vom % darf nicht gelöscht werden', old.tag;
  end if;
  if (to_jsonb(new) - array['datei', 'versendet_am']) is distinct from (to_jsonb(old) - array['datei', 'versendet_am']) then
    raise exception 'Sicherungen sind unveränderbar';
  end if;
  return new;
end $$;
drop trigger if exists foerder_archiv_schutz on public.foerder_archiv;
create trigger foerder_archiv_schutz before update or delete on public.foerder_archiv
  for each row execute function public.foerder_archiv_schutz();

-- ---------------------------------------------------------------
-- 2. Sicherung anlegen (einmal je Tag; weitere Aufrufe am selben Tag ändern nichts)
--    Erlaubt für: Admins in der App, die Edge Function (service_role) und den Cron-Job.
-- ---------------------------------------------------------------
create or replace function public.foerder_archivieren()
returns date language plpgsql security definer set search_path = '' as $$
declare
  heute date := (now() at time zone 'Europe/Vienna')::date;
  d jsonb; n jsonb; vorher text;
begin
  -- coalesce: ohne Rolle liefert foerder_rolle() NULL – „not (NULL or …)“ würde sonst nicht sperren
  if not (coalesce(public.foerder_rolle(), '') = 'admin'
          or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or current_setting('role', true) = 'service_role'
          or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then
    raise exception 'Nur Admins dürfen Sicherungen anlegen';
  end if;
  if exists (select 1 from public.foerder_archiv where tag = heute) then return heute; end if;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.erstellt_am, f.id), '[]'::jsonb) into d from public.foerderungen f;
  select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'name', u.name, 'rolle', u.rolle) order by u.email), '[]'::jsonb)
    into n from public.foerder_nutzer u;
  select a.sha256 into vorher from public.foerder_archiv a order by a.tag desc limit 1;

  insert into public.foerder_archiv (tag, anzahl, daten, nutzer, sha256, vorher_sha256)
  values (heute, jsonb_array_length(d), d, n,
          encode(sha256(convert_to(coalesce(vorher, '') || '|' || heute::text || '|' || d::text || '|' || n::text, 'UTF8')), 'hex'),
          vorher);

  -- Aufbewahrung: Tage älter als 90 Tage weg, Monatserste bleiben
  delete from public.foerder_archiv
   where tag < heute - 90 and extract(day from tag) <> 1;
  return heute;
end $$;

-- Übersicht für die App (ohne die großen Daten)
create or replace function public.foerder_archiv_liste()
returns table (tag date, erstellt_am timestamptz, anzahl int, sha256 text, vorher_sha256 text, datei text, versendet_am timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.tag, a.erstellt_am, a.anzahl, a.sha256, a.vorher_sha256, a.datei, a.versendet_am
  from public.foerder_archiv a
  where public.foerder_rolle() = 'admin'
  order by a.tag desc
$$;

-- Eine Sicherung vollständig (für Download und Vergleich, nur Admins)
create or replace function public.foerder_archiv_tag(p_tag date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select a.daten from public.foerder_archiv a
  where a.tag = p_tag and public.foerder_rolle() = 'admin'
$$;

-- Eine Förderung aus einer Sicherung zurückholen (überschreibt den heutigen Stand; im Verlauf sichtbar).
-- Gelöschte Förderungen werden neu angelegt – mit derselben id.
create or replace function public.foerder_archiv_wiederherstellen(p_tag date, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  alt jsonb;
  r public.foerderungen;
begin
  if public.foerder_rolle() is distinct from 'admin' then
    raise exception 'Nur Admins dürfen wiederherstellen';
  end if;
  select e into alt from public.foerder_archiv a, jsonb_array_elements(a.daten) e
   where a.tag = p_tag and (e ->> 'id')::uuid = p_id;
  if alt is null then raise exception 'In der Sicherung vom % gibt es diese Förderung nicht', p_tag; end if;
  r := jsonb_populate_record(null::public.foerderungen, alt);
  if exists (select 1 from public.foerderungen where id = p_id) then
    update public.foerderungen f set
      jahr = r.jahr, programm = r.programm, art = r.art, foerdercall = r.foerdercall, mitarbeiter = r.mitarbeiter,
      zieher = r.zieher, kunde = r.kunde, geburtsdatum = r.geburtsdatum, vollmacht = r.vollmacht, strasse = r.strasse,
      plz = r.plz, ort = r.ort, kg_gst = r.kg_gst, zaehlpunkt = r.zaehlpunkt, mail = r.mail, projekt_nr = r.projekt_nr,
      kwp = r.kwp, modulflaeche = r.modulflaeche, einspeisung = r.einspeisung, wr_leistung = r.wr_leistung,
      speicher = r.speicher, anbringung = r.anbringung, zeitplan = r.zeitplan, ticket = r.ticket, fpj = r.fpj,
      schritte = r.schritte, offene_punkte = r.offene_punkte, info = r.info, geloescht_am = r.geloescht_am
    where f.id = p_id;
  else
    insert into public.foerderungen select r.*;
  end if;
end $$;

alter table public.foerder_archiv enable row level security;
revoke all on public.foerder_archiv from anon, authenticated;     -- Zugriff nur über die Funktionen
revoke execute on function public.foerder_archiv_schutz() from public, anon, authenticated;
revoke execute on function public.foerder_archivieren(), public.foerder_archiv_liste(),
  public.foerder_archiv_tag(date), public.foerder_archiv_wiederherstellen(date, uuid) from public, anon;
grant execute on function public.foerder_archivieren(), public.foerder_archiv_liste(),
  public.foerder_archiv_tag(date), public.foerder_archiv_wiederherstellen(date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- 3. Privater Bucket für die Sicherungsdateien (keine Policies = nur service_role)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('foerder-archiv', 'foerder-archiv', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- 4. Zeitplan: jede Nacht 01:15 UTC = 02:15 Wien (Sommerzeit 03:15)
--    Erst die Sicherung in der Datenbank (funktioniert auch, wenn die Edge Function fehlt),
--    dann die Edge Function für Datei, Mail und Fristen.
-- ---------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'foerder-archiv';
select cron.schedule('foerder-archiv', '15 1 * * *', $job$
  select public.foerder_archivieren();
  select net.http_post(
    url := 'https://iuxklqcpexoziqxrohwa.supabase.co/functions/v1/foerder-taeglich',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);

-- Gleich die erste Sicherung anlegen
select public.foerder_archivieren();
