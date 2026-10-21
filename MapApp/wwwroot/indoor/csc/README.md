# CSC indoor map

Level 1 of the Computing Science Centre is a **hand-traced vector map** based
on the user-supplied CSC Level 1 wayfinding plan. `map.json` holds room
polygons, room-interior label areas, the building outline and the connected
corridor/room/stair routing graph. There are no raster floor images or
baked-in symbols. The tracing and its alignment to the campus footprint are
schematic: the source image is stretched relative to the OSM footprint, so
rooms were fitted inside the mapped walls rather than traced literally.

Only Level 1 is mapped, so there is no floor switcher; the plan appears when
zoomed to level 19+ over CSC. Clicking a room, room label or amenity badge
selects it; clicking an open indoor area places a pin on Level 1 and connects
it to a corridor without crossing room walls.

Routes combine with campus legs through the three mapped entrances (west,
south and north), each tied to the OSM door node and its walkway. The east
"Access to basement lecture theatres" stair and the "Athabasca Hall Access"
exit are routable destinations that stop at CSC's end; the interiors beyond
them (basement theatres, Athabasca Hall) are not mapped here.

## Data and implementation

`tools/build-csc.py` is the editable source for the coordinate frame,
corridor vertices, room access points and entrances. `tools/csc-spaces.json`
contains the hand-traced room/space outlines and their label areas. Plan
conventions match `tools/build-sub.py` (x grows south, y grows west), but the
geographic fit is a plain linear crop/bounds mapping with no surveyed
registration control points.

`indoor-building.mjs` is the shared plan-display and routing implementation
behind SUB (`sub-map.mjs`) and CSC (`csc-map.mjs`); `sub-plan.mjs` draws both
buildings' SVG layers in separate panes. Cross-building routes (CSC to SUB,
or either building to an outdoor point) are assembled in `map.js`, which joins
each indoor leg to the campus API through its cheapest entrance. These served
modules are compiled from the TypeScript sources in `MapApp/client/`
(`npm run build`).

To regenerate map data (standard Python only; no Python dependency at runtime):

```powershell
python tools/build-csc.py
```
