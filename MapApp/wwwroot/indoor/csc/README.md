# CSC indoor map

Level 1 of the Computing Science Centre is traced from a photograph of the
posted wayfinding sign. The plan includes the labelled rooms, room openings,
three campus entrances, four stairs, the lift, washrooms, campus phones, and
the Athabasca Hall connection. Interior destinations route to their mapped
doors. Room 1-13 uses the exterior approach beside the north entry visible
on the sign.

The photo establishes the relative layout. Its overlay on the campus map
uses a schematic fit to the geographic bounds of the building. Outdoor
route legs use the separately mapped campus door coordinates. The sign
provides no dimensions or surveyed alignment points.

The plan appears at zoom level 19 and above. Selecting a room, label, or
amenity sets a route endpoint. The south stair is the Level 1 destination
for basement lecture theatres, and the Athabasca Hall destination stops at
the passage from CSC. The indoor map covers Level 1.

## Data and implementation

- `tools/csc-spaces.json` holds room and amenity outlines and label areas.
- `tools/build-csc.py` holds the traced perimeter, partitions, room access
  points, and campus doors. The shared router connects clear paths through
  the corridor geometry.
- `tools/csc-diagram.svg` renders the same map used by the app for comparison
  with the sign. The source photograph is separate from the map layers.

Regenerate both checked-in outputs with standard Python:

```sh
python3 tools/build-csc.py
python3 tools/csc-diagram.py
```

The University of Alberta lists the west entrance as a DATS pickup location,
identifies seven of the numbered rooms as labs, and identifies the Computing
Science Help Desk as CSC 1-32. [DATS locations](https://www.ualberta.ca/en/campus-operations-services/dats-locations-on-campus.html),
[lab facilities](https://www.ualberta.ca/en/computing-science/resources/labs-and-room-booking/lab-facilities.html),
[department contact page](https://www.ualberta.ca/en/computing-science/contact-us/index.html).
