import subprocess
subprocess.run(['pip', 'install', 'xarray', 'zarr', 'gcsfs', 'cftime',
                'nc-time-axis', 'regionmask', '--quiet'], check=True)

import numpy as np
import pandas as pd
import xarray as xr
import gcsfs
import regionmask
import json
import os

print('Loading CMIP6 catalog...')
gcs = gcsfs.GCSFileSystem(token='anon')
df  = pd.read_csv('https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv')

print('Opening CESM2 historical tas...')
row = df.query(
    "activity_id=='CMIP' & table_id=='Amon' & variable_id=='tas'"
    " & experiment_id=='historical' & source_id=='CESM2' & member_id=='r1i1p1f1'"
).iloc[0]
ds = xr.open_zarr(gcs.get_mapper(row.zstore), consolidated=True)

print('Loading area weights...')
area_row = df.query("variable_id=='areacella' & source_id=='CESM2'").iloc[0]
ds_area  = xr.open_zarr(gcs.get_mapper(area_row.zstore), consolidated=True)

print('Building country mask over CMIP6 grid...')
regions = regionmask.defined_regions.natural_earth_v5_0_0.countries_110
mask    = regions.mask(ds.lon.values, ds.lat.values)

print('Loading annual temperature grid (this may take ~1 minute)...')
tas_ann = ds.tas.resample(time='YE').mean().load()
years   = tas_ann.time.dt.year.values
print(f'  Loaded {len(years)} years  ({years[0]}–{years[-1]})')

print('\nComputing per-country statistics...')
climate_data = {}

for i, (name, number) in enumerate(zip(regions.names, regions.numbers)):
    country_mask = (mask == number)

    if int(country_mask.sum()) == 0:
        continue

    w       = ds_area.areacella.where(country_mask)
    total_w = float(w.sum())
    if total_w == 0:
        continue

    annual_k = (tas_ann.where(country_mask) * w).sum(dim=['lat', 'lon']) / total_w
    annual_c = annual_k.values - 273.15

    base_idx = years <= 1900
    base_val = float(annual_c[base_idx].mean())
    anom     = annual_c - base_val

    recent_idx      = (years >= 2000) & (years <= 2014)
    overall_anomaly = float(anom[recent_idx].mean())

    timeseries = [
        {'year': int(y), 'temp': round(float(t), 2), 'anomaly': round(float(a), 3)}
        for y, t, a in zip(years, annual_c, anom)
    ]

    decadal = []
    for d_start in range(1850, 2015, 10):
        idx = (years >= d_start) & (years < d_start + 10)
        if idx.sum() > 0:
            decadal.append({
                'decade':  f'{d_start}s',
                'year':    d_start,
                'anomaly': round(float(anom[idx].mean()), 3),
            })

    climate_data[name] = {
        'name':       name,
        'anomaly':    round(overall_anomaly, 3),
        'baseline':   round(base_val, 2),
        'timeseries': timeseries,
        'decadal':    decadal,
    }

    if (i + 1) % 30 == 0:
        print(f'  {i + 1}/{len(regions.names)} countries processed...')

print(f'\nProcessed {len(climate_data)} countries with data.')

ALIASES = {
    'United States of America':               ['USA', 'United States'],
    'Russian Federation':                     ['Russia'],
    'Russia':                                 ['Russian Federation'],
    'Republic of Korea':                      ['South Korea', 'S. Korea'],
    'Dem. Rep. Korea':                        ['North Korea', 'N. Korea'],
    'North Korea':                            ['Dem. Rep. Korea'],
    'South Korea':                            ['Republic of Korea'],
    'Islamic Republic of Iran':               ['Iran'],
    'Iran':                                   ['Islamic Republic of Iran'],
    'Syrian Arab Republic':                   ['Syria'],
    'Syria':                                  ['Syrian Arab Republic'],
    'United Republic of Tanzania':            ['Tanzania'],
    'Tanzania':                               ['United Republic of Tanzania'],
    'Plurinational State of Bolivia':         ['Bolivia'],
    'Bolivia':                                ['Plurinational State of Bolivia'],
    'Bolivarian Republic of Venezuela':       ['Venezuela'],
    'Venezuela':                              ['Bolivarian Republic of Venezuela'],
    "Lao People's Democratic Republic":       ['Laos'],
    'Laos':                                   ["Lao People's Democratic Republic", 'Lao PDR'],
    'Czech Republic':                         ['Czech Rep.', 'Czechia'],
    'Czechia':                                ['Czech Republic', 'Czech Rep.'],
    "Côte d'Ivoire":                          ["Ivory Coast", "Cote d'Ivoire"],
    'Ivory Coast':                            ["Côte d'Ivoire"],
    'Republic of Moldova':                    ['Moldova'],
    'Moldova':                                ['Republic of Moldova'],
    'Dem. Rep. Congo':                        ['Democratic Republic of the Congo', 'DR Congo'],
    'Democratic Republic of the Congo':       ['Dem. Rep. Congo', 'DR Congo'],
    'Republic of Congo':                      ['Republic of the Congo', 'Congo'],
    'Republic of the Congo':                  ['Republic of Congo', 'Congo'],
    'Congo':                                  ['Republic of Congo', 'Republic of the Congo'],
    'Libyan Arab Jamahiriya':                 ['Libya'],
    'Libya':                                  ['Libyan Arab Jamahiriya'],
    'Taiwan, Province of China':              ['Taiwan'],
    'Taiwan':                                 ['Taiwan, Province of China'],
    'Palestinian Territory':                  ['Palestine', 'West Bank'],
    'Macedonia':                              ['North Macedonia'],
    'North Macedonia':                        ['Macedonia'],
    'United Arab Emirates':                   ['UAE'],
    'Central African Republic':               ['Central African Rep.'],
    'Central African Rep.':                   ['Central African Republic'],
    'Equatorial Guinea':                      ['Eq. Guinea'],
    'Eq. Guinea':                             ['Equatorial Guinea'],
    'Bosnia and Herzegovina':                 ['Bosnia and Herz.'],
    'Bosnia and Herz.':                       ['Bosnia and Herzegovina'],
    'South Sudan':                            ['S. Sudan'],
    'S. Sudan':                               ['South Sudan'],
    'Western Sahara':                         ['W. Sahara'],
    'W. Sahara':                              ['Western Sahara'],
    'eSwatini':                               ['Swaziland'],
    'Swaziland':                              ['eSwatini'],
    'Timor-Leste':                            ['East Timor'],
    'East Timor':                             ['Timor-Leste'],
    'Guinea-Bissau':                          ['Guinea Bissau'],
    'Guinea Bissau':                          ['Guinea-Bissau'],
    'Serbia':                                 ['Republic of Serbia'],
    'Republic of Serbia':                     ['Serbia'],
    'Trinidad and Tobago':                    ['Trinidad and Tobago'],
    'Dominican Republic':                     ['Dominican Rep.'],
    'Dominican Rep.':                         ['Dominican Republic'],
    'The Bahamas':                            ['Bahamas'],
    'Bahamas':                                ['The Bahamas'],
    'Solomon Islands':                        ['Solomon Is.'],
    'Falkland Islands':                       ['Falkland Is.'],
    'Papua New Guinea':                       ['Papua New Guinea'],
    'São Tomé and Príncipe':                  ['São Tomé and Principe'],
}

for canonical, aliases in ALIASES.items():
    if canonical in climate_data:
        for alias in aliases:
            climate_data[alias] = climate_data[canonical]

print(f'Added aliases → {len(climate_data)} total keys in JSON.')

os.makedirs('data', exist_ok=True)
out_path = 'data/climate_data.json'
with open(out_path, 'w') as f:
    json.dump(climate_data, f, separators=(',', ':'))

size_kb = os.path.getsize(out_path) / 1024
print(f'Saved → {out_path}  ({size_kb:.0f} KB)')
print('\nNext step: download this file and put it in your project repo at data/climate_data.json')
