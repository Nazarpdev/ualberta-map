"""Build the photographed CSC Level 1 wayfinding plan and routing data.

Usage: python tools/build-csc.py
Plan x increases south and plan y increases west. The photograph establishes
the relative room and door layout. The fit to the campus footprint is schematic.
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'MapApp/wwwroot/indoor/csc'
OUT.mkdir(parents=True, exist_ok=True)

floor = dict(
    id=1,
    name='Level 1',
    crop=[0, 0, 1000, 1000],
    footprint=[
        [0, 966], [0, 390], [92, 390], [92, 294], [244, 294],
        [244, 210], [810, 210], [810, 0], [954, 0], [954, 151],
        [1000, 151], [1000, 277], [965, 277], [965, 474],
        [1000, 474], [1000, 955], [898, 955], [898, 1000],
        [330, 1000], [330, 918], [164, 918], [164, 966],
    ],
    partitions=[
        # Staggered washroom privacy walls.
        [[107, 737], [107, 702]],
        [[130, 702], [164, 702]],
        [[95, 546], [95, 581]],
        [[117, 581], [164, 581]],
        # North entrance vestibule and northwest staircase.
        [[66, 546], [164, 546], [164, 474]],
        [[92, 390], [151, 390]],
        [[164, 770], [179, 770]],
        [[264, 918], [264, 808]],
        [[264, 787], [264, 738]],
        [[248, 770], [264, 770]],
        [[286, 738], [310, 738]],
        [[330, 918], [330, 738]],
        # Northeast staircase.
        [[206, 345], [206, 474], [244, 474]],
        # Basement stair walls and the lobby's partition extensions.
        [[810, 474], [844, 474]],
        [[888, 474], [898, 474]],
        [[810, 282], [848, 282]],
        [[898, 396], [898, 315]],
        [[898, 396], [965, 396]],
        [[898, 277], [965, 277]],
        [[933, 277], [933, 249]],
    ],
)

nodes, edges = [], []


def node(key, x, y, kind='corridor', name=None, code=None, **extra):
    node_id = f'1:{key}'
    nodes.append(dict(id=node_id, floor=1, x=x, y=y, kind=kind, name=name, code=code, **extra))
    return node_id


def room(code, door, inward, name=None, category='Services'):
    """Place the route endpoint just inside the opening shown on the diagram."""
    x, y = door
    dx, dy = inward
    approach = node(f'{code}-approach', x - 9 * dx, y - 9 * dy)
    destination = node(
        code, x + 4 * dx, y + 4 * dy, 'room',
        name or f'Room {code}', code if code.startswith(('1-', 'WC-')) else None,
        category=category,
    )
    edges.append([approach, destination])


# Door centres and the directions into their rooms, following the posted plan.
room('1-05', (164, 748), (-1, 0))
room('WC-M', (164, 719), (-1, 0), "Men's washroom")
room('WC-W', (164, 564), (-1, 0), "Women's washroom")
room('1-13', (51, 390), (0, 1))
room('1-67', (366, 798), (0, 1))
room('1-59', (708, 740), (0, 1))
room('1-53', (844, 740), (0, 1))
room('1-49', (898, 793), (1, 0), category='Offices')
room('1-47', (898, 721), (1, 0))
room('1-41', (898, 511), (1, 0), category='Offices')
room('1-39', (898, 409), (1, 0), category='Offices')
room('1-66', (405, 678), (0, -1), category='Offices')
room('1-24', (407, 535), (0, 1), category='Offices')
room('1-64', (459, 678), (0, -1), category='Offices')
room('1-26', (461, 535), (0, 1), category='Offices')
room('1-28', (584, 678), (0, -1))
room('1-32', (681, 535), (0, 1), category='Offices')
room('1-40', (838, 545), (-1, 0), category='Offices')
room('1-21', (298, 474), (0, -1))
room('1-25', (425, 474), (0, -1))
room('1-29', (578, 474), (0, -1))
room('1-33', (810, 466), (-1, 0), category='Offices')
room('1-35', (810, 407), (-1, 0), category='Offices')
room('1-37', (810, 292), (-1, 0), category='Offices')
room('lift', (286, 606), (1, 0), 'Lift')

# These are the ground-level door nodes in the campus map. Their plan positions
# follow the photographed wayfinding diagram, which has schematic proportions.
node('entry-west', 207, 918, 'entrance', 'West entrance', campus=[53.526898, -113.527423])
node('entry-south', 1000, 212, 'entrance', 'South entrance', campus=[53.526607, -113.526899])
node('entry-north', 92, 344, 'entrance', 'North entrance', campus=[53.526996, -113.526963])
# The plan shows 1-13 opening onto the exterior approach beside the north door.
edges.append(['1:entry-north', '1:1-13-approach'])
node('nw-stairs', 298, 844, 'stairs', 'Northwest stairs')
node('ne-stairs', 211, 333, 'stairs', 'Northeast stairs')
node('south-stairs', 934, 348, 'stairs', 'Access to basement lecture theatres')
node('se-stairs', 884, 113, 'stairs', 'Southeast stairs')
node('Athabasca', 945, 7, 'room', 'Access to Athabasca Hall', 'Athabasca', category='Corridors')

floor['spaces'] = json.loads(Path(__file__).with_name('csc-spaces.json').read_text(encoding='utf-8'))['1']
by_id = {item['id']: item for item in nodes}
for space in floor['spaces']:
    if 'node' in space:
        room_node = by_id[space['node']]
        space['name'] = room_node['name']
        space['code'] = room_node['code']
        space['category'] = room_node['category']
        if space.get('icon'):
            room_node['amenity'] = space['icon']
    if 'destination' in space:
        assert space['destination'] in by_id

data = dict(
    building='Computing Science Centre',
    bounds=[[53.526591, -113.52748], [53.527007, -113.526745]],
    source='Photograph of the posted CSC Level 1 wayfinding plan',
    floors=[floor],
    nodes=nodes,
    edges=edges,
)
(OUT / 'map.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'Wrote {len(nodes)} routing nodes and {len(floor["spaces"])} vector spaces to {OUT}')
