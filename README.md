# ualberta-map

A simple map for finding buildings, rooms, and routes around the University of Alberta campus.

## Features

- Search for campus locations
- Plan outdoor and indoor routes
- View entrances and staircases
- Explore the Students' Union Building by floor

## Development

The frontend is TypeScript in `MapApp/client/`, compiled into the served modules
in `MapApp/wwwroot/` (no bundler; Leaflet stays a global loaded by `index.html`):

```sh
npm install
npm run build   # tsc -p MapApp/tsconfig.json → MapApp/wwwroot
npm test        # build, then node --test RoutingChecks/*.test.mjs
```

`dotnet build MapApp/MapApp.csproj` runs the client build automatically
(when `node_modules` exists); pass `-p:SkipClientBuild=true` to skip it.

