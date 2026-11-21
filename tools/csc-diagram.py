"""Render the current CSC Level 1 data as an SVG for comparison with the sign."""

import json
from html import escape
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
MAP = TOOLS.parent / 'MapApp/wwwroot/indoor/csc/map.json'
FLOOR_FILL = '#edf0ec'
WALL = '#52645b'
ROOM_FILL = '#dce6df'


def path(points, closed=False):
    commands = ' '.join(f'{"M" if i == 0 else "L"} {1000 - y} {x}' for i, (x, y) in enumerate(points))
    return commands + (' Z' if closed else '')


def label(point, value, size=19):
    x, y = point
    return (
        f'<text x="{1000 - y}" y="{x}" font-size="{size}" fill="#25362c" '
        f'text-anchor="middle" dominant-baseline="central">{escape(value)}</text>'
    )


def svg(data):
    floor = data['floors'][0]
    nodes = {node['id']: node for node in data['nodes']}
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -80 1060 1110" font-family="system-ui,sans-serif">',
        '<rect x="-30" y="-80" width="1060" height="1110" fill="#fff"/>',
        '<text x="0" y="-30" font-size="28" font-weight="600" fill="#25362c">Computing Science Centre · Level 1</text>',
        f'<path d="{path(floor["footprint"], True)}" fill="{FLOOR_FILL}" stroke="{WALL}" stroke-width="3"/>',
    ]
    for space in floor['spaces']:
        if polygon := space.get('polygon'):
            out.append(f'<path d="{path(polygon, True)}" fill="{ROOM_FILL}" stroke="{WALL}" stroke-width="1.4"/>')
    for line in floor['partitions']:
        out.append(f'<path d="{path(line)}" fill="none" stroke="{WALL}" stroke-width="1.4"/>')

    # Access nodes are just inside their room wall. Draw each opening where the
    # approach-to-room edge crosses it, using the offsets in build-csc.py.
    for start, end in data['edges']:
        if not start.endswith('-approach'):
            continue
        approach, room = nodes[start], nodes[end]
        dx = (room['x'] - approach['x']) / 13
        dy = (room['y'] - approach['y']) / 13
        x = room['x'] - 4 * dx
        y = room['y'] - 4 * dy
        opening = path([[x - 6 * dy, y - 6 * dx], [x + 6 * dy, y + 6 * dx]])
        out.append(f'<path d="{opening}" fill="none" stroke="{FLOOR_FILL}" stroke-width="3"/>')

    for space in floor['spaces']:
        if box := space.get('labelBox'):
            x0, y0, x1, y1 = box
            point = ((x0 + x1) / 2, (y0 + y1) / 2)
            value = space.get('label') or space.get('code') or space['name']
            if space.get('destination'):
                out.append(label((point[0] - 8, point[1]), 'Access to basement', 13))
                out.append(label((point[0] + 8, point[1]), 'lecture theatres ↓', 13))
            else:
                out.append(label(point, value, 13 if space.get('label') else 19))
        if point := space.get('iconPoint'):
            symbol = {'washroom': 'WC', 'lift': '↕'}.get(space['icon'], space.get('arrow', ''))
            out.append(label(point, symbol, 16))
    for node in nodes.values():
        if node['kind'] == 'stairs':
            out.append(label((node['x'], node['y']), 'Stairs', 14))
    out.append('</svg>')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    (TOOLS / 'csc-diagram.svg').write_text(svg(json.loads(MAP.read_text(encoding='utf-8'))), encoding='utf-8')
