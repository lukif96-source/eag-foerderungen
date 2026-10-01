-- OeMAG-Mails automatisch auslesen – Datenbank-Teil. Wiederholbar ausführbar. Voraussetzung: sql/setup.sql.
--
--   foerderungen.eag_nr     Einreichungsnummer aus dem Portal (EAG00052982) – steht in jeder OeMAG-Mail
--   foerder_posteingang     jede gelesene Mail: was erkannt wurde, welche Förderung, was übernommen wurde
--   foerder_oemag_anwenden  übernimmt eine Änderung (nur Unterschiede, nie überschreiben) – im Verlauf als „OeMAG-Mail“
--   Cron alle 10 Minuten    Edge Function „oemag“ holt neue Mails aus dem Postfach (Microsoft Graph)

-- ---------------------------------------------------------------
-- 1. EAG-Nr. an der Förderung
-- ---------------------------------------------------------------
alter table public.foerderungen add column if not exists eag_nr text not null default '';
create index if not exists foerderungen_eag_nr_idx on public.foerderungen (eag_nr) where eag_nr <> '';

-- Wer hat geändert? Eine Übernahme aus einer Mail setzt foerder.von = 'OeMAG-Mail' (nur für diese Transaktion)
create or replace function public.foerder_ich()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(current_setting('foerder.von', true), ''),
    (select nullif(name, '') from public.foerder_nutzer where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    auth.jwt() ->> 'email',
    'System')
$$;

-- ---------------------------------------------------------------
-- 2. Posteingang
-- ---------------------------------------------------------------
create table if not exists public.foerder_posteingang (
  id             bigint generated always as identity primary key,
  message_id     text not null unique,                 -- Internet-Message-ID bzw. „eingefuegt:<sha256>“
  quelle         text not null default 'postfach' check (quelle in ('postfach', 'eingang', 'eingefuegt')),
  empfangen_am   timestamptz not null default now(),
  absender       text not null default '',
  betreff        text not null default '',
  text           text not null default '',
  sha256         text not null default '',
  art            text not null default 'unbekannt',
  sicher         boolean not null default false,
  erkannt        jsonb not null default '{}'::jsonb,   -- EAG-Nr., Zählpunkt, Ticket, Frist, Unterlagen, Grund …
  foerderung_id  uuid references public.foerderungen (id) on delete set null,
  zuordnung      text,                                 -- eag_nr | fpj | zaehlpunkt | mehrdeutig | hand
  kandidaten     uuid[] not null default '{}',
  automatisch    jsonb not null default '{}'::jsonb,
  vorschlag      jsonb not null default '{}'::jsonb,
  notizen        text[] not null default '{}',
  status         text not null default 'offen' check (status in ('offen', 'vorschlag', 'angewendet', 'erledigt', 'ignoriert')),
  bearbeitet_von text not null default '',
  bearbeitet_am  timestamptz,
  erstellt_am    timestamptz not null default now()
);
create index if not exists foerder_posteingang_status_idx on public.foerder_posteingang (status, empfangen_am desc);
create index if not exists foerder_posteingang_foerderung_idx on public.foerder_posteingang (foerderung_id);

-- Mailinhalt und Erkanntes sind Beleg: danach nur noch Status/Zuordnung änderbar, nie löschen
create or replace function public.foerder_posteingang_schutz()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Posteingang wird nicht gelöscht – „ignorieren“ statt löschen'; end if;
  if (new.message_id, new.text, new.betreff, new.absender, new.sha256, new.empfangen_am, new.erkannt)
     is distinct from (old.message_id, old.text, old.betreff, old.absender, old.sha256, old.empfangen_am, old.erkannt) then
    raise exception 'Mailinhalt ist unveränderlich';
  end if;
  return new;
end $$;
drop trigger if exists foerder_posteingang_schutz on public.foerder_posteingang;
create trigger foerder_posteingang_schutz before update or delete on public.foerder_posteingang
  for each row execute function public.foerder_posteingang_schutz();

-- ---------------------------------------------------------------
-- 3. Übernehmen: Unterschiede zusammenführen (wie anwenden() in js/oemag.js)
--    p_aenderung: { eag_nr, fpj, ticket, schritte: {…}, offene_punkte_plus, info_plus }
--    p_foerderung: bei Zuordnung von Hand; sonst die erkannte
-- ---------------------------------------------------------------
create or replace function public.foerder_oemag_anwenden(p_id bigint, p_aenderung jsonb, p_foerderung uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  pe public.foerder_posteingang;
  fid uuid;
  von text;
  ich text := public.foerder_ich();   -- vor dem Setzen von foerder.von lesen
  dienst boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role' or current_setting('role', true) = 'service_role'
                    or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'));
begin
  if not dienst and coalesce(public.foerder_rolle(), '') not in ('admin', 'bearbeiten') then
    raise exception 'Keine Berechtigung';
  end if;
  select * into pe from public.foerder_posteingang where id = p_id for update;
  if not found then raise exception 'Mail % nicht gefunden', p_id; end if;
  fid := coalesce(p_foerderung, pe.foerderung_id);
  if fid is null then raise exception 'Keine Förderung zugeordnet'; end if;
  von := case when dienst then 'OeMAG-Mail' else coalesce(ich, '?') || ' (OeMAG-Mail)' end;
  perform set_config('foerder.von', von, true);

  update public.foerderungen f set
    eag_nr = case when f.eag_nr = '' and coalesce(p_aenderung ->> 'eag_nr', '') <> '' then p_aenderung ->> 'eag_nr' else f.eag_nr end,
    fpj    = case when f.fpj = ''    and coalesce(p_aenderung ->> 'fpj', '') <> ''    then p_aenderung ->> 'fpj'    else f.fpj end,
    ticket = case when f.ticket = '' and coalesce(p_aenderung ->> 'ticket', '') <> '' then p_aenderung ->> 'ticket' else f.ticket end,
    schritte = f.schritte || coalesce(p_aenderung -> 'schritte', '{}'::jsonb),
    offene_punkte = case when coalesce(p_aenderung ->> 'offene_punkte_plus', '') <> '' and position(p_aenderung ->> 'offene_punkte_plus' in f.offene_punkte) = 0
                         then concat_ws(' · ', nullif(btrim(f.offene_punkte), ''), p_aenderung ->> 'offene_punkte_plus') else f.offene_punkte end,
    info = case when coalesce(p_aenderung ->> 'info_plus', '') <> '' and position(p_aenderung ->> 'info_plus' in f.info) = 0
                then concat_ws(' · ', nullif(btrim(f.info), ''), p_aenderung ->> 'info_plus') else f.info end
  where f.id = fid;
  if not found then raise exception 'Förderung nicht gefunden'; end if;

  update public.foerder_posteingang set
    foerderung_id = fid,
    zuordnung = case when p_foerderung is not null and p_foerderung is distinct from pe.foerderung_id then 'hand' else pe.zuordnung end,
    -- automatisch übernommen, aber noch ein Vorschlag offen → bleibt „vorschlag“; sonst erledigt
    status = case when dienst and pe.vorschlag <> '{}'::jsonb then 'vorschlag' else 'angewendet' end,
    bearbeitet_von = case when dienst then pe.bearbeitet_von else coalesce(ich, '') end,
    bearbeitet_am = case when dienst then pe.bearbeitet_am else now() end
  where id = p_id;
end $$;

-- ---------------------------------------------------------------
-- 4. Zugriff: lesen wie die Förderliste; eintragen (Mail einfügen) und bearbeiten: admin/bearbeiten
-- ---------------------------------------------------------------
alter table public.foerder_posteingang enable row level security;
revoke all on public.foerder_posteingang from anon, authenticated;
grant select, insert on public.foerder_posteingang to authenticated;
grant update (status, foerderung_id, zuordnung, bearbeitet_von, bearbeitet_am) on public.foerder_posteingang to authenticated;
grant usage, select on sequence public.foerder_posteingang_id_seq to authenticated;
grant all on public.foerder_posteingang to service_role;
grant usage, select on sequence public.foerder_posteingang_id_seq to service_role;
grant select on public.foerderungen to service_role;

drop policy if exists posteingang_lesen on public.foerder_posteingang;
drop policy if exists posteingang_einfuegen on public.foerder_posteingang;
drop policy if exists posteingang_bearbeiten on public.foerder_posteingang;
create policy posteingang_lesen on public.foerder_posteingang for select to authenticated
  using (public.foerder_rolle() in ('admin', 'bearbeiten', 'lesen'));
create policy posteingang_einfuegen on public.foerder_posteingang for insert to authenticated
  with check (public.foerder_rolle() in ('admin', 'bearbeiten') and quelle = 'eingefuegt');
create policy posteingang_bearbeiten on public.foerder_posteingang for update to authenticated
  using (public.foerder_rolle() in ('admin', 'bearbeiten')) with check (public.foerder_rolle() in ('admin', 'bearbeiten'));

revoke execute on function public.foerder_oemag_anwenden(bigint, jsonb, uuid) from public, anon;
grant execute on function public.foerder_oemag_anwenden(bigint, jsonb, uuid) to authenticated, service_role;
revoke execute on function public.foerder_posteingang_schutz() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Alle 10 Minuten Postfach abholen (Edge Function „oemag“; ohne Microsoft-Zugang tut sie nichts)
-- ---------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'foerder-oemag';
select cron.schedule('foerder-oemag', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://iuxklqcpexoziqxrohwa.supabase.co/functions/v1/oemag',
    body := '{"abholen": true}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
