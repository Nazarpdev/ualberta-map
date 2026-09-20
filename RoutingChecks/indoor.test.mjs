import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IndoorRouter, floorSegments } from '../MapApp/wwwroot/indoor-router.mjs';

const data = JSON.parse(readFileSync(new URL('../MapApp/wwwroot/indoor/sub/map.json', import.meta.url)));
const router = new IndoorRouter(data);
const route = (a, b) => router.route({ nodeId: a }, { nodeId: b });

test('every published room is reachable from a main-level entrance', () => {
    for (const node of router.nodes.values()) {
        if (node.kind !== 'room') continue;
        const path = route('1:entry-quad', node.id);
        assert.ok(path, node.id);
        assert.equal(path.points.at(-1).id, node.id);
        for (let i = 1; i < path.points.length; i++) {
            const a = path.points[i - 1], b = path.points[i];
            if (a.floor !== b.floor) {
                assert.equal(a.kind, 'stairs'); assert.equal(b.kind, 'stairs');
                assert.equal(Math.abs(a.floor - b.floor), 1);
            }
        }
    }
});

test('main to second-floor room uses stairs before entering the room', () => {
    const path = route('1:1-40', '2:2-200');
    const segments = floorSegments(path.points);
    assert.deepEqual(segments.map(s => s.floor), [1, 2]);
    assert.equal(segments[0].nodes.at(-1).kind, 'stairs');
    assert.equal(segments[1].nodes[0].kind, 'stairs');
    assert.equal(segments[1].nodes.at(-1).code, '2-200');
});

test('lower to level two changes floors twice at stair nodes', () => {
    const segments = floorSegments(route('0:0-31', '2:2-100').points);
    assert.deepEqual(segments.map(s => s.floor), [0, 1, 2]);
});

test('same-floor corridor route does not leave the floor or cut through another room', () => {
    const path = route('2:2-100', '2:2-400');
    assert.ok(path.points.every(n => n.floor === 2));
    assert.ok(path.points.slice(1, -1).every(n => n.kind !== 'room'));
    assert.ok(path.points.length > 3);
});

test('theatre routes to the main-level entrance despite its 2-500 room number', () => {
    assert.ok(route('1:entry-north', '1:2-500').points.every(n => n.floor === 1));
});

test('georeferencing round-trips on each floor', () => {
    for (const node of router.nodes.values()) {
        const point = router.toPlan({ floor: node.floor, ...router.toGeo(node) });
        assert.ok(Math.abs(point.x - node.x) < 1e-6);
        assert.ok(Math.abs(point.y - node.y) < 1e-6);
    }
});

test('unmapped wall/room clicks cannot create straight-line shortcuts', () => {
    assert.equal(router.locate({ floor: 2, ...router.toGeo({ floor: 2, x: 300, y: 410 }) }), null);
});

test('two corridor markers attach to their segment without a vertex detour', () => {
    const start = { floor: 2, ...router.toGeo({ floor: 2, x: 449, y: 410 }) };
    const end = { floor: 2, ...router.toGeo({ floor: 2, x: 449, y: 418 }) };
    const path = router.route(start, end);
    assert.equal(path.points.length, 4);
    assert.equal(path.points[0].lat, start.lat);
    assert.equal(path.points.at(-1).lon, end.lon);
    assert.ok(path.points.every(n => n.floor === 2));
});

test('routing requests leave the base graph unchanged', () => {
    const original = JSON.stringify([...router.graph]);
    route('0:0-31', '2:2-100'); route('2:2-400', '1:entry-west');
    assert.equal(JSON.stringify([...router.graph]), original);
});

test('main-floor route goes around the counter barrier to reach the services corridor', () => {
    const points = route('1:1-27–32', '1:1-81').points;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if ((a.y < 600 && b.y > 600) || (b.y < 600 && a.y > 600)) {
            const crossingX = a.x + (600 - a.y) / (b.y - a.y) * (b.x - a.x);
            assert.ok(crossingX < 503 || crossingX > 585, 'Route crossed the solid counter');
        }
    }
});

test('all mapped rooms have a vector space on their routing floor', () => {
    for (const node of router.nodes.values()) {
        if (node.kind !== 'room') continue;
        const floor = data.floors.find(f => f.id === node.floor);
        assert.ok(floor.spaces.some(space => space.node === node.id), `Missing ${node.id}`);
        assert.equal(floor.image, undefined, 'Floor must not depend on a raster image');
    }
});

test('vector spaces reference valid room destinations and stay inside their coordinate frame', () => {
    for (const floor of data.floors) {
        const [x0, y0, x1, y1] = floor.crop;
        for (const space of floor.spaces) {
            if (space.destination) assert.ok(router.nodes.has(space.destination));
            for (const [x, y] of space.polygon ?? []) {
                assert.ok(Number.isFinite(x) && Number.isFinite(y));
                assert.ok(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${floor.name}: ${space.name}`);
            }
            if (space.labelBox) {
                const [left, top, right, bottom] = space.labelBox;
                assert.ok(left < right && top < bottom, `${space.name}: invalid label area`);
            }
        }
    }
});

test('adjacent rooms have shared wall segments rather than thin accidental gaps', () => {
    const polygon = id => data.floors.flatMap(f => f.spaces).find(s => s.node === id).polygon;
    const edges = p => p.map((a, i) => [a, p[(i + 1) % p.length]]);
    const sharesWall = (a, b) => edges(a).some(([p, q]) => edges(b).some(([r, s]) => {
        const dx = q[0] - p[0], dy = q[1] - p[1];
        if (!dx && !dy) return false;
        const cross = t => dx * (t[1] - p[1]) - dy * (t[0] - p[0]);
        if (cross(r) || cross(s)) return false;
        const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
        return Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis]))
            > Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis]));
    }));
    for (const [a, b] of [
        ['0:0-31', '0:0-33'], ['0:0-41', '0:0-49'], ['0:0-60', '0:0-64'], ['0:0-09', '0:0-11'],
        ['1:1-40', '1:1-44'], ['1:1-10', '1:1-60'], ['1:1-12', '1:1-10'], ['1:1-80', '1:1-81'],
        ['2:2-000', '2:2-100'], ['2:2-100', '2:2-200'], ['2:2-200', '2:2-400'],
        ['2:2-400', '2:2-300'], ['2:2-600', '2:2-725'], ['2:2-725', '2:2-705'],
        ['2:2-702', '2:2-707'], ['2:2-701', '2:2-800'], ['2:2-800', '2:2-900']
    ]) assert.ok(sharesWall(polygon(a), polygon(b)), `Gap between ${a} and ${b}`);
});

test('pedways and washrooms are reachable on their correct floors', () => {
    for (const destination of ['1:Parkade', '2:Ag-Pedway', '0:WC', '1:WC-West', '1:WC-East', '2:WC']) {
        const path = route('1:entry-quad', destination);
        assert.ok(path, destination);
        assert.equal(path.points.at(-1).id, destination);
    }
    const parkade = route('1:1-81', '1:Parkade');
    assert.ok(parkade.points.every(n => n.floor === 1));
    const entry = parkade.points.findIndex(n => n.id === '1:parkade-door');
    assert.ok(entry >= 0);
    assert.ok(parkade.points.slice(entry).every(n => n.x > 588), 'Pedway must run beside, not through, the food bank');
});
