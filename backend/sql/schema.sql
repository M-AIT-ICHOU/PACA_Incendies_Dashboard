-- Enable PostGIS (safe if already enabled)
create extension if not exists postgis;

-- Fires table (from Prométhée CSV)
create table if not exists fires (
  id bigserial primary key,
  annee int,
  numero int,
  departement text,
  insee text,
  commune text,
  date_alerte timestamptz,
  surface_ha double precision
);

create index if not exists fires_insee_idx on fires (insee);
create index if not exists fires_departement_idx on fires (departement);
create index if not exists fires_date_idx on fires (date_alerte);

-- Communes reference (for INSEE join)
create table if not exists communes (
  insee text primary key,
  nom text
);

-- Optional geometries for later vector tiles / choropleths server-side
-- Uncomment when you're ready to store geometry.
-- alter table communes add column if not exists geom geometry(MultiPolygon, 4326);
