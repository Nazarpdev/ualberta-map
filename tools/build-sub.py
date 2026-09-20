"""Build the hand-traced SUB vector map and routing graph.

Usage: python tools/build-sub.py
Python standard library only. Coordinates refer to a 1200px-wide reference
of the 2024 plans, but no PDF images are embedded or rendered. Room polygons
and label areas are maintained in sub-spaces.json; corridor routes are below.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'MapApp/wwwroot/indoor/sub'
OUT.mkdir(parents=True, exist_ok=True)
floors = [
    dict(id=0, name='Lower', file='SUB-lower2024.pdf', crop=[190, 174, 688, 772],
         footprint=[[190,330],[340,330],[340,174],[642,174],[642,253],[688,253],[688,519],[642,519],[642,772],[190,772]]),
    dict(id=1, name='Main', file='SUB-main2024.pdf', crop=[213, 178, 643, 747],
         footprint=[[213,367],[326,367],[326,318],[343,318],[343,238],[377,238],[377,178],[570,178],[570,273],[603,273],[603,300],[643,300],[643,530],[604,530],[604,747],[213,747]]),
    dict(id=2, name='Level 2', file='SUB-2ndfloor2024.pdf', crop=[244, 165, 638, 754],
         footprint=[[244,360],[363,360],[363,309],[407,309],[407,165],[638,165],[638,754],[244,754]]),
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

# Main floor: public spine west of SUBmart, north/south food-court passages,
# and the western services corridor. No shortcuts through shop polygons.
chain(1, [('quad',393,184),('east',393,250),('food-n',393,328),('vest',393,350),
          ('middle',393,447),('mart-n',393,480),('mart-mid',393,555),('photo',393,641),
          ('west-j',393,674),('west-turn',384,690),('industrial',384,743)])
chain(1, [('vest',393,350),('vest-door',373,350),('north-hall',343,350),('north-exit',326,350)])
chain(1, [('middle',393,447),('alumni-hall',286,447),('alumni-door',286,421)])
chain(1, [('middle',393,447),('food-s',489,447),('south-j',589,447),('admin',589,290)])
chain(1, [('food-n',393,328),('food-ne',430,328),('food-mid',489,328),('food-entry',489,420),('food-s',489,447)])
chain(1, [('food-s',489,447),('stage-hall',489,480),('stage',489,514),('fountain-e',554,556),
          ('west-lobby',554,578),('counter-gap-n',498,578),('counter-gap-s',498,615),
          ('services-e',515,615),('services',495,641),('photo-e',468,641)])
chain(1, [('photo',393,641),('photo-in',416,641),('photo-e',468,641)])
chain(1, [('services',495,641),('services-door-n',508,650),('services-door-s',508,666),
          ('services-w',495,673),('foodbank-hall',529,673)])
stair(1, 'north-stairs', 341,329,'north-hall','North stairs')
stair(1, 'west-stairs', 425,678,'west-j','West stairs')
stair(1, 'atrium-stairs', 625,362,'admin','Atrium stairs')
for key, name, via, xy, campus in [
    ('entry-quad','Quad entrance','quad',(393,178),[53.525407,-113.5263]),
    ('entry-north','North entrance','north-exit',(321,350),[53.525459,-113.526773]),
    ('entry-west','Industrial Design entrance','industrial',(384,747),[53.525367,-113.527955]),
]:
    id = node(1,key,*xy,'entrance',name,campus=campus)
    edges.append([f'1:{via}',id])
room(1,'1-14','Alumni Room',274,421,'alumni-door','Student Space')
room(1,'1-10','UHC Pharmacy',373,522,'mart-mid','Businesses')
room(1,'1-12','Teapsy',350,480,'mart-n','Food')
room(1,'1-40','SUBmart',409,490,'mart-n','Food')
room(1,'1-44','SUBphoto',462,624,'photo-e','Businesses')
room(1,'1-60','University Bookstore',378,600,'photo','Businesses')
room(1,'1-78','Bijan Optical',450,656,'photo-e','Businesses')
room(1,'1-80','Academic Success Centre',489,694,'services-w')
room(1,'1-81','Campus Food Bank',539,665,'foodbank-hall')
room(1,'1-82','SUBstage',478,514,'stage','Venues')
room(1,'1-27–32','Food Court',470,402,'food-entry','Food')
# The theatre's published room number starts with 2, but its entrance is on Main.
room(1,'2-500','Myer Horowitz Theatre (main-level entrance)',376,300,'food-n','Venues')
chain(1, [('services-e',515,615),('parkade-lobby',579,615),('parkade-door',596,623),('parkade-mid',596,688)])
room(1,'Parkade','Pedway to Stadium Parkade',596,747,'parkade-mid','Corridors')
room(1,'WC-West','West washrooms',390,704,'west-turn','Offices')
room(1,'WC-East','East all-gender washroom',429,245,'east','Offices')

# Level two: one public spine with room doors branching from it.
chain(2, [('north-hall',379,344),('east-j',449,344),('typ',449,366),('fph',449,385),
          ('ccs',449,403),('dean',449,435),('wellness',449,461),('uhc',449,502),
          ('cross',449,512),('ombuds',449,525),('uri',449,579),('career',449,585),
          ('dinwoodie',449,630),('west-j',449,638),('west-bottom',449,741)])
chain(2, [('cross',449,512),('sac-hall',558,512),('peer-hall',523,512)])
chain(2, [('west-j',449,638),('events-hall',500,638),('su-hall',519,646)])
stair(2,'north-stairs',379,322,'north-hall','North stairs')
stair(2,'west-stairs',465,669,'west-j','West stairs')
room(2,'2-000','Dinwoodie Lounge',437,630,'dinwoodie','Venues')
room(2,'2-100','Career Centre',437,585,'career')
room(2,'2-200','University Health Centre (UHC)',437,502,'uhc')
room(2,'2-300','Wellness Supports',437,461,'wellness')
room(2,'2-400','First Peoples’ House',437,385,'fph')
room(2,'2-600','Counselling and Clinical Services',457,403,'ccs')
room(2,'2-701','Undergraduate Research Initiative',457,579,'uri')
room(2,'2-702','Office of the Student Ombuds',457,525,'ombuds')
room(2,'2-705','Sexual Assault Centre',558,501,'sac-hall')
room(2,'2-707','Peer Support Centre',523,520,'peer-hall')
room(2,'2-727','Transition Year Program',459,366,'typ')
room(2,'2-725','Dean of Students Meeting Room',457,435,'dean','Offices')
room(2,'2-800','Horowitz Events Centre Offices',500,617,'events-hall','Offices')
room(2,'2-900','Students’ Union Executive & Administrative Offices',519,657,'su-hall','Offices')
chain(2, [('west-bottom',449,741),('pedway-turn',449,745),('ag-pedway',350,745)])
room(2,'Ag-Pedway','Pedway to Agriculture / Forestry Centre',244,745,'ag-pedway','Corridors')
chain(2, [('west-j',449,638),('wc-hall',481,647)])
room(2,'WC','Washrooms',481,656,'wc-hall','Offices')

# Lower floor: curve around SUBprint/ATB, meeting-room corridor and west spine.
chain(0, [('north-hall',353,340),('curve-a',370,355),('curve-b',396,386),('curve-c',429,414),
          ('curve-d',464,434),('curve-e',507,445),('atrium',558,449),('east-atrium',636,407),
          ('east-hall',636,352),('atrium-foot',653,385)])
chain(0, [('curve-c',429,414),('junction',425,434),('west-spine',425,470),('west-mid',425,565),
          ('west-lobby',425,646),('west-stair-hall',425,660)])
chain(0, [('junction',425,434),('cascade-hall',377,434),('orion-hall',335,434),('meeting-j',253,434),
          ('meeting-n',253,365)])
chain(0, [('meeting-j',253,434),('cypress-hall',276,460),('cypress-door',276,483)])
chain(0, [('atrium',558,449),('filistix-hall',493,455),('west-spine',425,470)])
chain(0, [('atrium',558,449),('slc-hall',587,477),('plaza-hall',614,545),('quiet-hall',613,585),
          ('caribou-hall',520,585),('caribou-west',520,637),('west-lobby',425,646)])
chain(0, [('caribou-west',520,637),('cjsr-hall',520,671)])
chain(0, [('east-hall',636,352),('landing-hall',620,352),('workspaces',561,352)])
stair(0,'north-stairs',353,314,'north-hall','North stairs')
stair(0,'west-stairs',425,676,'west-stair-hall','West stairs')
stair(0,'atrium-stairs',671,324,'atrium-foot','Atrium stairs')
room(0,'0-31','Marigold Room',241,365,'meeting-n','Venues')
room(0,'0-33','Juniper Room',241,375,'meeting-n','Venues')
room(0,'0-41','Cypress Room',276,489,'cypress-door','Venues')
room(0,'0-48','Kihiw Room',387,405,'curve-b','Venues')
room(0,'0-49','Cascade Room',377,443,'cascade-hall','Venues')
room(0,'0-51','Orion Room',335,424,'orion-hall','Venues')
room(0,'0-77','Caribou Room',530,597,'caribou-hall','Venues')
room(0,'0-90','Carlson Construction Quiet Lounge',613,596,'quiet-hall','Student Space')
room(0,'0-12','University Bookstore',415,607,'west-lobby','Businesses')
room(0,'0-60','SUBprint',480,429,'curve-d','Businesses')
room(0,'0-64','ATB Financial',579,425,'atrium','Businesses')
room(0,'0-71','Filistix',490,471,'filistix-hall','Food')
room(0,'0-09','CJSR',508,671,'cjsr-hall','Offices')
room(0,'0-11','Student Group Workrooms',475,659,'west-lobby')
room(0,'0-68A','The Landing',617,366,'landing-hall')
room(0,'0-68B','UASU Elections Office',617,341,'landing-hall')
room(0,'0-81','Student Life Central',560,491,'slc-hall')
room(0,'WC','Washrooms',399,355,'curve-a','Offices')

for key in ['north-stairs','west-stairs']:
    edges.extend([[f'0:{key}',f'1:{key}'],[f'1:{key}',f'2:{key}']])
edges.append(['0:atrium-stairs','1:atrium-stairs'])

spaces = json.loads(Path(__file__).with_name('sub-spaces.json').read_text(encoding='utf-8'))
by_id = {n['id']: n for n in nodes}
for floor in floors:
    floor['partitions'] = {
        0: [[[412,330],[412,355]], [[398,365],[442,365]]],
        1: [[[411,693],[411,747]]],
        2: [[[492,656],[492,697]]]
    }[floor['id']]
    floor['spaces'] = spaces[str(floor['id'])]
    for space in floor['spaces']:
        if 'node' in space:
            room_node = by_id[space['node']]
            assert room_node['floor'] == floor['id']
            space['name'] = room_node['name']
            space['code'] = room_node['code']
            space['category'] = room_node['category']
            if space.get('icon'):
                room_node['amenity'] = space['icon']
        if 'destination' in space:
            assert space['destination'] in by_id

def interpolate(value, pairs):
    for a, b in zip(pairs, pairs[1:]):
        if value <= b[0]:
            return a[1] + (value-a[0])/(b[0]-a[0])*(b[1]-a[1])
    a, b = pairs[-2:]
    return a[1] + (value-a[0])/(b[0]-a[0])*(b[1]-a[1])

# Survey frame: OSM facade steps and the three mapped entrance nodes, rather
# than stretching each schematic PDF to the building's bounding rectangle.
main_x = [[213,53.525652],[321,53.525459],[377,53.525442],
          [393,53.525407],[570,53.524989],[604,53.524948],[643,53.524906]]
main_y = [[178,-113.5263],[318,-113.526711],[350,-113.526773],
          [367,-113.526847],[530,-113.527409],[747,-113.527955]]
lat = lambda x: interpolate(x, main_x)
lon = lambda y: interpolate(y, main_y)
floors[1]['registration'] = dict(x=main_x, y=main_y)
# Tie matching stair shafts together across floors. PDF diagrams use different
# proportions, so their independent crops are not geographic control points.
floors[0]['registration'] = dict(
    x=[[190,lat(213)],[353,lat(341)],[425,lat(425)],[671,lat(625)],[688,lat(643)]],
    y=[[174,lon(178)],[314,lon(329)],[324,lon(362)],[676,lon(678)],[772,lon(747)]])
floors[2]['registration'] = dict(
    x=[[244,lat(213)],[379,lat(341)],[465,lat(425)],[638,lat(570)]],
    y=[[165,lon(178)],[322,lon(329)],[669,lon(678)],[754,lon(747)]])
campus = json.loads((OUT.parents[1] / 'map.geojson').read_text(encoding='utf-8'))
footprint = next(f['geometry']['coordinates'][0] for f in campus['features']
                 if f['properties'].get('@id') == 'way/217652077')
registration = dict(
    source='OSM way/217652077; mapped Quad, north and Industrial Design entrances',
    westCorrection=dict(south=lat(570), center=lat(384), north=lat(213),
                        east=lon(350), west=lon(747), delta=53.525367-lat(384)))
data = dict(building="Students' Union Building", bounds=[[53.524906,-113.527955],[53.525655,-113.526295]],
            footprint=footprint, registration=registration,
            source='UASU SUB floor plans, 2024', floors=floors, nodes=nodes, edges=edges)
(OUT/'map.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
print(f'Wrote {len(nodes)} routing nodes and {sum(len(f["spaces"]) for f in floors)} vector spaces to {OUT}')
