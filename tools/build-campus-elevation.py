"""Build measured roof volumes from paired, time-matched Edmonton elevation rasters."""
import argparse
import json
import math
from contextlib import ExitStack
from pathlib import Path

import numpy as np
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import geometry_mask, shapes, sieve
from rasterio.merge import merge
from rasterio.windows import Window, from_bounds
from shapely.geometry import MultiPolygon, Polygon, mapping, shape

WEB_ROOT = Path(__file__).resolve().parents[1] / 'MapApp' / 'wwwroot'
CAMPUS = WEB_ROOT / 'map.geojson'
OUTPUT = WEB_ROOT / 'campus-elevation.geojson'
TO_PROJECTED = Transformer.from_crs(4326, 3776, always_xy=True)
TO_GEOGRAPHIC = Transformer.from_crs(3776, 4326, always_xy=True)
FIRST_PEOPLES_HOUSE = 'way/51065222'
SURVEY = '2025-06-29/2025-06-30'


def roof_footprints():
    features = json.loads(CAMPUS.read_text())['features']
    for feature in features:
        properties = feature['properties']
        if feature['geometry']['type'] not in ('Polygon', 'MultiPolygon') or not properties.get('building'):
            continue
        footprint = shapely.transform(shape(feature['geometry']), TO_PROJECTED.transform, interleaved=False)
        yield footprint, properties


def polygon_parts(geom):
    if isinstance(geom, Polygon):
        yield geom
    elif hasattr(geom, 'geoms'):
        for part in geom.geoms:
            yield from polygon_parts(part)


def load_surface(cache, kind, bounds):
    with ExitStack() as files:
        datasets = [files.enter_context(rasterio.open(path)) for path in sorted(cache.glob(f'{kind}_*.tif'))]
        if not datasets:
            raise ValueError(f'Tile files missing for {kind}')
        return merge(datasets, bounds=bounds, res=1, nodata=-9999, masked=True)


def crop_building(geom, transform, ground, roof):
    win = from_bounds(*geom.bounds, transform)
    # Keep a pixel around the margins to support the median filter.
    col, row = math.floor(win.col_off) - 2, math.floor(win.row_off) - 2
    end_col = math.ceil(win.col_off + win.width) + 2
    end_row = math.ceil(win.row_off + win.height) + 2
    if col < 0 or row < 0 or end_col > ground.shape[1] or end_row > ground.shape[0]:
        raise ValueError('Raster extent does not cover a footprint')
    transform = rasterio.windows.transform(Window(col, row, end_col-col, end_row-row), transform)
    ground, roof = (image[row:end_row, col:end_col] for image in (ground, roof))
    mask = geometry_mask([geom], transform=transform, out_shape=ground.shape, invert=True)
    return ground, roof, mask, transform


def measured_roofs(geom, transform, ground_grid, roof_grid):
    ground, roof, footprint, local_transform = crop_building(geom, transform, ground_grid, roof_grid)
    if np.count_nonzero(footprint) < 12:
        return None, [], 'footprint under 12 m²'
    valid = footprint & ~np.ma.getmaskarray(ground) & ~np.ma.getmaskarray(roof)
    relative = np.ma.filled(roof-ground, 0)
    roof_sample = valid & (relative >= 2) & (relative <= 100)
    coverage = float(np.count_nonzero(roof_sample) / np.count_nonzero(footprint))
    if coverage < 0.78:
        return None, [], f'only {coverage:.0%} roof support'
    datum = float(np.median(np.asarray(ground[valid])))
    above_base = np.ma.filled(roof - datum, 0)

    # Use a small spatial median to suppress isolated roof fixtures and canopy spikes.
    smooth = np.median(np.lib.stride_tricks.sliding_window_view(
        np.pad(above_base, 1, mode='edge'), (3, 3)), axis=(-1, -2))

    level_data = smooth[roof_sample]
    dominant = float(np.median(above_base[roof_sample]))
    if not 2 <= dominant <= 100:
        return None, [], f'implausible median rise {dominant:.1f} m'

    # Separate only strongly supported height bands with broad connected areas.
    # The dominant part keeps the mapped footprint outline, including unsampled edges.
    count_limit = max(48, int(level_data.size * 0.04))
    classes = np.zeros(footprint.shape, dtype=np.int16)
    classes[roof_sample] = np.floor(np.clip(level_data / 3, 0, 34)).astype(np.int16) + 1
    classes = sieve(classes, size=count_limit, mask=roof_sample, connectivity=4)
    pieces = []
    for geometry, category in shapes(classes, mask=roof_sample, connectivity=4, transform=local_transform):
        if category == 0:
            continue
        part = shape(geometry)
        if part.area < count_limit:
            continue
        sample_mask = geometry_mask([part], transform=local_transform, out_shape=roof.shape, invert=True)
        heights = above_base[sample_mask & roof_sample]
        if not len(heights):
            continue
        height = float(np.median(heights))
        if not 2 <= height <= 100 or abs(height - dominant) < 2.5:
            continue
        part = shapely.make_valid(part).simplify(0.8, preserve_topology=True)
        # Close the one-pixel fringe at mapped walls without pushing a roof band
        # further than the resolution of the analysis grid.
        part = part.buffer(0.4, join_style='mitre').intersection(geom)
        pieces.append((part, height))

    result = []
    remaining = geom
    for part, height in sorted(pieces, key=lambda x: -x[0].area):
        section = part.intersection(remaining)
        for polygon in polygon_parts(section):
            if polygon.area >= count_limit:
                result.append((polygon, height))
                remaining = remaining.difference(polygon)
    for polygon in polygon_parts(remaining):
        if polygon.area >= 4:
            result.append((polygon, dominant))
    return datum, result, f'{coverage:.0%} roof support'


def build(cache, path):
    footprints = sorted(roof_footprints(), key=lambda f: f[0].area)
    full_bounds = [geom.bounds for geom, _ in footprints]
    bounds = [math.floor(min(b[0] for b in full_bounds))-5, math.floor(min(b[1] for b in full_bounds))-5,
              math.ceil(max(b[2] for b in full_bounds))+5, math.ceil(max(b[3] for b in full_bounds))+5]
    ground, ground_transform = load_surface(cache, 'be', bounds)
    roof, roof_transform = load_surface(cache, 'ff', bounds)
    if ground.shape != roof.shape or ground_transform != roof_transform:
        raise ValueError('Surface grids must align')

    features = []
    sampled_footprints = []
    for geom, p in footprints:
        osm_id = p['@id']
        name = p.get('name', osm_id)
        if osm_id == FIRST_PEOPLES_HOUSE:
            print('SKIP', name, 'renovation reopened in August 2026')
            continue
        if p['building'] in ('bridge','roof'):
            print('SKIP', name, 'elevated connector or open shelter')
            continue
        # Preserve smaller mapped parts such as the SUB tower within a larger outline.
        competing = [earlier for earlier in sampled_footprints if geom.intersects(earlier)]
        if competing:
            geom = geom.difference(shapely.union_all(competing))
        if geom.is_empty or geom.area < 12:
            print('SKIP', name, 'insufficient independent footprint')
            continue
        datum, roofs, detail = measured_roofs(geom, ground_transform, ground[0], roof[0])
        if not roofs:
            print('SKIP', name, detail)
            continue
        sampled_footprints.append(geom)
        print(name, detail, 'ground', round(datum,1), 'sections', [(round(part.area), round(height,1)) for part,height in roofs])
        all_roofs = {}
        for part, height in roofs:
            all_roofs.setdefault(round(height, 1), []).append(part)
        for height, parts in sorted(all_roofs.items()):
            polygons = list(polygon_parts(shapely.union_all(parts)))
            if not polygons:
                continue
            geometry = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
            geographic = shapely.transform(geometry, TO_GEOGRAPHIC.transform, interleaved=False)
            geographic = shapely.set_precision(shapely.make_valid(geographic), 0.0000001)
            polygons = list(polygon_parts(geographic))
            if not polygons:
                continue
            geographic = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
            geographic = shapely.orient_polygons(geographic, exterior_cw=False)
            values = {'height': height, 'ground': round(datum, 1), 'osmId': osm_id}
            if p.get('name'):
                values['name'] = name
            features.append({'type': 'Feature', 'properties': values, 'geometry': mapping(geographic)})
    if not features:
        raise ValueError('No roof volumes could be measured')
    data = {
        'type': 'FeatureCollection',
        'surveyDate': SURVEY,
        'sources': [
            'https://data.edmonton.ca/dataset/2025-Lidar-Full-Feature/sz3i-y5ze',
            'https://data.edmonton.ca/dataset/2025-Lidar-Bare-Earth/i85g-8mg6',
            'https://www.openstreetmap.org/copyright',
        ],
        'license': 'https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/',
        'features': features,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n')
    print('TOTAL', len(features), 'roof elevations for', len(sampled_footprints), 'current footprints')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('tiles', type=Path)
    parser.add_argument('output', type=Path, default=OUTPUT, nargs='?')
    options = parser.parse_args()
    build(options.tiles, options.output)
