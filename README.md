# ualberta-map

A simple map for finding buildings, rooms, and routes around the University of Alberta campus.

## Features

- Search for campus locations
- Plan outdoor and indoor routes
- View entrances and staircases
- View North Campus building footprints and survey-based 3D roof volumes
- Explore the lower, main, and second floors of the Students' Union Building
- Explore Level 1 of the Computing Science Centre and University Commons

## Map sources

The campus overview uses OpenStreetMap. University wayfinding, current building directories, and local corrections inform the outdoor layer. [U of A campus maps](https://www.ualberta.ca/en/maps.html) · [OpenStreetMap](https://www.openstreetmap.org/copyright)

The indoor layers are schematic and geographically aligned to mapped buildings and doors. Their source notes describe the coverage and reference plans for [SUB](MapApp/wwwroot/indoor/sub/README.md), [CSC](MapApp/wwwroot/indoor/csc/README.md), and [University Commons](MapApp/wwwroot/indoor/commons/README.md).

The 3D view combines building footprints with June 2025 City of Edmonton LiDAR. It shows simplified roof volumes from the survey. Buildings with insufficient or outdated height data are available in the 2D overview. [3D sources, coverage, and rebuild instructions](tools/campus-elevation.md)

## Development

The frontend is TypeScript in `MapApp/client/`, compiled into the served modules
in `MapApp/wwwroot/`. The page serves Leaflet 1.9.4 from `wwwroot/vendor/leaflet/`.

```sh
npm install
npm run build   # tsc -p MapApp/client/tsconfig.json → MapApp/wwwroot
npm test        # build, then node --test RoutingChecks/*.test.mjs
```

`dotnet build MapApp/MapApp.csproj` runs the client build automatically
(when `node_modules` exists); pass `-p:SkipClientBuild=true` to skip it.

