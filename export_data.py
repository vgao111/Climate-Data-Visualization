"""
export_data.py — Run this in Google Colab to generate data/climate_data.json

Paste all cells into a Colab notebook in order, or upload this file and run:
  !python export_data.py

Output: data/climate_data.json  (~1-2 MB)
Then download it and place it in your project repo at: data/climate_data.json
"""

# ── 1. Install dependencies ───────────────────────────────────────────────────
import subprocess
subprocess.run(['pip', 'install', 'xarray', 'zarr', 'gcsfs', 'cftime',
                'nc-time-axis', 'regionmask', '--quiet'], check=True)

# ── 2. Imports ────────────────────────────────────────────────────────────────
import numpy as np
import pandas as pd
import xarray as xr
import gcsfs
import regionmask
import json
import os

# ── 3. Load CMIP6 catalog ─────────────────────────────────────────────────────
print('Loading CMIP6 catalog...')
gcs = gcsfs.GCSFileSystem(token='anon')
df  = pd.read_csv('https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv')

# ── 4. Open CESM2 historical tas ──────────────────────────────────────────────
print('Opening CESM2 historical tas...')
row = df.query(
    "activity_id=='CMIP' & table_id=='Amon' & variable_id=='tas'"
    " & experiment_id=='historical' & source_id=='CESM2' & member_id=='r1i1p1f1'"
).iloc[0]
ds = xr.open_zarr(gcs.get_mapper(row.zstore), consolidated=True)

# ── 5. Load area weights ──────────────────────────────────────────────────────
print('Loading area weights...')
area_row = df.query("variable_id=='areacella' & source_id=='CESM2'").iloc[0]
ds_area  = xr.open_zarr(gcs.get_mapper(area_row.zstore), consolidated=True)

# ── 6. Build country mask ─────────────────────────────────────────────────────
print('Building country mask over CMIP6 grid...')
regions = regionmask.defined_regions.natural_earth_v5_0_0.countries_110
mask    = regions.mask(ds.lon.values, ds.lat.values)   # shape (192, 288)

# ── 7. Load full annual grid (one big download ~36 MB) ───────────────────────
print('Loading annual temperature grid (this may take ~1 minute)...')
tas_ann = ds.tas.resample(time='YE').mean().load()     # shape (165, 192, 288)
years   = tas_ann.time.dt.year.values
print(f'  Loaded {len(years)} years  ({years[0]}–{years[-1]})')

# ── 8. Compute per-country statistics ─────────────────────────────────────────
print('\nComputing per-country statistics...')
climate_data = {}

for i, (name, number) in enumerate(zip(regions.names, regions.numbers)):
    country_mask = (mask == i)

    # Skip countries with no land cells at 1° resolution
    if int(country_mask.sum()) == 0:
        continue

    # Area-weighted annual mean temperature
    w       = ds_area.areacella.where(country_mask)
    total_w = float(w.sum())
    if total_w == 0:
        continue

    annual_k = (tas_ann.where(country_mask) * w).sum(dim=['lat', 'lon']) / total_w
    annual_c = annual_k.values - 273.15          # Kelvin → Celsius

    # 1850–1900 baseline mean
    base_idx = years <= 1900
    base_val = float(annual_c[base_idx].mean())
    anom     = annual_c - base_val               # anomaly array

    # Single summary anomaly: 2000–2014 mean vs baseline
    recent_idx      = (years >= 2000) & (years <= 2014)
    overall_anomaly = float(anom[recent_idx].mean())

    # Annual time series
    timeseries = [
        {'year': int(y), 'temp': round(float(t), 2), 'anomaly': round(float(a), 3)}
        for y, t, a in zip(years, annual_c, anom)
    ]

    # Decadal means
    decadal = []
    for d_start in range(1850, 2015, 10):
        idx = (years >= d_start) & (years < d_start + 10)
        if idx.sum() > 0:
            decadal.append({
                'decade':  f'{d_start}s',
                'year':    d_start,
                'anomaly': round(float(anom[idx].mean()), 3),
            })

    # ISO 3166-1 numeric key — matches world-atlas TopoJSON country IDs
    climate_data[str(number)] = {
        'name':       name,
        'anomaly':    round(overall_anomaly, 3),
        'baseline':   round(base_val, 2),
        'timeseries': timeseries,
        'decadal':    decadal,
    }

    if (i + 1) % 30 == 0:
        print(f'  {i + 1}/{len(regions.names)} countries processed...')

print(f'\nProcessed {len(climate_data)} countries with data.')

# ── 9. Save ───────────────────────────────────────────────────────────────────
os.makedirs('data', exist_ok=True)
out_path = 'data/climate_data.json'
with open(out_path, 'w') as f:
    json.dump(climate_data, f, separators=(',', ':'))   # compact JSON

size_kb = os.path.getsize(out_path) / 1024
print(f'Saved → {out_path}  ({size_kb:.0f} KB)')
print('\nNext step: download this file and put it in your project repo at data/climate_data.json')

# Uncomment to auto-download in Colab:
# from google.colab import files
# files.download(out_path)
