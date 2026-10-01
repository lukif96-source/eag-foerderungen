-- =====================================================================
-- EAG-Förderungen v2 – relationales Modell mit Event Sourcing (Schema "eag")
--
-- Läuft NEBEN der bestehenden App: public.foerderungen bleibt die Eingabe, ein Trigger spiegelt
-- jede Änderung sofort nach eag.* (Strangler-Pattern). Ein Fehler beim Spiegeln wird in
-- eag.sync_fehler protokolliert und bricht das Speichern in der App NIE ab.
--
--   kunde ─< projekt ─< antrag ─< antrag_schritt   (Projektion, nur aus Ereignissen)
--                   │        └─< dokument
--                   └─< ereignis                    (unveränderlich, SHA-256-Kette je Projekt)
--   foerdercall ─< antrag        messtool_stand ── projekt.projekt_nr  (Messtool = andere Datenbank)
--
-- Der Status ist ein Enum, wird aber berechnet (eag.stand), nie gespeichert.
-- Fristen: eag.fristen() – dieselben Regeln wie js/ablauf.js (Paritätstest: tests/sql-paritaet.mjs).
-- Wiederholbar ausführbar. Voraussetzung: sql/setup.sql.
-- =====================================================================

create schema if not exists eag;
grant usage on schema eag to authenticated, service_role;

-- ---------------------------------------------------------------
-- 1. Typen
-- ---------------------------------------------------------------
do $$ begin
  create type eag.foerderart as enum ('pv', 'pv_speicher', 'speicher');
exception when duplicate_object then null; end $$;
do $$ begin
  create type eag.einspeisung as enum ('ueberschuss', 'volleinspeisung');
exception when duplicate_object then null; end $$;
-- Schritte, die mit Datum (oder „erledigt, Datum unbekannt“ = datum null) gesetzt werden.
-- „Name und Zählpunkt erfasst“ wird aus den Daten berechnet und ist kein gesetzter Schritt.
do $$ begin
  create type eag.schritt as enum (
    'projekt', 'ticket', 'eingereicht', 'nachforderung', 'nachgereicht',
    'vertrag_erhalten', 'vertrag_versendet', 'verlaengert_bis', 'inbetriebnahme', 'herkunftsnachweis',
    'rechnung', 'zahlung', 'abgeschlossen', 'ausgezahlt',
    'abgelehnt', 'zurueckgezogen', 'erloschen', 'nachforderung_abrechnung', 'nachgereicht_abrechnung');
exception when duplicate_object then null; end $$;
alter type eag.schritt add value if not exists 'nachforderung_abrechnung';
alter type eag.schritt add value if not exists 'nachgereicht_abrechnung';
-- Zustand = was als Nächstes passieren muss (bzw. wie es geendet hat)
do $$ begin
  create type eag.status as enum (
    'daten_fehlen', 'projekt_anlegen', 'ticket_ziehen', 'antrag_einreichen', 'nachreichen',
    'warten_vertrag', 'vertrag_versenden', 'in_betrieb_nehmen', 'econtrol_registrieren',
    'rechnung_hochladen', 'zahlung_hochladen', 'endabrechnung_einreichen', 'warten_auszahlung',
    'ausgezahlt', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'nachreichen_abrechnung');
exception when duplicate_object then null; end $$;
alter type eag.status add value if not exists 'nachreichen_abrechnung';
do $$ begin
  create type eag.phase as enum ('vorbereitung', 'call', 'zusage', 'umsetzung', 'abrechnung', 'fertig', 'beendet');
exception when duplicate_object then null; end $$;
do $$ begin
  create type eag.frist_art as enum ('ticket', 'antrag', 'nachforderung', 'inbetriebnahme', 'endabrechnung', 'nachforderung_abrechnung');
exception when duplicate_object then null; end $$;
alter type eag.frist_art add value if not exists 'nachforderung_abrechnung';
do $$ begin
  create type eag.frist_stufe as enum ('ueberfaellig', 'dringend', 'bald', 'ruhig', 'unbekannt');
exception when duplicate_object then null; end $$;
do $$ begin
  create type eag.dokument_art as enum ('vertrag', 'nachforderung', 'nachreichung', 'rechnung', 'zahlung',
    'fertigstellung', 'messprotokoll', 'endabrechnung', 'sonstiges');
exception when duplicate_object then null; end $$;
do $$ begin
  create type eag.ereignis_art as enum ('angelegt', 'feld', 'schritt_gesetzt', 'schritt_entfernt',
    'neu_angesucht', 'dokument', 'frist_verpasst', 'geloescht', 'wiederhergestellt');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 2. Tabellen
-- ---------------------------------------------------------------
create table if not exists eag.foerdercall (
  start      date primary key,                       -- Ticket-Tag
  ende       date not null check (ende >= start),    -- letzter Tag für den Antrag
  ticket_ab  time not null default '17:00',
  programm   text not null default 'EAG'
);
insert into eag.foerdercall (start, ende) values
  ('2026-04-23', '2026-05-11'), ('2026-06-16', '2026-06-30'), ('2026-10-08', '2026-10-22')
on conflict (start) do update set ende = excluded.ende;

create table if not exists eag.kunde (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  geburtsdatum  date,
  mail          text not null default '',
  vollmacht     text not null default '',
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now()
);

create table if not exists eag.projekt (
  id                  uuid primary key default gen_random_uuid(),
  kunde_id            uuid not null references eag.kunde (id) on delete restrict,
  projekt_nr          text not null default '',          -- SOLPRO-Projektnummer = Schlüssel zum Messtool (z. B. P260188)
  strasse             text not null default '',
  plz                 text not null default '',
  ort                 text not null default '',
  kg_gst              text not null default '',
  zaehlpunkt          text not null default '',          -- AT + 31 Zeichen
  zaehlpunkt_ok       boolean generated always as (zaehlpunkt ~ '^AT[0-9]{11}[0-9A-Z]{20}$') stored,
  kwp                 numeric(9, 2) check (kwp is null or kwp >= 0),
  modulflaeche        numeric(9, 2),
  einspeisung         eag.einspeisung,
  wr_leistung         text not null default '',
  speicher            text not null default '',
  anbringung          text not null default '',
  zeitplan            text not null default '',
  mitarbeiter         text not null default '',          -- Verkauf; Rolle „vertrieb“ sieht nur die eigenen
  messtool_projekt_id uuid,                               -- pv_projects.id im Messtool (andere Datenbank → kein FK)
  legacy_id           uuid unique,                        -- public.foerderungen.id
  erstellt_am         timestamptz not null default now(),
  geaendert_am        timestamptz not null default now()
);
create index if not exists projekt_kunde_idx on eag.projekt (kunde_id);
create index if not exists projekt_nr_idx on eag.projekt (projekt_nr) where projekt_nr <> '';
create index if not exists projekt_zp_idx on eag.projekt (zaehlpunkt) where zaehlpunkt <> '';

create table if not exists eag.antrag (
  id                uuid primary key default gen_random_uuid(),
  projekt_id        uuid not null references eag.projekt (id) on delete restrict,
  versuch           smallint not null default 1 check (versuch >= 1),
  vorgaenger_id     uuid references eag.antrag (id) on delete restrict,   -- abgelehnt → neu angesucht
  programm          text not null default 'EAG',
  art               eag.foerderart,
  call_start        date references eag.foerdercall (start) on update cascade,
  ticket_nr         text not null default '',
  fpj               text not null default '',          -- Projektnummer im EAG-Portal
  eag_nr            text not null default '',          -- Einreichungsnummer (EAG00052982), steht in jeder OeMAG-Mail
  zieher            text not null default '',          -- wer das Ticket gezogen hat (vorher: gewürfelt)
  zieher_geplant    text not null default '',          -- gewürfelt, falls jemand anderer gezogen hat
  ticket_uhrzeit    time,
  offene_punkte     text not null default '',
  info              text not null default '',
  geloescht_am      timestamptz,
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz not null default now(),
  unique (projekt_id, versuch)
);
alter table eag.antrag add column if not exists eag_nr text not null default '';
create index if not exists antrag_call_idx on eag.antrag (call_start);
create index if not exists antrag_eag_nr_idx on eag.antrag (eag_nr) where eag_nr <> '';
create index if not exists antrag_vorgaenger_idx on eag.antrag (vorgaenger_id);

-- Projektion: aktueller Stand je Schritt. Wird NUR vom Ereignis-Trigger geschrieben.
create table if not exists eag.antrag_schritt (
  antrag_id   uuid not null references eag.antrag (id) on delete cascade,
  schritt     eag.schritt not null,
  datum       date,                                   -- null = erledigt, Datum unbekannt (Altdaten „✓“)
  gesetzt_am  timestamptz not null default now(),
  primary key (antrag_id, schritt)
);

-- Ereignisse: unveränderlich, je Projekt mit SHA-256 verkettet
create table if not exists eag.ereignis (
  id           bigint generated always as identity primary key,
  projekt_id   uuid not null references eag.projekt (id) on delete restrict,
  antrag_id    uuid references eag.antrag (id) on delete restrict,
  zeit         timestamptz not null default clock_timestamp(),
  von          text not null default '',
  von_uid      uuid,
  quelle       text not null default 'app' check (quelle in ('app', 'legacy', 'system', 'import')),
  art          eag.ereignis_art not null,
  schritt      eag.schritt,
  feld         text not null default '',
  alt          jsonb,
  neu          jsonb,
  vorher_hash  bytea,
  hash         bytea not null
);
create index if not exists ereignis_projekt_idx on eag.ereignis (projekt_id, id);
create index if not exists ereignis_antrag_idx on eag.ereignis (antrag_id, id);
create unique index if not exists ereignis_frist_uidx on eag.ereignis (antrag_id, feld, (neu ->> 'datum'))
  where art = 'frist_verpasst';

create table if not exists eag.dokument (
  id               uuid primary key default gen_random_uuid(),
  antrag_id        uuid not null references eag.antrag (id) on delete restrict,
  art              eag.dokument_art not null,
  schritt          eag.schritt,
  pfad             text not null unique,               -- Storage: eag-dokumente/<antrag_id>/<datei>
  dateiname        text not null,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  groesse          bigint not null check (groesse > 0),
  mime             text not null default '',
  ersetzt          uuid references eag.dokument (id),
  hochgeladen_am   timestamptz not null default now(),
  hochgeladen_von  text not null default ''
);
create index if not exists dokument_antrag_idx on eag.dokument (antrag_id);

-- Messtool (eigenes Supabase-Projekt): Stand je Projektnummer, befüllt von der Edge Function messtool-abgleich
create table if not exists eag.messtool_stand (
  projekt_nr          text primary key,
  messtool_projekt_id uuid,
  abnahme_am          timestamptz,                    -- Protokoll abgeschlossen / Abnahme unterschrieben
  kwp_gemessen        numeric(9, 2),
  module              int,
  protokoll_pfad      text,
  abgerufen_am        timestamptz not null default now()
);

create table if not exists eag.sync_fehler (
  id         bigint generated always as identity primary key,
  zeit       timestamptz not null default now(),
  legacy_id  uuid,
  fehler     text not null,
  daten      jsonb
);

-- ---------------------------------------------------------------
-- 3. Rechte: wer darf welches Projekt sehen?
--    admin / bearbeiten / lesen → alles (Büro, Ticket-Zieher brauchen die ganze Liste)
--    vertrieb                   → nur Projekte, bei denen er als Mitarbeiter eingetragen ist
-- ---------------------------------------------------------------
alter table public.foerder_nutzer drop constraint if exists foerder_nutzer_rolle_check;
alter table public.foerder_nutzer add constraint foerder_nutzer_rolle_check
  check (rolle in ('admin', 'bearbeiten', 'lesen', 'vertrieb'));

create or replace function public.foerder_ich_name()
returns text language sql stable security definer set search_path = '' as $$
  select n.name from public.foerder_nutzer n
  join auth.users u on lower(u.email) = n.email
  where u.id = auth.uid() and u.created_at <= n.erstellt_am
$$;

create or replace function eag.darf_mitarbeiter(p_mitarbeiter text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.foerder_rolle()
    when 'admin' then true when 'bearbeiten' then true when 'lesen' then true
    when 'vertrieb' then lower(btrim(coalesce(p_mitarbeiter, ''))) = lower(btrim(coalesce(public.foerder_ich_name(), '-')))
    else false end
$$;
create or replace function eag.darf_projekt(p_projekt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select eag.darf_mitarbeiter(p.mitarbeiter) from eag.projekt p where p.id = p_projekt), false)
$$;
create or replace function eag.darf_antrag(p_antrag uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select eag.darf_projekt(a.projekt_id) from eag.antrag a where a.id = p_antrag), false)
$$;
create or replace function eag.darf_schreiben()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.foerder_rolle() in ('admin', 'bearbeiten'), false)
$$;

-- Die bestehende App kennt „vertrieb“ ebenfalls: nur eigene Kunden, nur lesen
drop policy if exists foerd_lesen on public.foerderungen;
create policy foerd_lesen on public.foerderungen for select to authenticated
  using (public.foerder_rolle() in ('admin', 'bearbeiten', 'lesen')
         or (public.foerder_rolle() = 'vertrieb' and lower(btrim(mitarbeiter)) = lower(btrim(coalesce(public.foerder_ich_name(), '-')))));

-- ---------------------------------------------------------------
-- 4. Ereignisse: Kette, Unveränderlichkeit, Projektion
-- ---------------------------------------------------------------
create or replace function eag.ereignis_hash(e eag.ereignis)
returns bytea language sql stable set search_path = '' as $$
  select sha256(convert_to(concat_ws('|',
    coalesce(encode(e.vorher_hash, 'hex'), ''), e.projekt_id::text, coalesce(e.antrag_id::text, ''),
    to_char(e.zeit at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), e.von, coalesce(e.von_uid::text, ''),
    e.quelle, e.art::text, coalesce(e.schritt::text, ''), e.feld,
    coalesce(e.alt::text, 'null'), coalesce(e.neu::text, 'null')), 'UTF8'))
$$;

create or replace function eag.ereignis_verketten()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('eag.ereignis:' || new.projekt_id::text, 0));
  new.zeit := clock_timestamp();
  if new.von = '' then new.von := coalesce(public.foerder_ich(), 'System'); end if;
  new.von_uid := coalesce(new.von_uid, auth.uid());
  select e.hash into new.vorher_hash from eag.ereignis e where e.projekt_id = new.projekt_id order by e.id desc limit 1;
  new.hash := eag.ereignis_hash(new);
  return new;
end $$;

create or replace function eag.unveraenderlich()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% ist unveränderlich: % ist nicht erlaubt', tg_table_name, tg_op;
end $$;

-- Projektion nachführen: Schritt gesetzt / entfernt
create or replace function eag.ereignis_anwenden()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.art = 'schritt_gesetzt' then
    insert into eag.antrag_schritt (antrag_id, schritt, datum, gesetzt_am)
    values (new.antrag_id, new.schritt, (new.neu ->> 'datum')::date, new.zeit)
    on conflict (antrag_id, schritt) do update set datum = excluded.datum, gesetzt_am = excluded.gesetzt_am;
  elsif new.art = 'schritt_entfernt' then
    delete from eag.antrag_schritt where antrag_id = new.antrag_id and schritt = new.schritt;
  end if;
  update eag.antrag set geaendert_am = new.zeit where id = new.antrag_id and new.art in ('schritt_gesetzt', 'schritt_entfernt');
  return null;
end $$;

drop trigger if exists ereignis_verketten on eag.ereignis;
create trigger ereignis_verketten before insert on eag.ereignis for each row execute function eag.ereignis_verketten();
drop trigger if exists ereignis_anwenden on eag.ereignis;
create trigger ereignis_anwenden after insert on eag.ereignis for each row execute function eag.ereignis_anwenden();
drop trigger if exists ereignis_sperre on eag.ereignis;
create trigger ereignis_sperre before update or delete on eag.ereignis for each row execute function eag.unveraenderlich();
drop trigger if exists ereignis_sperre_truncate on eag.ereignis;
create trigger ereignis_sperre_truncate before truncate on eag.ereignis for each statement execute function eag.unveraenderlich();
drop trigger if exists dokument_sperre on eag.dokument;
create trigger dokument_sperre before update or delete on eag.dokument for each row execute function eag.unveraenderlich();

-- Kette prüfen: erstes Ereignis, das nicht passt – oder null
create or replace function eag.kette_pruefen(p_projekt uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare e eag.ereignis; vorher bytea := null;
begin
  if not eag.darf_projekt(p_projekt) then raise exception 'Kein Zugriff'; end if;
  for e in select * from eag.ereignis where projekt_id = p_projekt order by id loop
    if e.vorher_hash is distinct from vorher or e.hash <> eag.ereignis_hash(e) then return e.id; end if;
    vorher := e.hash;
  end loop;
  return null;
end $$;

-- Projektion aus den Ereignissen komplett neu aufbauen (z. B. nach einer Wiederherstellung)
create or replace function eag.projektion_neu_aufbauen()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if public.foerder_rolle() is distinct from 'admin' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Nur Admins';
  end if;
  delete from eag.antrag_schritt;
  insert into eag.antrag_schritt (antrag_id, schritt, datum, gesetzt_am)
  select distinct on (e.antrag_id, e.schritt) e.antrag_id, e.schritt, (e.neu ->> 'datum')::date, e.zeit
  from eag.ereignis e
  where e.art in ('schritt_gesetzt', 'schritt_entfernt')
  order by e.antrag_id, e.schritt, e.id desc;
  -- zuletzt entfernte wieder raus
  delete from eag.antrag_schritt s using (
    select distinct on (antrag_id, schritt) antrag_id, schritt, art from eag.ereignis
    where art in ('schritt_gesetzt', 'schritt_entfernt') order by antrag_id, schritt, id desc) l
  where s.antrag_id = l.antrag_id and s.schritt = l.schritt and l.art = 'schritt_entfernt';
  get diagnostics n = row_count;
  return (select count(*) from eag.antrag_schritt)::int;
end $$;

-- ---------------------------------------------------------------
-- 5. Regeln (gleich wie js/ablauf.js)
-- ---------------------------------------------------------------
create or replace function eag.call_ende(p_start date)
returns date language sql stable set search_path = '' as $$
  select coalesce((select c.ende from eag.foerdercall c where c.start = p_start), p_start + 14)
$$;
create or replace function eag.plus_monate(p date, n int)
returns date language sql immutable set search_path = '' as $$
  select (p + make_interval(months => n))::date            -- 31.08. + 6 = 28./29.02. wie plusMonate()
$$;
create or replace function eag.frist_stufe(tage int)
returns eag.frist_stufe language sql immutable set search_path = '' as $$
  select case when tage is null then 'unbekannt' when tage < 0 then 'ueberfaellig'
              when tage <= 7 then 'dringend' when tage <= 30 then 'bald' else 'ruhig' end::eag.frist_stufe
$$;
-- Offener Call am Stichtag (für „neu ansuchen“)
create or replace function eag.offener_call(p_heute date)
returns date language sql stable set search_path = '' as $$
  select c.start from eag.foerdercall c where c.ende >= p_heute order by c.start limit 1
$$;

-- Reihenfolge der Hauptschritte (Index wie SCHRITTE in ablauf.js; 0 = Daten, berechnet)
create or replace function eag.schritt_nr(s eag.schritt)
returns int language sql immutable set search_path = '' as $$
  select case s when 'projekt' then 1 when 'ticket' then 2 when 'eingereicht' then 3 when 'vertrag_erhalten' then 4
    when 'vertrag_versendet' then 5 when 'inbetriebnahme' then 6 when 'herkunftsnachweis' then 7 when 'rechnung' then 8
    when 'zahlung' then 9 when 'abgeschlossen' then 10 when 'ausgezahlt' then 11 else null end
$$;

-- Stand eines Antrags am Stichtag: Status, Phase, erledigte Hauptschritte, nächster Schritt, Lücken
drop function if exists eag.stand(uuid, date) cascade;   -- Rückgabetyp kann sich ändern; Sichten werden unten neu angelegt
create or replace function eag.stand(p_antrag uuid, p_heute date default current_date,
  out status eag.status, out phase eag.phase, out erledigt boolean[], out naechster int, out hoechster int,
  out luecken int[], out nachforderung_offen boolean, out nachforderung_abrechnung_offen boolean,
  out daten_fehlen text[], out antrag_daten_fehlen text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  a eag.antrag; p eag.projekt; k eag.kunde;
  s jsonb;   -- schritt → datum oder "✓"
  ende text := null;
  i int;
  auto_neu int[] := array[0, 6, 7];   -- 0 = Daten (berechnet), 6/7 = neue Schritte (bei Altdaten keine Lücke)
  folge text[] := array['daten', 'projekt', 'ticket', 'eingereicht', 'vertrag_erhalten', 'vertrag_versendet',
                        'inbetriebnahme', 'herkunftsnachweis', 'rechnung', 'zahlung', 'abgeschlossen', 'ausgezahlt'];
  zustand text[] := array['daten_fehlen', 'projekt_anlegen', 'ticket_ziehen', 'antrag_einreichen', 'warten_vertrag',
                          'vertrag_versenden', 'in_betrieb_nehmen', 'econtrol_registrieren', 'rechnung_hochladen',
                          'zahlung_hochladen', 'endabrechnung_einreichen', 'warten_auszahlung'];
  phasen text[] := array['vorbereitung', 'vorbereitung', 'call', 'call', 'zusage', 'zusage', 'umsetzung', 'umsetzung',
                         'abrechnung', 'abrechnung', 'abrechnung', 'abrechnung'];
begin
  select * into a from eag.antrag where id = p_antrag;
  if not found then return; end if;
  select * into p from eag.projekt where id = a.projekt_id;
  select * into k from eag.kunde where id = p.kunde_id;
  select coalesce(jsonb_object_agg(x.schritt::text, coalesce(x.datum::text, '✓')), '{}'::jsonb) into s
    from eag.antrag_schritt x where x.antrag_id = p_antrag;

  -- Antragsdaten (Hinweis bis zum Einreichen)
  antrag_daten_fehlen := array[]::text[];
  if not (s ? 'eingereicht' or s ? 'ausgezahlt' or s ? 'abgelehnt' or s ? 'zurueckgezogen' or s ? 'erloschen') then
    if btrim(p.strasse) = '' then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'Straße'::text); end if;
    if btrim(p.plz) = '' then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'PLZ'::text); end if;
    if btrim(p.ort) = '' then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'Ort'::text); end if;
    if btrim(k.mail) = '' then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'Mail'::text); end if;
    if a.art = 'speicher' then
      if btrim(p.speicher) = '' then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'Speicher'::text); end if;
    elsif p.kwp is null then antrag_daten_fehlen := array_append(antrag_daten_fehlen, 'kWp'::text); end if;
  end if;

  -- Ausgezahlt schlägt alles
  if s ? 'ausgezahlt' then
    status := 'ausgezahlt'; phase := 'fertig';
    erledigt := array_fill(true, array[12]); naechster := -1; hoechster := 11; luecken := array[]::int[];
    nachforderung_offen := false; nachforderung_abrechnung_offen := false; daten_fehlen := array[]::text[];
    return;
  end if;

  if s ? 'abgelehnt' then ende := 'abgelehnt';
  elsif s ? 'zurueckgezogen' then ende := 'zurueckgezogen';
  elsif s ? 'erloschen' then ende := 'erloschen'; end if;

  -- Pflicht für das Ticket: Name + Zählpunkt – nur solange noch gebraucht
  daten_fehlen := array[]::text[];
  if ende is null
     and not (s ?| array['ticket', 'eingereicht', 'vertrag_erhalten', 'vertrag_versendet', 'inbetriebnahme',
                         'herkunftsnachweis', 'rechnung', 'zahlung', 'abgeschlossen'])
     and (a.call_start is null or eag.call_ende(a.call_start) >= p_heute) then
    if btrim(coalesce(k.name, '')) = '' then daten_fehlen := array_append(daten_fehlen, 'Kunde'::text); end if;
    if btrim(p.zaehlpunkt) = '' then daten_fehlen := array_append(daten_fehlen, 'Zählpunkt'::text); end if;
  end if;

  erledigt := array[]::boolean[];
  for i in 1 .. 12 loop
    erledigt := erledigt || (case when i = 1 then cardinality(daten_fehlen) = 0 else s ? folge[i] end);
  end loop;
  hoechster := -1;
  for i in 1 .. 12 loop if erledigt[i] then hoechster := i - 1; end if; end loop;
  naechster := -1;
  if ende is null then
    for i in hoechster + 2 .. 12 loop
      if not erledigt[i] then naechster := i - 1; exit; end if;
    end loop;
  end if;
  luecken := array[]::int[];
  for i in 1 .. hoechster loop
    if not erledigt[i] and not ((i - 1) = any (auto_neu)) then luecken := luecken || (i - 1); end if;
  end loop;
  nachforderung_offen := ende is null and s ? 'nachforderung' and not s ? 'nachgereicht' and not erledigt[5];
  nachforderung_abrechnung_offen := ende is null and s ? 'nachforderung_abrechnung' and not s ? 'nachgereicht_abrechnung';

  if ende is not null then status := ende::eag.status; phase := 'beendet';
  elsif nachforderung_offen then status := 'nachreichen'; phase := 'call';
  elsif nachforderung_abrechnung_offen then status := 'nachreichen_abrechnung'; phase := 'abrechnung';
  elsif naechster = -1 then status := 'ausgezahlt'; phase := 'fertig';
  else status := zustand[naechster + 1]::eag.status; phase := phasen[naechster + 1]::eag.phase;
  end if;
end $$;

-- Alle offenen Fristen am Stichtag, dringendste zuerst (gleich wie fristen() in ablauf.js)
create or replace function eag.fristen(p_antrag uuid, p_heute date default current_date)
returns table (art eag.frist_art, label text, datum date, tage int, stufe eag.frist_stufe, hinweis text, geschaetzt boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  a eag.antrag; p eag.projekt; st record;
  s jsonb; ibn date; frueh date; monate int; call_e date;
  aus jsonb := '[]'::jsonb;
begin
  select * into a from eag.antrag where id = p_antrag;
  if not found then return; end if;
  select * into p from eag.projekt where id = a.projekt_id;
  select * into st from eag.stand(p_antrag, p_heute);
  if st.phase in ('fertig', 'beendet') then return; end if;
  select coalesce(jsonb_object_agg(x.schritt::text, coalesce(x.datum::text, '✓')), '{}'::jsonb) into s
    from eag.antrag_schritt x where x.antrag_id = p_antrag;

  if a.call_start is not null and st.hoechster < 3 then
    if st.hoechster < 2 then
      aus := aus || jsonb_build_object('art', 'ticket', 'label', 'Ticket ziehen', 'datum', a.call_start, 'hinweis', 'nur an diesem Tag ab 17:00 Uhr', 'g', false);
    else
      aus := aus || jsonb_build_object('art', 'antrag', 'label', 'Antrag einreichen', 'datum', eag.call_ende(a.call_start), 'hinweis', 'sonst verfällt das Ticket', 'g', false);
    end if;
  end if;
  if st.nachforderung_offen and (s ->> 'nachforderung') ~ '^\d{4}-\d{2}-\d{2}$' then
    aus := aus || jsonb_build_object('art', 'nachforderung', 'label', 'Unterlagen nachreichen',
      'datum', (s ->> 'nachforderung')::date + 28, 'hinweis', '4 Wochen ab Nachforderung', 'g', false);
  end if;
  if st.nachforderung_abrechnung_offen and (s ->> 'nachforderung_abrechnung') ~ '^\d{4}-\d{2}-\d{2}$' then
    aus := aus || jsonb_build_object('art', 'nachforderung_abrechnung', 'label', 'Unterlagen zur Endabrechnung nachreichen',
      'datum', (s ->> 'nachforderung_abrechnung')::date + 28, 'hinweis', '4 Wochen ab Nachforderung, nur übers Portal', 'g', false);
  end if;
  if s ? 'vertrag_erhalten' then
    monate := case when p.kwp > 100 then 12 else 6 end;
    if (s ->> 'verlaengert_bis') ~ '^\d{4}-\d{2}-\d{2}$' then ibn := (s ->> 'verlaengert_bis')::date;
    elsif (s ->> 'vertrag_erhalten') ~ '^\d{4}-\d{2}-\d{2}$' then ibn := eag.plus_monate((s ->> 'vertrag_erhalten')::date, monate);
    end if;
    if a.call_start is not null then frueh := eag.plus_monate(eag.call_ende(a.call_start), monate); end if;
    if not s ? 'inbetriebnahme' and st.hoechster < 6 then
      if ibn is not null then
        aus := aus || jsonb_build_object('art', 'inbetriebnahme', 'label', 'In Betrieb nehmen', 'datum', ibn,
          'hinweis', case when s ? 'verlaengert_bis' and (s ->> 'verlaengert_bis') <> '✓' then 'verlängert' else '' end, 'g', false);
      elsif frueh is not null and frueh >= p_heute then
        aus := aus || jsonb_build_object('art', 'inbetriebnahme', 'label', 'In Betrieb nehmen', 'datum', frueh, 'hinweis', 'frühestens – Vertragsdatum unbekannt', 'g', true);
      else
        aus := aus || jsonb_build_object('art', 'inbetriebnahme', 'label', 'In Betrieb nehmen', 'datum', null, 'hinweis', 'Vertragsdatum unbekannt – Frist nicht berechenbar (Eintrag optional)', 'g', false);
      end if;
    end if;
    if st.hoechster < 10 then
      if ibn is not null then
        aus := aus || jsonb_build_object('art', 'endabrechnung', 'label', 'Endabrechnung einreichen', 'datum', eag.plus_monate(ibn, 6), 'hinweis', '6 Monate nach der Inbetriebnahme-Frist', 'g', false);
      elsif frueh is not null and eag.plus_monate(frueh, 6) >= p_heute then
        aus := aus || jsonb_build_object('art', 'endabrechnung', 'label', 'Endabrechnung einreichen', 'datum', eag.plus_monate(frueh, 6), 'hinweis', 'frühestens – Vertragsdatum unbekannt', 'g', true);
      else
        aus := aus || jsonb_build_object('art', 'endabrechnung', 'label', 'Endabrechnung einreichen', 'datum', null, 'hinweis', 'Vertragsdatum unbekannt – Frist nicht berechenbar (Eintrag optional)', 'g', false);
      end if;
    end if;
  end if;

  return query
    select (x ->> 'art')::eag.frist_art, x ->> 'label', (x ->> 'datum')::date,
           ((x ->> 'datum')::date - p_heute)::int, eag.frist_stufe(((x ->> 'datum')::date - p_heute)::int),
           x ->> 'hinweis', (x ->> 'g')::boolean
    from jsonb_array_elements(aus) x
    order by eag.frist_stufe(((x ->> 'datum')::date - p_heute)::int), (x ->> 'datum') nulls last;
end $$;

-- ---------------------------------------------------------------
-- 6. Schreiben über Funktionen – mit Zustandsprüfung
-- ---------------------------------------------------------------
-- Solange die bestehende App läuft: Was hier gesetzt wird, auch in public.foerderungen eintragen,
-- sonst würde der Spiegel es beim nächsten Speichern in der App wieder entfernen.
-- Nur für den aktuellen Antrag der Förderung (gleicher Call, höchster Versuch). Der Spiegel sieht danach
-- keinen Unterschied mehr und schreibt nichts doppelt.
create or replace function eag.legacy_zurueck(p_antrag uuid, p_schritt eag.schritt, p_setzen boolean, p_datum date)
returns void language plpgsql security definer set search_path = '' as $$
declare a eag.antrag; lid uuid;
begin
  select * into a from eag.antrag where id = p_antrag;
  select legacy_id into lid from eag.projekt where id = a.projekt_id;
  if lid is null then return; end if;
  if exists (select 1 from eag.antrag b where b.projekt_id = a.projekt_id and b.versuch > a.versuch) then return; end if;
  update public.foerderungen f
     set schritte = case when p_setzen then f.schritte || jsonb_build_object(p_schritt::text, coalesce(p_datum::text, '✓'))
                         else f.schritte - p_schritt::text end
   where f.id = lid and f.foerdercall is not distinct from a.call_start;
end $$;

create or replace function eag.schritt_setzen(p_antrag uuid, p_schritt eag.schritt, p_datum date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a eag.antrag; st record; nr int; heute date := (now() at time zone 'Europe/Vienna')::date;
  fehlt text;
begin
  if not eag.darf_schreiben() or not eag.darf_antrag(p_antrag) then raise exception 'Keine Berechtigung'; end if;
  select * into a from eag.antrag where id = p_antrag for update;
  if a.geloescht_am is not null then raise exception 'Antrag liegt im Papierkorb'; end if;
  select * into st from eag.stand(p_antrag, heute);
  if st.phase in ('fertig', 'beendet') and p_schritt not in ('abgelehnt', 'zurueckgezogen', 'erloschen', 'ausgezahlt') then
    raise exception 'Der Antrag ist abgeschlossen (%)', st.status;
  end if;
  if p_datum is not null and p_datum > heute and p_schritt <> 'verlaengert_bis' then
    raise exception 'Datum liegt in der Zukunft';
  end if;
  nr := eag.schritt_nr(p_schritt);
  if nr is not null then
    -- Keine Lücke: alle vorigen Hauptschritte müssen erledigt sein (außer den neuen 6/7)
    select string_agg(x, ', ') into fehlt from unnest(array['projekt', 'ticket', 'eingereicht', 'vertrag_erhalten', 'vertrag_versendet',
      'inbetriebnahme', 'herkunftsnachweis', 'rechnung', 'zahlung', 'abgeschlossen']) with ordinality as t(x, i)
    where i < nr and i not in (6, 7)
      and not exists (select 1 from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt::text = x);
    if fehlt is not null then raise exception 'Zuerst erledigen: %', fehlt; end if;
  end if;
  if p_schritt = 'ticket' then
    if cardinality(st.daten_fehlen) > 0 then raise exception 'Für das Ticket fehlt: %', array_to_string(st.daten_fehlen, ', '); end if;
    if a.call_start is not null and p_datum is not null and p_datum <> a.call_start then
      raise exception 'Tickets gibt es nur am Calltag (%)', to_char(a.call_start, 'DD.MM.YYYY');
    end if;
  elsif p_schritt = 'eingereicht' and a.call_start is not null and p_datum is not null
        and (p_datum < a.call_start or p_datum > eag.call_ende(a.call_start)) then
    raise exception 'Einreichen nur während des Calls (% – %)', to_char(a.call_start, 'DD.MM.'), to_char(eag.call_ende(a.call_start), 'DD.MM.YYYY');
  elsif p_schritt = 'nachgereicht' and not exists (select 1 from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = 'nachforderung') then
    raise exception 'Es gibt keine Nachforderung';
  end if;
  insert into eag.ereignis (projekt_id, antrag_id, art, schritt, alt, neu)
  select a.projekt_id, p_antrag, 'schritt_gesetzt', p_schritt,
         (select jsonb_build_object('datum', y.datum) from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = p_schritt),
         jsonb_build_object('datum', p_datum);
  perform eag.legacy_zurueck(p_antrag, p_schritt, true, p_datum);
end $$;

create or replace function eag.schritt_entfernen(p_antrag uuid, p_schritt eag.schritt)
returns void language plpgsql security definer set search_path = '' as $$
declare a eag.antrag; spaeter text;
begin
  if not eag.darf_schreiben() or not eag.darf_antrag(p_antrag) then raise exception 'Keine Berechtigung'; end if;
  select * into a from eag.antrag where id = p_antrag for update;
  if not exists (select 1 from eag.antrag_schritt where antrag_id = p_antrag and schritt = p_schritt) then return; end if;
  select string_agg(y.schritt::text, ', ') into spaeter from eag.antrag_schritt y
   where y.antrag_id = p_antrag and eag.schritt_nr(y.schritt) > coalesce(eag.schritt_nr(p_schritt), 99);
  if spaeter is not null then raise exception 'Erst spätere Schritte zurücknehmen: %', spaeter; end if;
  insert into eag.ereignis (projekt_id, antrag_id, art, schritt, alt)
  select a.projekt_id, p_antrag, 'schritt_entfernt', p_schritt, jsonb_build_object('datum', y.datum)
  from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = p_schritt;
  perform eag.legacy_zurueck(p_antrag, p_schritt, false, null);
end $$;

-- Abgelehnt → neuer Antrag (Versuch + 1) im offenen Call; der alte bleibt unverändert stehen
create or replace function eag.neu_ansuchen(p_antrag uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a eag.antrag; neu uuid; call date := eag.offener_call((now() at time zone 'Europe/Vienna')::date);
begin
  if not eag.darf_schreiben() or not eag.darf_antrag(p_antrag) then raise exception 'Keine Berechtigung'; end if;
  select * into a from eag.antrag where id = p_antrag for update;
  if not exists (select 1 from eag.antrag_schritt where antrag_id = p_antrag and schritt = 'abgelehnt') then
    raise exception 'Nur abgelehnte Anträge können neu ansuchen';
  end if;
  if call is null then raise exception 'Kein Fördercall mehr offen'; end if;
  if exists (select 1 from eag.antrag where vorgaenger_id = p_antrag) then raise exception 'Wurde bereits neu angesucht'; end if;
  insert into eag.antrag (projekt_id, versuch, vorgaenger_id, programm, art, call_start, fpj, offene_punkte, info)
  values (a.projekt_id, (select max(versuch) + 1 from eag.antrag where projekt_id = a.projekt_id), p_antrag,
          a.programm, a.art, call, a.fpj, a.offene_punkte, a.info)
  returning id into neu;
  insert into eag.ereignis (projekt_id, antrag_id, art, alt, neu)
  values (a.projekt_id, neu, 'neu_angesucht', jsonb_build_object('antrag', p_antrag, 'call', a.call_start), jsonb_build_object('call', call));
  -- Bestehende App wie neuAnsuchen() in js/ablauf.js umstellen (Call, Jahr, Verlauf der Ablehnungen)
  update public.foerderungen f set
    foerdercall = call, jahr = extract(year from call)::int, ticket = '',
    schritte = (f.schritte - array['ticket', 'ticket_uhrzeit', 'zieher_geplant', 'eingereicht', 'abgelehnt', 'nachforderung', 'nachgereicht'])
      || jsonb_build_object('frueher_abgelehnt', concat_ws(', ', nullif(btrim(f.schritte ->> 'frueher_abgelehnt'), ''), a.call_start::text))
      || case when (select y.datum from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = 'abgelehnt') is not null
              or nullif(btrim(f.schritte ->> 'frueher_abgelehnt_am'), '') is not null
         then jsonb_build_object('frueher_abgelehnt_am', concat_ws(', ',
                nullif(rpad(coalesce(f.schritte ->> 'frueher_abgelehnt_am', ''), 0), ''),
                (select string_agg(coalesce(nullif(btrim(x), ''), ''), ', ') from unnest(
                   (string_to_array(coalesce(f.schritte ->> 'frueher_abgelehnt_am', ''), ','))
                   [1:coalesce(cardinality(string_to_array(nullif(btrim(f.schritte ->> 'frueher_abgelehnt'), ''), ',')), 0)]) x),
                coalesce((select y.datum::text from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = 'abgelehnt'), '')))
         else '{}'::jsonb end
  from eag.projekt pr
  where pr.id = a.projekt_id and f.id = pr.legacy_id and f.foerdercall is not distinct from a.call_start;
  -- Das Portal-Projekt bleibt bestehen
  if exists (select 1 from eag.antrag_schritt where antrag_id = p_antrag and schritt = 'projekt') then
    insert into eag.ereignis (projekt_id, antrag_id, art, schritt, neu)
    select a.projekt_id, neu, 'schritt_gesetzt', 'projekt', jsonb_build_object('datum', y.datum)
    from eag.antrag_schritt y where y.antrag_id = p_antrag and y.schritt = 'projekt';
  end if;
  return neu;
end $$;

-- Feldänderungen protokollieren (Kunde, Projekt, Antrag)
create or replace function eag.feld_protokoll()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text; pid uuid; aid uuid;
begin
  if tg_table_name = 'kunde' then
    for pid in select id from eag.projekt where kunde_id = new.id loop
      for k in select jsonb_object_keys(n) loop
        continue when k in ('geaendert_am', 'erstellt_am');
        if (o -> k) is distinct from (n -> k) then
          insert into eag.ereignis (projekt_id, art, feld, alt, neu, quelle)
          values (pid, 'feld', 'kunde.' || k, o -> k, n -> k, coalesce(current_setting('eag.quelle', true), 'app'));
        end if;
      end loop;
    end loop;
    return new;
  end if;
  if tg_table_name = 'projekt' then pid := new.id; aid := null;
  else pid := new.projekt_id; aid := new.id; end if;
  for k in select jsonb_object_keys(n) loop
    continue when k in ('geaendert_am', 'erstellt_am', 'zaehlpunkt_ok');
    if (o -> k) is distinct from (n -> k) then
      insert into eag.ereignis (projekt_id, antrag_id, art, feld, alt, neu, quelle)
      values (pid, aid,
              case when k = 'geloescht_am' then (case when n -> k = 'null'::jsonb then 'wiederhergestellt' else 'geloescht' end)::eag.ereignis_art else 'feld' end,
              tg_table_name || '.' || k, o -> k, n -> k, coalesce(nullif(current_setting('eag.quelle', true), ''), 'app'));
    end if;
  end loop;
  return new;
end $$;

create or replace function eag.geaendert_stempel()
returns trigger language plpgsql set search_path = '' as $$
begin new.geaendert_am := now(); new.erstellt_am := old.erstellt_am; return new; end $$;

drop trigger if exists kunde_protokoll on eag.kunde;
create trigger kunde_protokoll after update on eag.kunde for each row execute function eag.feld_protokoll();
drop trigger if exists projekt_protokoll on eag.projekt;
create trigger projekt_protokoll after update on eag.projekt for each row execute function eag.feld_protokoll();
drop trigger if exists antrag_protokoll on eag.antrag;
create trigger antrag_protokoll after update on eag.antrag for each row execute function eag.feld_protokoll();
drop trigger if exists kunde_stempel on eag.kunde;
create trigger kunde_stempel before update on eag.kunde for each row execute function eag.geaendert_stempel();
drop trigger if exists projekt_stempel on eag.projekt;
create trigger projekt_stempel before update on eag.projekt for each row execute function eag.geaendert_stempel();
drop trigger if exists antrag_stempel on eag.antrag;
create trigger antrag_stempel before update on eag.antrag for each row execute function eag.geaendert_stempel();

-- Dokumente: protokollieren
create or replace function eag.dokument_protokoll()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.hochgeladen_am := now();
  new.hochgeladen_von := coalesce(public.foerder_ich(), 'System');
  insert into eag.ereignis (projekt_id, antrag_id, art, schritt, feld, neu)
  select a.projekt_id, new.antrag_id, 'dokument', new.schritt, new.art::text,
         jsonb_build_object('dokument', new.id, 'name', new.dateiname, 'sha256', new.sha256, 'groesse', new.groesse, 'ersetzt', new.ersetzt)
  from eag.antrag a where a.id = new.antrag_id;
  return new;
end $$;
drop trigger if exists dokument_protokoll on eag.dokument;
create trigger dokument_protokoll before insert on eag.dokument for each row execute function eag.dokument_protokoll();

-- ---------------------------------------------------------------
-- 7. Spiegel aus der bestehenden App (public.foerderungen → eag.*)
-- ---------------------------------------------------------------
create or replace function eag.legacy_wert(v jsonb, out vorhanden boolean, out datum date)
language plpgsql immutable set search_path = '' as $$
declare t text := btrim(coalesce(v #>> '{}', ''));
begin
  vorhanden := t <> '';
  datum := case when t ~ '^\d{4}-\d{2}-\d{2}$' then t::date else null end;
  if vorhanden and datum is null and t !~ '^(✓|✔)' then vorhanden := false; end if;   -- unbekannter Text: ignorieren
end $$;

create or replace function eag.legacy_art(t text)
returns eag.foerderart language sql immutable set search_path = '' as $$
  select case when t ~* 'pv' and t ~* 'speicher' then 'pv_speicher' when t ~* 'speicher' then 'speicher'
              when t ~* 'pv' then 'pv' else null end::eag.foerderart
$$;

create or replace function eag.legacy_sync_eins(f public.foerderungen)
returns void language plpgsql security definer set search_path = '' as $$
declare
  pid uuid; kid uuid; aid uuid; vorher uuid; i int; c date; am text[]; calls text[];
  sch eag.schritt; lw record; alt eag.antrag_schritt;
  zp text := upper(regexp_replace(coalesce(f.zaehlpunkt, ''), '\s', '', 'g'));
begin
  perform set_config('eag.quelle', 'legacy', true);
  if zp ~ '^[0-9]{11}[0-9A-Z]{20}$' then zp := 'AT' || zp; end if;

  -- Kunde + Projekt
  select id, kunde_id into pid, kid from eag.projekt where legacy_id = f.id;
  if pid is null then
    insert into eag.kunde (name, geburtsdatum, mail, vollmacht) values (f.kunde, f.geburtsdatum, f.mail, f.vollmacht) returning id into kid;
    insert into eag.projekt (kunde_id, projekt_nr, strasse, plz, ort, kg_gst, zaehlpunkt, kwp, modulflaeche, einspeisung,
                             wr_leistung, speicher, anbringung, zeitplan, mitarbeiter, legacy_id)
    values (kid, btrim(f.projekt_nr), f.strasse, f.plz, f.ort, f.kg_gst, zp, f.kwp, f.modulflaeche,
            case when f.einspeisung ilike 'ü%' or f.einspeisung ilike 'ue%' then 'ueberschuss'
                 when f.einspeisung ilike 'v%' then 'volleinspeisung' end::eag.einspeisung,
            f.wr_leistung, f.speicher, f.anbringung, f.zeitplan, f.mitarbeiter, f.id)
    returning id into pid;
    insert into eag.ereignis (projekt_id, art, neu, von, quelle) values (pid, 'angelegt', jsonb_build_object('legacy_id', f.id), f.erstellt_von, 'legacy');
  else
    update eag.kunde set name = f.kunde, geburtsdatum = f.geburtsdatum, mail = f.mail, vollmacht = f.vollmacht
     where id = kid and (name, geburtsdatum, mail, vollmacht) is distinct from (f.kunde, f.geburtsdatum, f.mail, f.vollmacht);
    update eag.projekt set projekt_nr = btrim(f.projekt_nr), strasse = f.strasse, plz = f.plz, ort = f.ort, kg_gst = f.kg_gst,
      zaehlpunkt = zp, kwp = f.kwp, modulflaeche = f.modulflaeche,
      einspeisung = case when f.einspeisung ilike 'ü%' or f.einspeisung ilike 'ue%' then 'ueberschuss'
                         when f.einspeisung ilike 'v%' then 'volleinspeisung' end::eag.einspeisung,
      wr_leistung = f.wr_leistung, speicher = f.speicher, anbringung = f.anbringung, zeitplan = f.zeitplan, mitarbeiter = f.mitarbeiter
     where id = pid and (projekt_nr, strasse, plz, ort, kg_gst, zaehlpunkt, kwp, modulflaeche, wr_leistung, speicher, anbringung, zeitplan, mitarbeiter)
       is distinct from (btrim(f.projekt_nr), f.strasse, f.plz, f.ort, f.kg_gst, zp, f.kwp, f.modulflaeche, f.wr_leistung, f.speicher, f.anbringung, f.zeitplan, f.mitarbeiter);
  end if;

  if f.foerdercall is not null then
    insert into eag.foerdercall (start, ende) values (f.foerdercall, f.foerdercall + 14) on conflict (start) do nothing;
  end if;

  -- Frühere, abgelehnte Ansuchen (frueher_abgelehnt / frueher_abgelehnt_am), falls noch nicht vorhanden
  calls := string_to_array(regexp_replace(coalesce(f.schritte ->> 'frueher_abgelehnt', ''), '\s', '', 'g'), ',');
  am := string_to_array(regexp_replace(coalesce(f.schritte ->> 'frueher_abgelehnt_am', ''), '\s', '', 'g'), ',');
  if calls is not null then
    for i in 1 .. cardinality(calls) loop
      continue when calls[i] !~ '^\d{4}-\d{2}-\d{2}$';
      c := calls[i]::date;
      continue when exists (select 1 from eag.antrag where projekt_id = pid and call_start = c);
      insert into eag.foerdercall (start, ende) values (c, c + 14) on conflict (start) do nothing;
      select id into vorher from eag.antrag where projekt_id = pid order by versuch desc limit 1;
      insert into eag.antrag (projekt_id, versuch, vorgaenger_id, programm, art, call_start, fpj)
      values (pid, coalesce((select max(versuch) from eag.antrag where projekt_id = pid), 0) + 1, vorher, f.programm, eag.legacy_art(f.art), c, f.fpj)
      returning id into aid;
      insert into eag.ereignis (projekt_id, antrag_id, art, schritt, neu, von, quelle)
      values (pid, aid, 'schritt_gesetzt', 'abgelehnt',
              jsonb_build_object('datum', case when am is not null and am[i] ~ '^\d{4}-\d{2}-\d{2}$' then am[i] end), f.geaendert_von, 'legacy');
    end loop;
  end if;

  -- Aktueller Antrag = der zum Call der Förderung (neuer Call → neuer Versuch)
  select id into aid from eag.antrag where projekt_id = pid and call_start is not distinct from f.foerdercall order by versuch desc limit 1;
  if aid is null then
    select id into vorher from eag.antrag where projekt_id = pid order by versuch desc limit 1;
    insert into eag.antrag (projekt_id, versuch, vorgaenger_id, programm, art, call_start)
    values (pid, coalesce((select max(versuch) from eag.antrag where projekt_id = pid), 0) + 1, vorher, f.programm, eag.legacy_art(f.art), f.foerdercall)
    returning id into aid;
  end if;
  update eag.antrag set programm = f.programm, art = eag.legacy_art(f.art), ticket_nr = f.ticket, fpj = f.fpj,
    eag_nr = coalesce(to_jsonb(f) ->> 'eag_nr', ''),   -- Spalte kommt aus sql/oemag.sql
    zieher = f.zieher, zieher_geplant = coalesce(f.schritte ->> 'zieher_geplant', ''),
    ticket_uhrzeit = case when (f.schritte ->> 'ticket_uhrzeit') ~ '^\d{2}:\d{2}(:\d{2})?$' then (f.schritte ->> 'ticket_uhrzeit')::time end,
    offene_punkte = f.offene_punkte, info = f.info, geloescht_am = f.geloescht_am
  where id = aid and (programm, art, ticket_nr, fpj, eag_nr, zieher, zieher_geplant, offene_punkte, info, geloescht_am)
    is distinct from (f.programm, eag.legacy_art(f.art), f.ticket, f.fpj, coalesce(to_jsonb(f) ->> 'eag_nr', ''), f.zieher, coalesce(f.schritte ->> 'zieher_geplant', ''),
                      f.offene_punkte, f.info, f.geloescht_am);

  -- Schritte: Unterschiede als Ereignisse
  foreach sch in array enum_range(null::eag.schritt) loop
    select * into lw from eag.legacy_wert(f.schritte -> sch::text);
    select * into alt from eag.antrag_schritt where antrag_id = aid and schritt = sch;
    if lw.vorhanden and (alt.antrag_id is null or alt.datum is distinct from lw.datum) then
      insert into eag.ereignis (projekt_id, antrag_id, art, schritt, alt, neu, von, quelle)
      values (pid, aid, 'schritt_gesetzt', sch, case when alt.antrag_id is not null then jsonb_build_object('datum', alt.datum) end,
              jsonb_build_object('datum', lw.datum), f.geaendert_von, 'legacy');
    elsif not lw.vorhanden and alt.antrag_id is not null then
      insert into eag.ereignis (projekt_id, antrag_id, art, schritt, alt, von, quelle)
      values (pid, aid, 'schritt_entfernt', sch, jsonb_build_object('datum', alt.datum), f.geaendert_von, 'legacy');
    end if;
  end loop;
end $$;

-- Trigger: darf das Speichern in der App NIE verhindern
create or replace function eag.legacy_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'DELETE' then
      update eag.antrag a set geloescht_am = coalesce(a.geloescht_am, now())
        from eag.projekt p where p.legacy_id = old.id and a.projekt_id = p.id;
    else
      perform eag.legacy_sync_eins(new);
    end if;
  exception when others then
    insert into eag.sync_fehler (legacy_id, fehler, daten)
    values (coalesce(new.id, old.id), sqlerrm, to_jsonb(coalesce(new, old)));
  end;
  return null;
end $$;
drop trigger if exists eag_spiegel on public.foerderungen;
create trigger eag_spiegel after insert or update or delete on public.foerderungen
  for each row execute function eag.legacy_trigger();

-- Einmalige Übernahme aller bestehenden Förderungen
create or replace function eag.migrieren()
returns table (uebernommen int, fehler int) language plpgsql security definer set search_path = '' as $$
declare f public.foerderungen; ok int := 0; err int := 0;
begin
  if public.foerder_rolle() is distinct from 'admin' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Nur Admins';
  end if;
  for f in select * from public.foerderungen order by erstellt_am loop
    begin
      perform eag.legacy_sync_eins(f); ok := ok + 1;
    exception when others then
      err := err + 1;
      insert into eag.sync_fehler (legacy_id, fehler, daten) values (f.id, sqlerrm, to_jsonb(f));
    end;
  end loop;
  return query select ok, err;
end $$;

-- ---------------------------------------------------------------
-- 8. Lesesicht für Dashboards (RLS greift über security_invoker)
-- ---------------------------------------------------------------
create or replace view eag.antrag_stand with (security_invoker = true) as
select a.id, a.projekt_id, a.versuch, a.vorgaenger_id, a.programm, a.art, a.call_start,
       eag.call_ende(a.call_start) as call_ende,
       a.ticket_nr, a.fpj, a.eag_nr, a.zieher, a.zieher_geplant, a.ticket_uhrzeit, a.offene_punkte, a.info, a.geloescht_am, a.geaendert_am,
       k.name as kunde, k.mail, p.projekt_nr, p.strasse, p.plz, p.ort, p.zaehlpunkt, p.zaehlpunkt_ok, p.kwp, p.speicher, p.mitarbeiter,
       st.status, st.phase, st.erledigt, st.naechster, st.hoechster, st.luecken, st.nachforderung_offen,
       st.daten_fehlen, st.antrag_daten_fehlen,
       (select jsonb_agg(jsonb_build_object('schritt', x.schritt, 'datum', x.datum) order by x.schritt)
          from eag.antrag_schritt x where x.antrag_id = a.id) as schritte,
       f.art as frist_art, f.label as frist_label, f.datum as frist_datum, f.tage as frist_tage, f.stufe as frist_stufe,
       f.geschaetzt as frist_geschaetzt,
       m.abnahme_am as messtool_abnahme_am, m.kwp_gemessen as messtool_kwp
from eag.antrag a
join eag.projekt p on p.id = a.projekt_id
join eag.kunde k on k.id = p.kunde_id
cross join lateral eag.stand(a.id, (now() at time zone 'Europe/Vienna')::date) st
left join lateral (select * from eag.fristen(a.id, (now() at time zone 'Europe/Vienna')::date) limit 1) f on true
left join eag.messtool_stand m on m.projekt_nr = p.projekt_nr and p.projekt_nr <> '';

-- Alle offenen Fristen (Zeitachse)
create or replace view eag.frist_offen with (security_invoker = true) as
select a.id as antrag_id, k.name as kunde, f.*
from eag.antrag a
join eag.projekt p on p.id = a.projekt_id
join eag.kunde k on k.id = p.kunde_id
cross join lateral eag.fristen(a.id, (now() at time zone 'Europe/Vienna')::date) f
where a.geloescht_am is null;

-- ---------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------
alter table eag.foerdercall    enable row level security;
alter table eag.kunde          enable row level security;
alter table eag.projekt        enable row level security;
alter table eag.antrag         enable row level security;
alter table eag.antrag_schritt enable row level security;
alter table eag.ereignis       enable row level security;
alter table eag.dokument       enable row level security;
alter table eag.messtool_stand enable row level security;
alter table eag.sync_fehler    enable row level security;

revoke all on all tables in schema eag from anon, authenticated;
grant select on eag.foerdercall, eag.kunde, eag.projekt, eag.antrag, eag.antrag_schritt, eag.ereignis, eag.dokument,
  eag.messtool_stand, eag.antrag_stand, eag.frist_offen to authenticated;
grant insert, update on eag.kunde, eag.projekt to authenticated;
grant update (offene_punkte, info, zieher, ticket_nr, fpj, art, geloescht_am) on eag.antrag to authenticated;
grant insert on eag.dokument to authenticated;
grant select on eag.sync_fehler to authenticated;
grant all on all tables in schema eag to service_role;

do $$ declare t text; begin
  foreach t in array array['foerdercall', 'kunde', 'projekt', 'antrag', 'antrag_schritt', 'ereignis', 'dokument', 'messtool_stand', 'sync_fehler'] loop
    execute format('drop policy if exists lesen on eag.%I', t);
    execute format('drop policy if exists schreiben on eag.%I', t);
    execute format('drop policy if exists anlegen on eag.%I', t);
  end loop;
end $$;

create policy lesen on eag.foerdercall for select to authenticated using (public.foerder_rolle() is not null);
create policy lesen on eag.kunde for select to authenticated
  using (exists (select 1 from eag.projekt p where p.kunde_id = kunde.id and eag.darf_mitarbeiter(p.mitarbeiter)));
create policy schreiben on eag.kunde for update to authenticated using (eag.darf_schreiben()) with check (eag.darf_schreiben());
create policy anlegen on eag.kunde for insert to authenticated with check (eag.darf_schreiben());
create policy lesen on eag.projekt for select to authenticated using (eag.darf_mitarbeiter(mitarbeiter));
create policy schreiben on eag.projekt for update to authenticated using (eag.darf_schreiben()) with check (eag.darf_schreiben());
create policy anlegen on eag.projekt for insert to authenticated with check (eag.darf_schreiben());
create policy lesen on eag.antrag for select to authenticated using (eag.darf_projekt(projekt_id));
create policy schreiben on eag.antrag for update to authenticated using (eag.darf_schreiben() and eag.darf_projekt(projekt_id))
  with check (eag.darf_schreiben() and eag.darf_projekt(projekt_id));
create policy lesen on eag.antrag_schritt for select to authenticated using (eag.darf_antrag(antrag_id));
create policy lesen on eag.ereignis for select to authenticated using (eag.darf_projekt(projekt_id));
create policy lesen on eag.dokument for select to authenticated using (eag.darf_antrag(antrag_id));
create policy anlegen on eag.dokument for insert to authenticated with check (eag.darf_schreiben() and eag.darf_antrag(antrag_id));
create policy lesen on eag.messtool_stand for select to authenticated
  using (exists (select 1 from eag.projekt p where p.projekt_nr = messtool_stand.projekt_nr and eag.darf_mitarbeiter(p.mitarbeiter)));
create policy lesen on eag.sync_fehler for select to authenticated using (public.foerder_rolle() = 'admin');

revoke execute on all functions in schema eag from public, anon;
revoke execute on function eag.legacy_zurueck(uuid, eag.schritt, boolean, date) from authenticated;
grant execute on function eag.schritt_setzen(uuid, eag.schritt, date), eag.schritt_entfernen(uuid, eag.schritt),
  eag.neu_ansuchen(uuid), eag.kette_pruefen(uuid), eag.stand(uuid, date), eag.fristen(uuid, date),
  eag.call_ende(date), eag.plus_monate(date, int), eag.frist_stufe(int), eag.offener_call(date), eag.schritt_nr(eag.schritt),
  eag.darf_mitarbeiter(text), eag.darf_projekt(uuid), eag.darf_antrag(uuid), eag.darf_schreiben(),
  eag.projektion_neu_aufbauen(), eag.migrieren(), eag.ereignis_hash(eag.ereignis) to authenticated;
grant execute on all functions in schema eag to service_role;
revoke execute on function eag.legacy_sync_eins(public.foerderungen), eag.legacy_trigger(), eag.ereignis_verketten(),
  eag.ereignis_anwenden(), eag.feld_protokoll(), eag.dokument_protokoll() from authenticated;
grant execute on function public.foerder_ich_name() to authenticated;
revoke execute on function public.foerder_ich_name() from public, anon;

-- ---------------------------------------------------------------
-- 10. Belege im Storage: Bucket eag-dokumente, Ordner = antrag_id
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('eag-dokumente', 'eag-dokumente', false) on conflict (id) do nothing;
drop policy if exists eag_dokumente_lesen on storage.objects;
drop policy if exists eag_dokumente_anlegen on storage.objects;
create policy eag_dokumente_lesen on storage.objects for select to authenticated
  using (bucket_id = 'eag-dokumente' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and eag.darf_antrag(((storage.foldername(name))[1])::uuid));
create policy eag_dokumente_anlegen on storage.objects for insert to authenticated
  with check (bucket_id = 'eag-dokumente' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and eag.darf_schreiben() and eag.darf_antrag(((storage.foldername(name))[1])::uuid));
-- kein update/delete: Belege werden ersetzt, nicht überschrieben
