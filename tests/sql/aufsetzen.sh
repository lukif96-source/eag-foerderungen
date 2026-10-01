#!/usr/bin/env bash
# Baut eine Test-Datenbank wie in Supabase auf: Platzhalter, setup.sql, archiv.sql, Revisions-Vorschlag, v2.
# Verbindung über die üblichen PG*-Variablen (PGHOST, PGPORT, PGUSER, PGDATABASE).
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -X -q -v ON_ERROR_STOP=1"
$P -f tests/sql/supabase-stubs.sql
sed -n '1,/^-- Mail an die Admins/p' sql/setup.sql | $P
grep -v '^create extension' sql/archiv.sql | $P
$P -f sql/vorschlag-revision.sql
grep -v '^create extension' sql/oemag.sql | $P
$P -f sql/v2/eag.sql
$P -f sql/v2/eag.sql          # wiederholbar?
echo "Datenbank aufgesetzt."
