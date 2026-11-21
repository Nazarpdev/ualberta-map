# Campus elevation data

The 3D view uses 299 estimated roof sections across 136 mapped North Campus footprints. Both elevation rasters come from the City of Edmonton flight on June 29–30, 2025. Building outlines come from the same OpenStreetMap data used by the campus map. [Full Feature LiDAR](https://data.edmonton.ca/dataset/2025-Lidar-Full-Feature/sz3i-y5ze) · [Bare Earth LiDAR](https://data.edmonton.ca/dataset/2025-Lidar-Bare-Earth/i85g-8mg6) · [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

The generator aligns the two City rasters on a 1 m grid in EPSG:3776. It checks that a mapped footprint has sufficient elevated samples, uses the median bare-earth elevation under the footprint as its base, and estimates roof heights from the Full Feature surface. Broad areas with distinct elevations produce separate horizontal sections. The volumes represent approximate exterior massing at the survey date. Current buildings with limited survey support, elevated connectors, open shelters, and the renovated First Peoples’ House are represented by their map footprints. [First Peoples’ House reopening](https://www.ualberta.ca/en/folio/2026/08/first-peoples-house-opens-new-legacy.html)

`height` is in metres above the section’s local base. `ground` is that base elevation in metres in the City raster datum. `osmId` identifies the corresponding footprint in the campus map. Elevations are rounded to a tenth of a metre for display.

Contains information licensed under the Open Government Licence – City of Edmonton. [Licence](https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/)

## Rebuild with the survey tiles

Use the paired `ff_*.tif` and `be_*.tif` files for `023_039`, `023_040`, `024_039`, `024_040`, `024_041`, `024_042`, `025_039`, `025_040`, `025_041`, `025_042`, `026_040`, and `026_041`. The City indexes these in the remote sensing tiling grid. [Tile grid](https://data.edmonton.ca/dataset/Remote-Sensing-Tiling-Grid/v59u-75mc/)

Extract the TIFFs in one directory and pass the directory to the generator.

```sh
python3 -m pip install numpy pyproj rasterio 'shapely>=2.1'
python3 tools/build-campus-elevation.py /path/to/survey-tiles
```
