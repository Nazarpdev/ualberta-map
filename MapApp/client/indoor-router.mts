// Small floor-aware graph; shared by the browser and Node regression checks.

// Plan-space positions use the per-floor schematic frame (x grows south, y
// grows west). Geographic positions are WGS-84 lat/lon degrees.
export type XY = [number, number];

export interface PlanPoint { x: number; y: number }
export interface GeoPoint { lat: number; lon: number }

export type IndoorKind = 'corridor' | 'entrance' | 'stairs' | 'room';

/** Routing graph node traced in the floor plan; entrances also map to a
 *  campus (lat/lon) point. `code` may be null in the JSON data. */
export interface IndoorNode extends PlanPoint {
    id: string;
    floor: number;
    kind: IndoorKind;
    name: string;
    code?: string | null;
    campus?: [number, number];
    category?: string;
    amenity?: string;
}

/** Anything `IndoorRouter.locate`/`route` accepts: a graph node id, a traced
 *  space id, or a geographic point on a floor. */
export interface RouterEndpoint {
    nodeId?: string;
    spaceId?: string;
    floor?: number | null;
    lat?: number;
    lon?: number;
    x?: number;
    y?: number;
    name?: string;
}

/** A located (floor, plan, geo) point: a copy of a graph node, a traced space,
 *  or a free marker produced by `locate`. */
export interface RouterPoint extends PlanPoint, GeoPoint {
    id?: string;
    floor: number;
    kind?: IndoorKind;
    name: string;
    code?: string | null;
    spaceId?: string;
    amenity?: string;
    /** geographic counterpart, present on entrance portals */
    campus?: [number, number];
    /** Outline of a door-less room this point lies in; routes may cross its own walls. */
    area?: XY[];
}

export interface GraphEdge { id: string; cost: number }

export interface IndoorRoute { points: RouterPoint[]; cost: number }

export type SquarePairs = [number, number][];

/** A hand-traced space: an area on a floor plan used for drawing, room
 *  labels, amenity icons and room selection. Coordinates refer to the floor. */
export interface IndoorSpace {
    name: string;
    category: string;
    node?: string;
    destination?: string;
    polygon?: XY[];
    labelBox?: [number, number, number, number];
    iconPoint?: XY;
    icon?: 'washroom' | 'lift' | string;
    arrow?: string;
    label?: string;
    shortLabel?: string;
    labelOnly?: boolean;
    code?: string | null;
    note?: string;
}

export interface IndoorStaircase { corners: XY[]; flights: number }

export interface IndoorFloor {
    id: number;
    name: string;
    /** Plan coordinate frame kept in the data: [x0, y0, x1, y1]. */
    crop: [number, number, number, number];
    /** Building outline traced in plan coordinates. */
    footprint?: XY[];
    spaces: IndoorSpace[];
    partitions?: XY[][];
    staircases?: IndoorStaircase[];
    /** Legacy raster reference; the vector maps must not depend on an image. */
    image?: string;
    /** Rare surveyed calibration control points along the plan axes. */
    registration?: { x: SquarePairs; y: SquarePairs };
}

export type CampusBounds = [[number, number], [number, number]];

export interface IndoorMapData {
    building: string;
    /** [[south, west], [north, east]] shared by every floor. */
    bounds: CampusBounds;
    source?: string;
    floors: IndoorFloor[];
    nodes: IndoorNode[];
    edges: [string, string][];
    /** Geographic footprint pairs ([lon, lat]) used to clip drawn plans. */
    footprint?: [number, number][];
    registration?: {
        /** Non-linear west-edge correction applied when floors use calibration. */
        westCorrection: { east: number; west: number; south: number; north: number; center: number; delta: number };
    };
}

/** Swap the components of a coordinate/timeline pair. */
const swap = ([a, b]: [number, number]): [number, number] => [b, a];

/** How far corner waypoints sit from the wall corner they go around, in plan units. */
const CORNER_OFFSET = 1.5;

// Routing works on the floor geometry, not only the traced corridor lines.
// Rooms, partitions and the footprint are obstacles; a shortest path around
// obstacles only ever bends at their corners. So the graph is every corner
// (nudged into open floor), every traced node and every room doorway, linked
// wherever two of them can see each other. Traced edges are kept for links that
// geometry can't express: stairs between floors, room access, outdoor parkade.
export class IndoorRouter {
    readonly data: IndoorMapData;
    /** Traced nodes from the map data (rooms, stairs, entrances, corridors). */
    readonly nodes: Map<string, RouterPoint>;
    readonly spaces: Map<string, RouterPoint>;
    /** Everything routes can pass through: traced nodes, doorways and corner waypoints. */
    readonly points: Map<string, RouterPoint>;
    readonly graph: Map<string, GraphEdge[]>;

    constructor(data: IndoorMapData) {
        this.data = data;
        this.nodes = new Map(data.nodes.map(node => [node.id, { ...node, ...this.toGeo(node) }] as const));
        this.spaces = new Map();
        for (const floor of data.floors) {
            floor.spaces.forEach((space, index) => {
                if (space.node || space.destination) return;
                const box = space.labelBox;
                const points = space.polygon;
                const center = space.iconPoint ?? (box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
                    : points && [points.reduce((sum, p) => sum + p[0], 0) / points.length,
                        points.reduce((sum, p) => sum + p[1], 0) / points.length]);
                if (!center) return;
                // The vertex average of an L-shaped room can fall outside it.
                if (points && !space.iconPoint && !box && !inside(center as XY, points))
                    [center[0], center[1]] = interiorPoint(points, center as XY);
                const point = { floor: floor.id, x: center[0], y: center[1] };
                const id = `${floor.id}:space:${index}`;
                this.spaces.set(id, { ...point, ...this.toGeo(point), spaceId: id, name: space.name, code: space.code,
                    area: space.category === 'Corridors' ? undefined : space.polygon });
            });
        }
        this.points = new Map(this.nodes);
        const edges = this.addDoorways(data);
        for (const floor of data.floors) this.addCorners(floor);

        this.graph = new Map([...this.points.keys()].map(id => [id, []] as [string, GraphEdge[]]));
        const link = (a: string, b: string, cost: number) => {
            this.graph.get(a)!.push({ id: b, cost });
            this.graph.get(b)!.push({ id: a, cost });
        };
        for (const [a, b] of edges) {
            const from = this.points.get(a), to = this.points.get(b);
            if (!from || !to) throw new Error(`Unknown indoor edge ${a}–${b}`);
            if (from.floor !== to.floor && (from.kind !== 'stairs' || to.kind !== 'stairs'))
                throw new Error('Floor changes must use stairs');
            link(a, b, from.floor === to.floor ? distance(from, to) : 12);
        }
        for (const floor of data.floors) {
            const onFloor = [...this.points.values()].filter(point => point.floor === floor.id);
            for (let i = 0; i < onFloor.length; i++)
                for (let j = i + 1; j < onFloor.length; j++) {
                    const from = onFloor[i], to = onFloor[j];
                    if (this.graph.get(from.id!)!.some(edge => edge.id === to.id)) continue;
                    if (this.clearCorridor(from, to)) link(from.id!, to.id!, distance(from, to));
                }
        }
    }

    // Traced room nodes sit inside their room (a little, or at its centre), where no
    // straight line can reach them. Add a doorway where the room's access edge first
    // leaves open floor, so routes aim at the door and then step into the room.
    private addDoorways(data: IndoorMapData): [string, string][] {
        const edges = data.edges.map(([a, b]) => [a, b] as [string, string]);
        for (const floor of data.floors) {
            const obstacles = floor.spaces.filter(space => space.polygon && space.category !== 'Corridors').map(space => space.polygon!);
            for (const space of floor.spaces) {
                const room = space.node ? this.nodes.get(space.node) : undefined;
                if (!room || !space.polygon || !inside([room.x, room.y], space.polygon)) continue;
                const access = edges.filter(edge => edge.includes(room.id!));
                if (access.length !== 1) continue;
                const edge = access[0];
                const outside = this.points.get(edge[0] === room.id ? edge[1] : edge[0])!;
                const from: XY = [outside.x, outside.y];
                const door = firstCrossing(from, [room.x, room.y], this.isOpen(floor, from) ? obstacles : [space.polygon]);
                if (!door) continue;
                const id = `${room.id}:door`, point = { floor: room.floor, x: door[0], y: door[1] };
                this.points.set(id, { ...point, ...this.toGeo(point), id, kind: 'corridor', name: room.name });
                edge.splice(0, 2, outside.id!, id);
                edges.push([id, room.id!]);
            }
        }
        return edges;
    }

    // Waypoints just off every wall corner that juts into open floor.
    private addCorners(floor: IndoorFloor): void {
        const seen = new Set<string>();
        const add = (x: number, y: number) => {
            const key = `${Math.round(x * 2)}:${Math.round(y * 2)}`;
            if (seen.has(key) || !this.isOpen(floor, [x, y])) return;
            seen.add(key);
            const id = `${floor.id}:corner:${seen.size}`, point = { floor: floor.id, x, y };
            this.points.set(id, { ...point, ...this.toGeo(point), id, kind: 'corridor', name: '' });
        };
        // Step out along the corner's bisector; corners that point the other way
        // land inside the obstacle and are dropped by isOpen.
        const bisect = (v: XY, prev: XY, next: XY, sign: number) => {
            const a = unit(v, prev), b = unit(v, next);
            if (!a || !b) return;
            const dx = a[0] + b[0], dy = a[1] + b[1], len = Math.hypot(dx, dy);
            if (len < 1e-6) return;
            add(v[0] + sign * dx / len * CORNER_OFFSET, v[1] + sign * dy / len * CORNER_OFFSET);
        };
        const rings = [floor.footprint ?? [], ...floor.spaces
            .filter(space => space.polygon && space.category !== 'Corridors').map(space => space.polygon!)];
        for (const ring of rings)
            ring.forEach((v, i) => bisect(v, ring[(i + ring.length - 1) % ring.length], ring[(i + 1) % ring.length], 1));
        for (const line of floor.partitions ?? [])
            line.forEach((v, i) => {
                if (i > 0 && i < line.length - 1) {
                    bisect(v, line[i - 1], line[i + 1], 1);
                    bisect(v, line[i - 1], line[i + 1], -1);
                    return;
                }
                const along = unit(v, line[i === 0 ? 1 : i - 1]);
                if (along) add(v[0] + along[0] * CORNER_OFFSET, v[1] + along[1] * CORNER_OFFSET);
            });
    }

    /** Inside the footprint and outside every room and other obstacle. */
    private isOpen(floor: IndoorFloor, point: XY): boolean {
        return !!floor.footprint && inside(point, floor.footprint) && !floor.spaces.some(space =>
            space.polygon && space.category !== 'Corridors' && inside(point, space.polygon));
    }

    toGeo({ floor, x, y }: PlanPoint & { floor: number }): GeoPoint {
        const calibration = this.data.floors.find(f => f.id === floor)!.registration;
        if (calibration) {
            const lon = interpolate(y, calibration.y);
            const lat = interpolate(interpolate(x, calibration.x), this.latitudeCorrection(lon));
            return { lat, lon };
        }
        const [x0, y0, x1, y1] = this.data.floors.find(f => f.id === floor)!.crop;
        const [[south, west], [north, east]] = this.data.bounds;
        return { lat: north - (x - x0) / (x1 - x0) * (north - south),
            lon: east - (y - y0) / (y1 - y0) * (east - west) };
    }

    toPlan({ floor, lat, lon }: GeoPoint & { floor: number }): PlanPoint {
        const calibration = this.data.floors.find(f => f.id === floor)!.registration;
        if (calibration) {
            const baseLat = interpolate(lat, this.latitudeCorrection(lon).map(swap));
            return { x: interpolate(baseLat, calibration.x.map(swap)),
                y: interpolate(lon, calibration.y.map(swap)) };
        }
        const [x0, y0, x1, y1] = this.data.floors.find(f => f.id === floor)!.crop;
        const [[south, west], [north, east]] = this.data.bounds;
        return { x: x0 + (north - lat) / (north - south) * (x1 - x0),
            y: y0 + (east - lon) / (east - west) * (y1 - y0) };
    }

    latitudeCorrection(lon: number): SquarePairs {
        const c = this.data.registration!.westCorrection;
        const t = Math.max(0, Math.min(1, (lon - c.east) / (c.west - c.east)));
        return [[c.south - 1, c.south - 1], [c.south, c.south],
            [c.center, c.center + c.delta * t], [c.north, c.north], [c.north + 1, c.north + 1]];
    }

    // A calibrated schematic is non-linear. Transform intermediate vertices as
    // well as endpoints so corridor routes and room walls follow the same frame.
    toGeoPath(floor: number, points: XY[]): GeoPoint[] {
        const result: GeoPoint[] = [];
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i];
            if (i) {
                const [px, py] = points[i - 1];
                const count = Math.ceil(Math.hypot(x - px, y - py) / 4);
                for (let j = 1; j < count; j++) result.push(this.toGeo({ floor, x: px + (x - px) * j / count, y: py + (y - py) * j / count }));
            }
            result.push(this.toGeo({ floor, x, y }));
        }
        return result;
    }

    // Markers and door-less rooms link to every point they can see; a door-less
    // room ignores its own walls, so routes enter it from the nearest side.
    locate(endpoint: RouterEndpoint): RouterPoint | null {
        if (endpoint.nodeId) return this.nodes.get(endpoint.nodeId) ?? null;
        if (endpoint.spaceId) {
            const space = this.spaces.get(endpoint.spaceId);
            if (!space) return null;
            endpoint = space;
        }
        // Geo endpoints always carry a floor and geographic position here.
        const floor = endpoint.floor as number;
        const point = { ...endpoint, ...this.toPlan({ floor, lat: endpoint.lat as number, lon: endpoint.lon as number }), floor, id: '' } as RouterPoint;
        return this.visible(point).length ? point : null;
    }

    /** Routing points on the same floor with a clear line to this point. */
    private visible(point: RouterPoint): RouterPoint[] {
        const onFloor = [...this.points.values()].filter(other => other.floor === point.floor);
        const seen = onFloor.filter(other => this.clearCorridor(point, other, point.area ? [point.area] : []));
        // A door-less room enclosed by other rooms: fall back to its nearest point.
        const passable = onFloor.filter(other => other.kind !== 'room');
        if (!seen.length && point.area && passable.length)
            return [passable.reduce((a, b) => distance(a, point) < distance(b, point) ? a : b)];
        return seen;
    }

    route(start: RouterEndpoint, end: RouterEndpoint): IndoorRoute | null {
        const first = this.locate(start), last = this.locate(end);
        if (!first || !last) return null;
        const points = new Map(this.points);
        const graph = new Map<string, GraphEdge[]>([...this.graph].map(([id, edges]) => [id, [...edges]] as const));
        const connect = (a: string, b: string) => {
            const cost = distance(points.get(a)!, points.get(b)!);
            graph.get(a)!.push({ id: b, cost }); graph.get(b)!.push({ id: a, cost });
        };
        const attach = (point: RouterPoint, id: string) => {
            if (point.id) return point.id;
            points.set(id, { ...point, id }); graph.set(id, []);
            for (const other of this.visible(point)) connect(id, other.id!);
            return id;
        };
        const a = attach(first, '@start'), b = attach(last, '@end');
        const areas = [first.area, last.area].filter((area): area is XY[] => !!area);
        if (!first.id && !last.id && first.floor === last.floor && this.clearCorridor(first, last, areas)) connect(a, b);
        const costs = new Map([[a, 0]]);
        const prev = new Map<string, string>();
        const open = new Set<string>([a]);
        while (open.size) {
            const current = [...open].reduce((a, b) => costs.get(a)! < costs.get(b)! ? a : b);
            open.delete(current);
            if (current === b) break;
            // Rooms are destinations, never shortcuts.
            if (current !== a && points.get(current)!.kind === 'room') continue;
            for (const edge of graph.get(current)!) {
                const cost = costs.get(current)! + edge.cost;
                if (cost >= (costs.get(edge.id) ?? Infinity)) continue;
                costs.set(edge.id, cost); prev.set(edge.id, current); open.add(edge.id);
            }
        }
        if (!costs.has(b)) return null;
        const path: string[] = [b];
        while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
        const route = this.shorten(path.map(id => points.get(id)!));
        const cost = route.slice(1).reduce((sum, point, i) => sum +
            (point.floor === route[i].floor ? distance(route[i], point) : 12), 0);
        return { points: route, cost };
    }

    shorten(path: RouterPoint[]): RouterPoint[] {
        const points = [path[0]];
        for (let i = 0; i < path.length - 1;) {
            let next = i + 1;
            for (let j = i + 2; j < path.length && path[j].floor === path[i].floor; j++) {
                if (path[j - 1].floor !== path[i].floor) break;
                if (this.clearCorridor(path[i], path[j])) next = j;
            }
            points.push(path[next]);
            i = next;
        }
        return points;
    }

    /** True when a straight walk stays in open floor; `ignore` lists room outlines it may cross. */
    clearCorridor(from: PlanPoint & { floor: number }, to: PlanPoint, ignore: XY[][] = []): boolean {
        const floor = this.data.floors.find(f => f.id === from.floor)!;
        // Doors and entrances sit exactly on walls. Pull both ends in slightly so
        // touching a wall at an endpoint is not a crossing; otherwise the route
        // detours past the door to a corridor node and doubles back in a V.
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const trim = length > 0 ? Math.min(0.5, length / 4) / length : 0;
        const a: XY = [from.x + (to.x - from.x) * trim, from.y + (to.y - from.y) * trim];
        const b: XY = [to.x - (to.x - from.x) * trim, to.y - (to.y - from.y) * trim];
        const crosses = (polygon: XY[]) => polygon.some((p, i) => intersects(a, b, p, polygon[(i + 1) % polygon.length]));
        if (!floor.footprint || !inside(a, floor.footprint) || !inside(b, floor.footprint) || crosses(floor.footprint)) return false;
        if ((floor.partitions ?? []).some(line => line.slice(1).some((p, i) => intersects(a, b, line[i], p)))) return false;
        // Keep a little clearance from wall corners so routes don't graze them,
        // except right at the endpoints, where doors meet room corners.
        const grazes = (polygon: XY[]) => polygon.some(p => segmentDistance(p, a, b) < 1
            && Math.hypot(p[0] - a[0], p[1] - a[1]) > 2 && Math.hypot(p[0] - b[0], p[1] - b[1]) > 2);
        return !(floor.spaces ?? []).some(space => space.polygon && space.category !== 'Corridors'
            && !ignore.includes(space.polygon) && (inside(a, space.polygon) || inside(b, space.polygon) || crosses(space.polygon) || grazes(space.polygon)));
    }
}

function inside([x, y]: XY, polygon: XY[]): boolean {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [ax, ay] = polygon[i], [bx, by] = polygon[j];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
    }
    return result;
}

/** The point inside the polygon nearest to `near`, sampled on a 20×20 grid. */
function interiorPoint(polygon: XY[], near: XY): XY {
    const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let best = polygon[0], bestDistance = Infinity;
    for (let i = 0.5; i < 20; i++)
        for (let j = 0.5; j < 20; j++) {
            const p: XY = [x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * j / 20];
            const d = Math.hypot(p[0] - near[0], p[1] - near[1]);
            if (d < bestDistance && inside(p, polygon)) { best = p; bestDistance = d; }
        }
    return best;
}

function unit(from: XY, to: XY): XY | null {
    const dx = from[0] - to[0], dy = from[1] - to[1], len = Math.hypot(dx, dy);
    return len < 1e-9 ? null : [dx / len, dy / len];
}

function segmentDistance([x, y]: XY, a: XY, b: XY): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

/** Where segment a→b first crosses any of the polygons' outlines (closest to a), if at all. */
function firstCrossing(a: XY, b: XY, polygons: XY[][]): XY | null {
    let best = Infinity;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const polygon of polygons)
        polygon.forEach((c, i) => {
            const d = polygon[(i + 1) % polygon.length];
            const ex = d[0] - c[0], ey = d[1] - c[1], denom = dx * ey - dy * ex;
            if (Math.abs(denom) < 1e-12) return;
            const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denom;
            const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denom;
            if (t > 1e-9 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
        });
    return best === Infinity ? null : [a[0] + dx * best, a[1] + dy * best];
}

function intersects(a: XY, b: XY, c: XY, d: XY): boolean {
    const cross = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if ([0, 1].some(axis => Math.max(a[axis], b[axis]) < Math.min(c[axis], d[axis])
        || Math.max(c[axis], d[axis]) < Math.min(a[axis], b[axis]))) return false;
    return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

export function distance(a: GeoPoint, b: GeoPoint): number {
    const lat = (b.lat - a.lat) * Math.PI / 180;
    const lon = (b.lon - a.lon) * Math.PI / 180 * Math.cos((a.lat + b.lat) * Math.PI / 360);
    return 6371000 * Math.hypot(lat, lon);
}

export interface FloorSegment { floor: number; coords: [number, number][]; nodes: RouterPoint[] }

export function floorSegments(points: RouterPoint[], router?: IndoorRouter): FloorSegment[] {
    const segments: FloorSegment[] = [];
    for (const point of points) {
        if (!segments.length || segments.at(-1)!.floor !== point.floor)
            segments.push({ floor: point.floor, coords: [], nodes: [] });
        const previous = segments.at(-1)!.nodes.at(-1);
        if (router && previous) {
            const line = router.toGeoPath(point.floor, [[previous.x, previous.y], [point.x, point.y]]);
            segments.at(-1)!.coords.push(...line.slice(1).map(p => [p.lat, p.lon] as [number, number]));
        } else segments.at(-1)!.coords.push([point.lat, point.lon]);
        segments.at(-1)!.nodes.push(point);
    }
    return segments;
}

function interpolate(value: number, pairs: SquarePairs): number {
    const ordered = pairs[0][0] <= pairs.at(-1)![0] ? pairs : [...pairs].reverse();
    let index = ordered.findIndex((p, i) => i > 0 && value <= p[0]);
    if (index < 0) index = ordered.length - 1;
    const [a, b] = [ordered[index - 1] as [number, number], ordered[index] as [number, number]];
    return a[1] + (value - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
}
