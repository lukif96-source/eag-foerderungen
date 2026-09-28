-- EAG-Förderungen SOLPRO – Datenbank-Einrichtung
-- Einmal komplett im Supabase-Dashboard → SQL Editor ausführen.
-- Vorher in der LETZTEN Zeile deine eigene E-Mail-Adresse eintragen (wird Admin).

-- ---------------------------------------------------------------
-- Nutzer & Rollen
--   admin      = alles, inkl. Nutzerverwaltung, Import, endgültig löschen
--   bearbeiten = Förderungen anlegen und ändern
--   lesen      = nur ansehen
-- Wer nicht in dieser Liste steht, sieht nichts – auch mit gültigem Login.
-- ---------------------------------------------------------------
create table if not exists public.foerder_nutzer (
  email       text primary key check (email = lower(email)),
  name        text not null default '',
  rolle       text not null default 'lesen' check (rolle in ('admin','bearbeiten','lesen')),
  erstellt_am timestamptz not null default now()
);

create or replace function public.foerder_rolle()
returns text language sql stable security definer set search_path = public as $$
  select rolle from public.foerder_nutzer
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.foerder_ich()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(name, '') from public.foerder_nutzer where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    auth.jwt() ->> 'email',
    'System')
$$;

-- ---------------------------------------------------------------
-- Förderungen
-- schritte: {"ticket": "2026-06-16", "vertrag_versendet": "✓", ...}
--           Wert = Datum (JJJJ-MM-TT) oder "✓" (erledigt, Datum unbekannt)
-- ---------------------------------------------------------------
create table if not exists public.foerderungen (
  id            uuid primary key default gen_random_uuid(),
  jahr          int  not null default extract(year from now())::int,
  programm      text not null default 'EAG',
  art           text not null default '',
  foerdercall   date,
  mitarbeiter   text not null default '',
  zieher        text not null default '',
  kunde         text not null default '',
  geburtsdatum  date,
  vollmacht     text not null default '',
  strasse       text not null default '',
  plz           text not null default '',
  ort           text not null default '',
  kg_gst        text not null default '',
  zaehlpunkt    text not null default '',
  mail          text not null default '',
  projekt_nr    text not null default '',
  kwp           numeric,
  modulflaeche  numeric,
  einspeisung   text not null default '',
  wr_leistung   text not null default '',
  speicher      text not null default '',
  anbringung    text not null default '',
  zeitplan      text not null default '',
  ticket        text not null default '',
  fpj           text not null default '',
  schritte      jsonb not null default '{}'::jsonb,
  offene_punkte text not null default '',
  info          text not null default '',
  geloescht_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  text not null default '',
  geaendert_am  timestamptz not null default now(),
  geaendert_von text not null default ''
);

create index if not exists foerderungen_jahr_idx on public.foerderungen (jahr);

create or replace function public.foerder_stempel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.geaendert_am  := now();
  new.geaendert_von := public.foerder_ich();
  if tg_op = 'INSERT' then
    new.erstellt_am  := now();
    new.erstellt_von := new.geaendert_von;
  else
    new.erstellt_am  := old.erstellt_am;
    new.erstellt_von := old.erstellt_von;
  end if;
  return new;
end $$;

drop trigger if exists foerder_stempel on public.foerderungen;
create trigger foerder_stempel before insert or update on public.foerderungen
  for each row execute function public.foerder_stempel();

-- ---------------------------------------------------------------
-- Verlauf: wer hat wann was geändert (wird automatisch geschrieben)
-- ---------------------------------------------------------------
create table if not exists public.foerder_verlauf (
  id            bigint generated always as identity primary key,
  foerderung_id uuid not null references public.foerderungen(id) on delete cascade,
  zeit          timestamptz not null default now(),
  von           text not null default '',
  aktion        text not null default '',
  aenderungen   jsonb not null default '{}'::jsonb
);
create index if not exists foerder_verlauf_fid_idx on public.foerder_verlauf (foerderung_id, zeit desc);

create or replace function public.foerder_verlauf_schreiben()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.foerder_verlauf (foerderung_id, von, aktion) values (new.id, new.erstellt_von, 'angelegt');
    return new;
  end if;
  for k in select jsonb_object_keys(n) loop
    continue when k in ('geaendert_am', 'geaendert_von', 'erstellt_am', 'erstellt_von');
    if (o -> k) is distinct from (n -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.foerder_verlauf (foerderung_id, von, aktion, aenderungen)
    values (new.id, new.geaendert_von, 'geändert', diff);
  end if;
  return new;
end $$;

drop trigger if exists foerder_verlauf on public.foerderungen;
create trigger foerder_verlauf after insert or update on public.foerderungen
  for each row execute function public.foerder_verlauf_schreiben();

-- ---------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------
alter table public.foerder_nutzer  enable row level security;
alter table public.foerderungen    enable row level security;
alter table public.foerder_verlauf enable row level security;

revoke all on public.foerder_nutzer, public.foerderungen, public.foerder_verlauf from anon;
grant select, insert, update, delete on public.foerder_nutzer, public.foerderungen to authenticated;
grant select on public.foerder_verlauf to authenticated;

drop policy if exists nutzer_lesen on public.foerder_nutzer;
drop policy if exists nutzer_admin on public.foerder_nutzer;
create policy nutzer_lesen on public.foerder_nutzer for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.foerder_rolle() = 'admin');
create policy nutzer_admin on public.foerder_nutzer for all to authenticated
  using (public.foerder_rolle() = 'admin') with check (public.foerder_rolle() = 'admin');

drop policy if exists foerd_lesen    on public.foerderungen;
drop policy if exists foerd_anlegen  on public.foerderungen;
drop policy if exists foerd_aendern  on public.foerderungen;
drop policy if exists foerd_loeschen on public.foerderungen;
create policy foerd_lesen on public.foerderungen for select to authenticated
  using (public.foerder_rolle() is not null);
create policy foerd_anlegen on public.foerderungen for insert to authenticated
  with check (public.foerder_rolle() in ('admin', 'bearbeiten'));
create policy foerd_aendern on public.foerderungen for update to authenticated
  using (public.foerder_rolle() in ('admin', 'bearbeiten'))
  with check (public.foerder_rolle() in ('admin', 'bearbeiten'));
create policy foerd_loeschen on public.foerderungen for delete to authenticated
  using (public.foerder_rolle() = 'admin');

drop policy if exists verlauf_lesen on public.foerder_verlauf;
create policy verlauf_lesen on public.foerder_verlauf for select to authenticated
  using (public.foerder_rolle() is not null);

-- ---------------------------------------------------------------
-- Ersten Admin eintragen  ← HIER DEINE E-MAIL EINTRAGEN
-- ---------------------------------------------------------------
insert into public.foerder_nutzer (email, name, rolle)
values (lower('DEINE-EMAIL@solpro.at'), 'Lukas', 'admin')
on conflict (email) do update set rolle = 'admin';
