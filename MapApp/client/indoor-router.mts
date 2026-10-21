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
 *  space id, or a geographic point on a floor that gets snapped to a corridor. */
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
 *  or a synthesized corridor projection produced by `locate`. */
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
    projection?: RouterPoint;
    edge?: [string, string];
    offset?: number;
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

export class IndoorRouter {
    readonly data: IndoorMapData;
    readonly nodes: Map<string, RouterPoint>;
    readonly spaces: Map<string, RouterPoint>;
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
                const point = { floor: floor.id, x: center[0], y: center[1] };
                const id = `${floor.id}:space:${index}`;
                this.spaces.set(id, { ...point, ...this.toGeo(point), spaceId: id, name: space.name, code: space.code });
            });
        }
        this.graph = new Map([...this.nodes.keys()].map(id => [id, []] as [string, GraphEdge[]]));
        for (const [a, b] of data.edges) {
            const from = this.nodes.get(a), to = this.nodes.get(b);
            if (!from || !to) throw new Error(`Unknown indoor edge ${a}–${b}`);
            if (from.floor !== to.floor && (from.kind !== 'stairs' || to.kind !== 'stairs'))
                throw new Error('Floor changes must use stairs');
            const cost = from.floor === to.floor ? distance(from, to) : 12;
            this.graph.get(a)!.push({ id: b, cost });
            this.graph.get(b)!.push({ id: a, cost });
        }
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

    // Open-area markers connect to visible corridors, including wide atriums.
    // Room selections use their mapped destination instead of crossing walls.
    locate(endpoint: RouterEndpoint): RouterPoint | null {
        if (endpoint.nodeId) return this.nodes.get(endpoint.nodeId) ?? null;
        // Named spaces without a traced doorway connect to the nearest corridor.
        if (endpoint.spaceId) {
            const space = this.spaces.get(endpoint.spaceId);
            if (!space) return null;
            endpoint = space;
        }
        // Geo endpoints always carry a floor and geographic position here.
        const point = this.toPlan({ floor: endpoint.floor as number, lat: endpoint.lat as number, lon: endpoint.lon as number });
        let best: RouterPoint | null = null;
        for (const [a, b] of this.data.edges) {
            const from = this.nodes.get(a)!, to = this.nodes.get(b)!;
            if (from.floor !== endpoint.floor || to.floor !== endpoint.floor) continue;
            if (from.kind === 'room' || to.kind === 'room') continue;
            const dx = to.x - from.x, dy = to.y - from.y;
            const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
            const x = from.x + t * dx, y = from.y + t * dy;
            const d = Math.hypot(point.x - x, point.y - y);
            if (!endpoint.spaceId && !this.clearCorridor({ ...point, floor: endpoint.floor as number }, { x, y })) continue;
            if (!best || d < best.offset!) best = { ...endpoint, ...point, id: '',
                projection: { x, y, floor: endpoint.floor as number, ...this.toGeo({ x, y, floor: endpoint.floor as number }) },
                edge: [a, b], offset: d } as RouterPoint;
        }
        return best;
    }

    route(start: RouterEndpoint, end: RouterEndpoint): IndoorRoute | null {
        const first = this.locate(start), last = this.locate(end);
        if (!first || !last) return null;
        const nodes = new Map(this.nodes);
        const graph = new Map<string, GraphEdge[]>([...this.graph].map(([id, edges]) => [id, [...edges]] as const));
        const connect = (a: string, b: string) => {
            const cost = distance(nodes.get(a)!, nodes.get(b)!);
            graph.get(a)!.push({ id: b, cost }); graph.get(b)!.push({ id: a, cost });
        };
        const attach = (point: RouterPoint, id: string) => {
            if (point.id) return point.id;
            nodes.set(id, { ...point, id }); graph.set(id, []);
            nodes.set(`${id}-path`, { ...point.projection!, id: `${id}-path` }); graph.set(`${id}-path`, []);
            connect(id, `${id}-path`);
            point.edge!.forEach(node => connect(`${id}-path`, node));
            return id;
        };
        const a = attach(first, '@start'), b = attach(last, '@end');
        if (!first.id && !last.id && first.edge!.join('|') === last.edge!.join('|')) connect('@start-path', '@end-path');
        const costs = new Map([[a, 0]]);
        const prev = new Map<string, string>();
        const open = new Set<string>([a]);
        while (open.size) {
            const current = [...open].reduce((a, b) => costs.get(a)! < costs.get(b)! ? a : b);
            open.delete(current);
            if (current === b) break;
            for (const edge of graph.get(current)!) {
                const cost = costs.get(current)! + edge.cost;
                if (cost >= (costs.get(edge.id) ?? Infinity)) continue;
                costs.set(edge.id, cost); prev.set(edge.id, current); open.add(edge.id);
            }
        }
        if (!costs.has(b)) return null;
        const path: string[] = [b];
        while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
        const points = this.shorten(path.map(id => nodes.get(id)!));
        const cost = points.slice(1).reduce((sum, point, i) => sum +
            (point.floor === points[i].floor ? distance(points[i], point) : 12), 0);
        return { points, cost };
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

    clearCorridor(from: PlanPoint & { floor: number }, to: PlanPoint): boolean {
        const floor = this.data.floors.find(f => f.id === from.floor)!;
        const a: XY = [from.x, from.y], b: XY = [to.x, to.y];
        const crosses = (polygon: XY[]) => polygon.some((p, i) => intersects(a, b, p, polygon[(i + 1) % polygon.length]));
        if (!floor.footprint || !inside(a, floor.footprint) || !inside(b, floor.footprint) || crosses(floor.footprint)) return false;
        if ((floor.partitions ?? []).some(line => line.slice(1).some((p, i) => intersects(a, b, line[i], p)))) return false;
        return !(floor.spaces ?? []).some(space => space.polygon && space.category !== 'Corridors'
            && (inside(a, space.polygon) || inside(b, space.polygon) || crosses(space.polygon)));
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
