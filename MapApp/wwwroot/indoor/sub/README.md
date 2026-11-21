# SUB indoor map

Lower, Main and Level 2 are **hand-traced vector maps** based on the 2024 UASU
floor plans. `map.json` holds room polygons, label areas, outlines and the
corridor, room and stair routing graph. The traces and their alignment to the
campus footprint are schematic. UASU publishes a room directory for the tower
floors, which are outside the mapped area. [UASU floor plans and directory](https://www.su.ualberta.ca/this-is-your-space/this-is-your-students-union-building/whats-in-sub/)

## Use

- Zoom to level 19 or closer over SUB, or start a route to or from a SUB room.
- Switch **Lower / Main / Level 2** with the side buttons.
- Search by room number or service name in either route input, or click a green
  room dot or the room itself. Clicking an open indoor area places a pin on the
  selected floor and connects it to a corridor without crossing room walls.
  Two nearby indoor pins can be routed independently.
- Each route displays only its current-floor segment. Floor-change buttons name
  the staircase and select the next floor. Campus legs can connect through the
  Lower-level plaza door or one of four mapped Main entrances. The passage beside
  the loading dock connects to the crossing north of SUB through an outdoor link
  in `routing-overrides.geojson`. [Lower-level plaza entrance](https://www.ualberta.ca/en/governance/media-library/documents/member-zone/gfc-standing-committees/fdc-motions/2013-04-25-fdc-motions.pdf)
- **Show staircases** controls the single set of purple stair icons, not whether
   stairs may be used in a route. No staircase icons are embedded in the map artwork.
- The southern atrium staircase on Lower and Main includes vector outlines,
  broad seating steps and narrow walking treads based on the source PDFs.
  These floor-plan details remain visible when staircase icons are hidden.
- The theatre **2-500** is intentionally routed to its main-level entrance.
- **WC** badges mark washroom areas on each floor. Hover for the facilities shown
  on the source plan; select the badge or search for a washroom to route to its access point.
- Arrow badges mark the **Stadium Parkade pedway on Main** and the **Agriculture /
  Forestry pedway on Level 2**. Routes stop at SUB's end of the connection; the
  interiors of the connected buildings are not mapped here.
- Lift badges identify the lift locations in the plans. Floor-changing routes
  still use the explicitly mapped stairs.

## Data and implementation

The mapped shops and services include updates after the 2024 plans were published.
Bestea replaced Teapsy in 1-11, and the Student Group Flex Space occupies 0-11.
The lower-level ATB branch closed. Its ATM is on Main. First Peoples’ House and
its Transition Year Program moved to Education Centre South. The map retains
the former suites' room numbers where current occupants are unverified.
[Students’ Council leasing record](https://www.su.ualberta.ca/media/uploads/assets/CouncilOrderPapers/SC-2023-26-LA-20240416_ZD8EZ50.pdf),
[UASU Flex Space](https://docs.su.ualberta.ca/books/student-group-services/page/student-group-flex-space),
[ATB campus branch closure](https://www.atb.com/personal/student/),
[ATB ATM location](https://www.atb.com/resources/find-a-location/university-of-alberta-sub-main-level/),
[First Peoples’ House relocation](https://www.ualberta.ca/en/folio/2026/08/first-peoples-house-opens-new-legacy.html)

`tools/build-sub.py` is the editable source for floor coordinate frames, corridor
vertices, room access points and stair links. `tools/sub-spaces.json` contains the
hand-traced room/space outlines and their label areas. Coordinates refer to the
original plans at 1200 pixels wide, but the generator uses only Python's standard
library and does not read or render a PDF. Each floor has its own coordinate frame
and shares the SUB geographic bounding box.

Adjacent rooms use identical shared-wall coordinates. Washroom partitions are
stored separately from their grouped amenity icons. Do not globally snap nearby
coordinates: narrow gaps such as the lower-level office hallway and second-floor
central corridor are intentional. Regression checks cover shared walls and the
Stadium Parkade route beside the food bank.

`sub-plan.mjs` draws native Leaflet SVG polygons and door openings. Text is rendered
separately as upright HTML labels, fitted inside each room's label area. On zoom,
labels reflow, fall back to room numbers where needed, and hide if they would
overlap another label or an icon. Small rooms retain full-name hover tooltips and
searchable destinations even when their label is hidden.

`indoor-router.mjs` runs Dijkstra over `(floor, node)` identities. Only explicitly
linked stair nodes can change floors. The north and west staircases link all
three levels; the atrium staircase links Lower and Main. Elevator routing is not modelled.

`sub-map.mjs` connects indoor routes to the campus API. Campus requests use
`avoidSub=true`, excluding the old footprint-based shortcuts through SUB so that
the indoor leg controls travel inside the building. A visibility toggle never
changes graph connectivity.

To regenerate map data (standard Python only; no Python dependency at runtime):

```powershell
python tools/build-sub.py
```

Checks from the repository root:

```sh
npm install
npm test
dotnet run --project RoutingChecks -- MapApp/wwwroot/map.geojson
```

The Node tests run against the built modules in `MapApp/wwwroot/` after `npm
run build` (`npm test` does both). `RoutingChecks/sub-ui.cjs` is an optional
Playwright/Edge browser smoke check. Start the app on port 5287 (or set
`SUB_TEST_URL`), install Playwright in your test environment, and run `node
RoutingChecks/sub-ui.cjs`.
