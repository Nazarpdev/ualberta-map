"""Build the hand-traced CSC Level 1 vector map and routing graph.

Usage: python tools/build-csc.py
Python standard library only. Plan units are schematic (1000x1000 frame fitted
to the OSM footprint); no raster floor images are embedded or rendered. Room
polygons and label areas are maintained in csc-spaces.json; corridor routes
are below. Conventions match tools/build-sub.py: plan x grows south, plan y
grows west, and mapping to geography is a linear crop/bounds fit.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'MapApp/wwwroot/indoor/csc'
OUT.mkdir(parents=True, exist_ok=True)
floors = [
    dict(id=1, name='Level 1', crop=[0, 0, 1000, 1000],
         # The plan outline follows the photographed diagram. The east side
         # stays straight through rooms 1-21, 1-25 and 1-29, then widens into
         # the Athabasca Hall access lobby.
         footprint=[[0,1000],[0,89],[743,89],[743,0],[1000,0],[1000,1000]],
         partitions=[
             # Washroom privacy walls, traced as the two L-shaped separators.
             [[75,744],[75,700],[125,700]],
             [[70,511],[70,556],[125,556]],
         ]),
]
nodes, edges = [], []

def node(floor, key, x, y, kind='corridor', name=None, code=None, **extra):
    id = f'{floor}:{key}'
    nodes.append(dict(id=id, floor=floor, x=x, y=y, kind=kind, name=name, code=code, **extra))
    return id

def chain(floor, points):
    ids = []
    for key, x, y in points:
        id = f'{floor}:{key}'
        if not any(n['id'] == id for n in nodes):
            node(floor, key, x, y)
        ids.append(id)
    edges.extend([a, b] for a, b in zip(ids, ids[1:]))

def room(floor, code, name, x, y, via, category='Services'):
    id = node(floor, code, x, y, 'room', name, code, category=category)
    edges.append([f'{floor}:{via}', id])

def stair(floor, key, x, y, via, name):
    id = node(floor, key, x, y, 'stairs', name)
    edges.append([f'{floor}:{via}', id])

# North lobby and corridor across the top of the building.
chain(1, [('n-entry',60,290),('nc-e',210,330),('nc',200,520),('nc-w',200,750),
          ('w-top',300,750),('w-entry',285,900)])
# West corridor serving the west room column and the centre block.
chain(1, [('w-top',300,750),('wc-n',340,665),('w66',515,665),('w64',575,665),
          ('w28',660,665),('w32',745,665),('w53',765,665),('w40',805,665),
          ('wc-s',860,690),('sw-j',875,715),('sc-w',890,740)])
# South corridor along the Level 1 south rooms, joining the centre-east spine.
chain(1, [('sc-w',890,740),('sc47',890,615),('sc-m',890,500),('sc41',890,440),
          ('sc-e',890,350),('cc-se',860,330)])
# Centre-east corridor between the centre block and the east room column.
chain(1, [('cc-n',280,395),('cc21',395,395),('cc-m',550,395),('cc29',670,395),
          ('cc-s',800,395),('cc-se',860,330)])
# Cross-links: elevator hall and the north/centre-east junction.
chain(1, [('nc',200,520),('elev-hall',330,530)])
chain(1, [('elev-hall',330,530),('cc-n',280,395)])
chain(1, [('nc-e',210,330),('cc-n',280,395)])
# South-east lobby: basement-theatre access, Athabasca Hall exit and stairs.
chain(1, [('cc-se',860,330),('se-hall',930,270),('lobby-e',950,150),('se-lobby',900,150)])
chain(1, [('se-hall',930,270),('lob35',850,200)])
for key, name, via, xy, campus in [
    ('entry-west','West entrance','w-entry',(262,922),[53.526898,-113.527423]),
    ('entry-south','South entrance','s-entry',(962,210),[53.526607,-113.526899]),
    ('entry-north','North entrance','n-entry',(26,296),[53.526996,-113.526963]),
]:
    id = node(1,key,*xy,'entrance',name,campus=campus)
    edges.append([f'1:{via}',id])
node(1,'s-entry',945,220)
edges.append(['1:se-lobby','1:s-entry'])
node(1,'bump',970,360)
edges.append(['1:se-hall','1:bump'])
stair(1, 'nw-stairs', 257, 878, 'w-top', 'Northwest stairs')
stair(1, 'ne-stairs', 167, 178, 'nc-e', 'Northeast stairs')
stair(1, 'south-stairs', 910, 367, 'sc-e', 'South stairs')
stair(1, 'se-stairs', 896, 67, 'se-lobby', 'Southeast stairs')
room(1,'1-05',f'Room 1-05',90,850,'nc-w')
room(1,'WC-M',"Men's washroom",90,645,'nc','Offices')
room(1,'WC-W',"Women's washroom",90,535,'nc','Offices')
room(1,'1-13',f'Room 1-13',90,395,'nc')
room(1,'1-67',f'Room 1-67',475,855,'wc-n')
room(1,'1-59',f'Room 1-59',625,855,'w64')
room(1,'1-53',f'Room 1-53',765,855,'w53')
room(1,'1-49',f'Room 1-49',905,875,'sc-w','Offices')
room(1,'1-47',f'Room 1-47',930,615,'sc47')
room(1,'1-41',f'Room 1-41',925,440,'sc41','Offices')
room(1,'1-39',f'Room 1-39',925,365,'sc-e','Offices')
room(1,'1-66',f'Room 1-66',515,600,'w66','Offices')
room(1,'1-24',f'Room 1-24',515,487,'cc-m','Offices')
room(1,'1-64',f'Room 1-64',575,577,'w64','Offices')
room(1,'1-26',f'Room 1-26',575,487,'cc-m','Offices')
room(1,'1-28',f'Room 1-28',660,600,'w28')
room(1,'1-32',f'Room 1-32',745,695,'w32','Offices')
room(1,'1-40',f'Room 1-40',805,700,'w40','Offices')
room(1,'1-21',f'Room 1-21',395,280,'cc21')
room(1,'1-25',f'Room 1-25',530,220,'cc-m')
room(1,'1-29',f'Room 1-29',670,180,'cc29')
room(1,'1-33',f'Room 1-33',780,310,'cc-s','Offices')
room(1,'1-35',f'Room 1-35',780,200,'lob35','Offices')
room(1,'1-37',f'Room 1-37',780,80,'se-lobby','Offices')
room(1,'Athabasca','Access to Athabasca Hall',875,25,'se-lobby','Corridors')

spaces = json.loads(Path(__file__).with_name('csc-spaces.json').read_text(encoding='utf-8'))
by_id = {n['id']: n for n in nodes}
for floor in floors:
    floor['spaces'] = spaces[str(floor['id'])]
    for space in floor['spaces']:
        if 'node' in space:
            room_node = by_id[space['node']]
            assert room_node['floor'] == floor['id']
            space['name'] = room_node['name']
            space['code'] = room_node['code']
            space['category'] = room_node['category']
            if space.get('polygon'):
                xs, ys = zip(*space['polygon'])
                room_node['x'] = (min(xs) + max(xs)) / 2
                room_node['y'] = (min(ys) + max(ys)) / 2
            if space.get('icon'):
                room_node['amenity'] = space['icon']
        if 'destination' in space:
            assert space['destination'] in by_id

data = dict(building='Computing Science Centre',
            bounds=[[53.526591,-113.52748],[53.527007,-113.526745]],
            source='CSC Level 1 wayfinding plan',
            floors=floors, nodes=nodes, edges=edges)
(OUT/'map.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
print(f'Wrote {len(nodes)} routing nodes and {sum(len(f["spaces"]) for f in floors)} vector spaces to {OUT}')
