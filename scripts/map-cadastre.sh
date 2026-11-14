#!/usr/bin/env bash
# The cadastre's buildings inside a box (14 November 2026), for
# scripts/map-official.mjs: «ALKIS NW Grundrissdaten vereinfacht»
# (Geobasis NRW, Datenlizenz Deutschland – Zero 2.0), one file per district.
#
#   scripts/map-cadastre.sh <west,south,east,north> <gebref.txt> <out.geojsonl>
#
# The districts come from the official addresses inside the box; each file
# is fetched once into cadastre-cache/ (several areas may share one). Needs
# ogr2ogr (gdal-bin). Prints counts only, never a place: the log is public.
set -euo pipefail
BOX="$1"; GEBREF="$2"; OUT="$3"
SRC=https://www.opengeodata.nrw.de/produkte/geobasis/lk/akt/gru_vereinfacht_gpkg
mkdir -p cadastre-cache
[ -f cadastre-cache/index.json ] || curl -fsS "$SRC/index.json" -o cadastre-cache/index.json
: > "$OUT"
IFS=, read -r W S E N <<< "$BOX"
n=0
for key in $(node "$(dirname "$0")/map-official.mjs" --districts "$GEBREF" "$BOX"); do
  name=$(jq -r --arg k "gru_vereinf_${key}000_" '.. | objects | select(has("name")) | .name | select(startswith($k) and endswith(".zip"))' cadastre-cache/index.json | head -1)
  [ -n "$name" ] || { echo "A district has no cadastre file"; continue; }
  if [ ! -f "cadastre-cache/$key.gpkg" ]; then
    curl -fsS "$SRC/$name" -o "cadastre-cache/$key.zip"
    unzip -o -q "cadastre-cache/$key.zip" -d "cadastre-cache/$key"
    mv "$(find "cadastre-cache/$key" -iname '*.gpkg' | head -1)" "cadastre-cache/$key.gpkg"
    rm -rf "cadastre-cache/$key" "cadastre-cache/$key.zip"
  fi
  ogr2ogr -f GeoJSONSeq /vsistdout/ "cadastre-cache/$key.gpkg" GebauedeBauwerk \
    -t_srs EPSG:4326 -spat "$W" "$S" "$E" "$N" -spat_srs EPSG:4326 \
    -select funktion,anzahlgs -lco RS=NO >> "$OUT"
  n=$((n + 1))
done
echo "Cadastre: $n district file(s), $(wc -l < "$OUT") buildings in the box"
