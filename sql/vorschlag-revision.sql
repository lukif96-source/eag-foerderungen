-- VORSCHLAG – noch NICHT in Supabase ausgeführt. Erst nach dem Call (22.10.2026) einspielen.
-- Revisionssicheres Protokoll für EAG-Förderungen, ergänzt sql/setup.sql.
--
-- Was es bringt (foerder_verlauf bleibt für die Anzeige, wie er ist):
--   1. foerder_ereignisse: nur anhängen. UPDATE, DELETE, TRUNCATE sind gesperrt – auch für Admins.
--   2. Jeder Schritt einzeln: "ticket gesetzt 2026-10-08" statt eines großen JSON-Diffs.
--   3. Hash-Kette je Förderung: jedes Ereignis enthält den Hash des vorigen.
--      Eine nachträgliche Änderung direkt in der Datenbank bricht die Kette → foerder_kette_pruefen().
--   4. Endgültiges Löschen einer Förderung löscht das Protokoll NICHT mehr mit (kein ON DELETE CASCADE).
--   5. foerder_dateien: Belege (Vertrag, Rechnung, Zahlung …) mit SHA-256, ersetzen statt überschreiben.
--   6. Verpasste Fristen: eindeutiger Index, damit ein täglicher Lauf jede Frist genau einmal protokolliert.
--
-- Grenze: Wer Superuser-Zugriff auf die Datenbank hat, kann die ganze Kette neu rechnen.
-- Dagegen hilft nur ein Anker außerhalb: den letzten Hash je Tag wegschreiben (siehe docs/BLUEPRINT.md).

-- ---------------------------------------------------------------
-- 1. Ereignisse (nur anhängen)
-- ---------------------------------------------------------------
create table if not exists public.foerder_ereignisse (
  id            bigint generated always as identity primary key,
  foerderung_id uuid not null,              -- bewusst ohne Fremdschlüssel: überlebt das Löschen
  zeit          timestamptz not null default clock_timestamp(),
  von           text not null default '',   -- Anzeigename (foerder_ich)
  von_uid       uuid,                       -- auth.uid(), null bei System/Import
  art           text not null check (art in (
                  'angelegt', 'feld', 'schritt_gesetzt', 'schritt_entfernt',
                  'papierkorb', 'wiederhergestellt', 'endgueltig_geloescht',
                  'datei', 'datei_ersetzt', 'frist_verpasst')),
  schluessel    text not null default '',   -- Feld- bzw. Schritt-Name, bei Fristen die Frist-Art
  alt           jsonb,
  neu           jsonb,
  vorher_hash   bytea,
  hash          bytea not null
);
create index if not exists foerder_ereignisse_fid_idx on public.foerder_ereignisse (foerderung_id, id);
-- Eine verpasste Frist (Art + Datum) wird je Förderung nur einmal protokolliert
create unique index if not exists foerder_ereignisse_frist_uidx
  on public.foerder_ereignisse (foerderung_id, schluessel, (neu ->> 'datum')) where art = 'frist_verpasst';

-- Hash über alle Inhalte, unabhängig von Zeitzone und Sitzungseinstellungen
create or replace function public.foerder_ereignis_hash(e public.foerder_ereignisse)
returns bytea language sql stable set search_path = '' as $$
  select sha256(convert_to(concat_ws('|',
    coalesce(encode(e.vorher_hash, 'hex'), ''),
    e.foerderung_id::text,
    to_char(e.zeit at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.von, coalesce(e.von_uid::text, ''), e.art, e.schluessel,
    coalesce(e.alt::text, 'null'), coalesce(e.neu::text, 'null')), 'UTF8'))
$$;

-- Vor jedem Einfügen: an die Kette der Förderung hängen (Sperre gegen gleichzeitiges Schreiben)
create or replace function public.foerder_ereignis_verketten()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('foerder_ereignisse:' || new.foerderung_id::text, 0));
  new.zeit := clock_timestamp();
  select e.hash into new.vorher_hash
    from public.foerder_ereignisse e
   where e.foerderung_id = new.foerderung_id
   order by e.id desc limit 1;
  new.hash := public.foerder_ereignis_hash(new);
  return new;
end $$;

create or replace function public.foerder_ereignis_sperre()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% ist revisionssicher: % ist nicht erlaubt', tg_table_name, tg_op;
end $$;

drop trigger if exists foerder_ereignis_verketten on public.foerder_ereignisse;
create trigger foerder_ereignis_verketten before insert on public.foerder_ereignisse
  for each row execute function public.foerder_ereignis_verketten();
drop trigger if exists foerder_ereignis_sperre on public.foerder_ereignisse;
create trigger foerder_ereignis_sperre before update or delete on public.foerder_ereignisse
  for each row execute function public.foerder_ereignis_sperre();
drop trigger if exists foerder_ereignis_sperre_truncate on public.foerder_ereignisse;
create trigger foerder_ereignis_sperre_truncate before truncate on public.foerder_ereignisse
  for each statement execute function public.foerder_ereignis_sperre();

-- Kette prüfen: liefert die id des ersten Ereignisses, das nicht passt – oder null, wenn alles stimmt
create or replace function public.foerder_kette_pruefen(p_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  e public.foerder_ereignisse;
  vorher bytea := null;
begin
  if public.foerder_rolle() is null then raise exception 'Kein Zugriff'; end if;
  for e in select * from public.foerder_ereignisse where foerderung_id = p_id order by id loop
    if e.vorher_hash is distinct from vorher or e.hash <> public.foerder_ereignis_hash(e) then
      return e.id;
    end if;
    vorher := e.hash;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------
-- 2. Änderungen an foerderungen → Ereignisse (je Feld, je Schritt einzeln)
-- ---------------------------------------------------------------
create or replace function public.foerder_ereignisse_schreiben()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb; k text;
  von text := public.foerder_ich();
  uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, neu)
    values (new.id, von, uid, 'angelegt', to_jsonb(new) - 'schritte');
    for k in select jsonb_object_keys(new.schritte) loop
      insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, schluessel, neu)
      values (new.id, von, uid, 'schritt_gesetzt', k, new.schritte -> k);
    end loop;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, alt)
    values (old.id, von, uid, 'endgueltig_geloescht', jsonb_build_object('kunde', old.kunde, 'projekt_nr', old.projekt_nr));
    return old;
  end if;

  -- UPDATE: Papierkorb, Schritte, übrige Felder
  if old.geloescht_am is null and new.geloescht_am is not null then
    insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art) values (new.id, von, uid, 'papierkorb');
  elsif old.geloescht_am is not null and new.geloescht_am is null then
    insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art) values (new.id, von, uid, 'wiederhergestellt');
  end if;

  for k in select jsonb_object_keys(old.schritte) union select jsonb_object_keys(new.schritte) loop
    if (old.schritte -> k) is distinct from (new.schritte -> k) then
      insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, schluessel, alt, neu)
      values (new.id, von, uid, case when new.schritte ? k then 'schritt_gesetzt' else 'schritt_entfernt' end,
              k, old.schritte -> k, new.schritte -> k);
    end if;
  end loop;

  o := to_jsonb(old) - array['schritte', 'geloescht_am', 'geaendert_am', 'geaendert_von', 'erstellt_am', 'erstellt_von'];
  n := to_jsonb(new) - array['schritte', 'geloescht_am', 'geaendert_am', 'geaendert_von', 'erstellt_am', 'erstellt_von'];
  for k in select jsonb_object_keys(n) loop
    if (o -> k) is distinct from (n -> k) then
      insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, schluessel, alt, neu)
      values (new.id, von, uid, 'feld', k, o -> k, n -> k);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists foerder_ereignisse on public.foerderungen;
create trigger foerder_ereignisse after insert or update or delete on public.foerderungen
  for each row execute function public.foerder_ereignisse_schreiben();

-- ---------------------------------------------------------------
-- 3. Belege: Datei liegt in Supabase Storage (privater Bucket "foerder-belege"),
--    hier stehen Pfad und Fingerabdruck. Nie überschreiben – eine neue Version ersetzt die alte.
-- ---------------------------------------------------------------
create table if not exists public.foerder_dateien (
  id             uuid primary key default gen_random_uuid(),
  foerderung_id  uuid not null references public.foerderungen(id) on delete restrict,
  art            text not null check (art in ('vertrag', 'nachforderung', 'nachreichung', 'rechnung', 'zahlung',
                                              'fertigstellung', 'messprotokoll', 'endabrechnung', 'sonstiges')),
  schritt        text not null default '',       -- zu welchem Schritt der Beleg gehört (z. B. vertrag_erhalten)
  pfad           text not null unique,           -- Storage-Pfad, z. B. <foerderung_id>/<uuid>.pdf
  dateiname      text not null,
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  groesse        bigint not null check (groesse > 0),
  mime           text not null default '',
  ersetzt        uuid references public.foerder_dateien(id),
  hochgeladen_am timestamptz not null default now(),
  hochgeladen_von text not null default ''
);
create index if not exists foerder_dateien_fid_idx on public.foerder_dateien (foerderung_id);

create or replace function public.foerder_datei_protokollieren()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.hochgeladen_am := now();
  new.hochgeladen_von := public.foerder_ich();
  insert into public.foerder_ereignisse (foerderung_id, von, von_uid, art, schluessel, alt, neu)
  values (new.foerderung_id, new.hochgeladen_von, auth.uid(),
          case when new.ersetzt is null then 'datei' else 'datei_ersetzt' end, new.art,
          case when new.ersetzt is null then null else jsonb_build_object('datei', new.ersetzt) end,
          jsonb_build_object('datei', new.id, 'name', new.dateiname, 'sha256', new.sha256, 'groesse', new.groesse, 'schritt', new.schritt));
  return new;
end $$;

drop trigger if exists foerder_datei_protokollieren on public.foerder_dateien;
create trigger foerder_datei_protokollieren before insert on public.foerder_dateien
  for each row execute function public.foerder_datei_protokollieren();
drop trigger if exists foerder_datei_sperre on public.foerder_dateien;
create trigger foerder_datei_sperre before update or delete on public.foerder_dateien
  for each row execute function public.foerder_ereignis_sperre();

-- ---------------------------------------------------------------
-- 4. Zugriff
-- ---------------------------------------------------------------
alter table public.foerder_ereignisse enable row level security;
alter table public.foerder_dateien    enable row level security;
revoke all on public.foerder_ereignisse, public.foerder_dateien from anon, authenticated;
grant select on public.foerder_ereignisse to authenticated;            -- schreiben nur über Trigger
grant select, insert on public.foerder_dateien to authenticated;

drop policy if exists ereignisse_lesen on public.foerder_ereignisse;
create policy ereignisse_lesen on public.foerder_ereignisse for select to authenticated
  using (public.foerder_rolle() is not null);
drop policy if exists dateien_lesen on public.foerder_dateien;
drop policy if exists dateien_anlegen on public.foerder_dateien;
create policy dateien_lesen on public.foerder_dateien for select to authenticated
  using (public.foerder_rolle() is not null);
create policy dateien_anlegen on public.foerder_dateien for insert to authenticated
  with check (public.foerder_rolle() in ('admin', 'bearbeiten'));

revoke execute on function public.foerder_ereignis_verketten(), public.foerder_ereignis_sperre(),
  public.foerder_ereignisse_schreiben(), public.foerder_datei_protokollieren() from public, anon, authenticated;
revoke execute on function public.foerder_kette_pruefen(uuid) from public, anon;
grant execute on function public.foerder_kette_pruefen(uuid) to authenticated;

-- Endgültig löschen braucht danach einen Weg an den Belegen vorbei (on delete restrict):
-- erst entscheiden, ob Belege nach BAO 7 Jahre bleiben müssen – siehe docs/BLUEPRINT.md, Abschnitt 2.
