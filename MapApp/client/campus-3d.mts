import type * as GeoJSON from 'geojson';

type Point = [x: number, y: number];
type Point3 = [x: number, y: number, z: number];
type Ring = Point[];
type Polygon = Ring[];
type Color = [red: number, green: number, blue: number];
type Pixel = [x: number, y: number, depth: number];

interface Roof {
    polygon: Polygon;
    name?: string;
    height: number;
    base: number;
    elevation: number;
}

interface Wall {
    corners: Point3[];
    outward: Point;
    fill: Color;
}

interface Scene {
    roofs: Roof[];
    walls: Wall[];
}

interface Camera {
    yaw: number;
    zoom: number;
    x: number;
    y: number;
}

interface Raster {
    image: ImageData;
    depth: Float32Array;
    roofAt: Int32Array;
}

const metresPerDegree = 111_195;
const pitch = Math.PI * 0.28;
const sinPitch = Math.sin(pitch);
const cosPitch = Math.cos(pitch);
const initialCamera: Camera = { yaw: -Math.PI / 6, zoom: 1, x: 0, y: 0 };

function openRing(ring: GeoJSON.Position[]): Ring {
    const points = ring.map(([lon, lat]): Point => [lon, lat]);
    const first = points[0];
    const last = points.at(-1);
    if (first && last && first[0] === last[0] && first[1] === last[1]) points.pop();
    return points.length >= 3 && points.every(point => point.every(Number.isFinite)) ? points : [];
}

function counterClockwise(ring: Ring): boolean {
    return ring.reduce((area, [x, y], index) => {
        const [nx, ny] = ring[(index + 1) % ring.length];
        return area + x * ny - y * nx;
    }, 0) > 0;
}

function readScene(data: GeoJSON.FeatureCollection): Scene {
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features))
        throw new Error('The 3D building data is unavailable.');
    const roofPolygons = data.features.flatMap(({ properties, geometry }) => {
        const height: unknown = properties?.height;
        const ground: unknown = properties?.ground;
        const minHeight: unknown = properties?.minHeight;
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return [];
        if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return [];
        const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        return coordinates.flatMap(rings => {
            const polygon = rings.map(openRing);
            if (!polygon.length || polygon.some(ring => !ring.length)) return [];
            return [{
                polygon,
                name: typeof properties?.name === 'string' ? properties.name : undefined,
                height,
                ground: typeof ground === 'number' && Number.isFinite(ground) ? ground : undefined,
                minHeight: typeof minHeight === 'number' && minHeight >= 0 && minHeight < height ? minHeight : 0
            }];
        });
    });
    if (!roofPolygons.length) throw new Error('No measured building heights are available.');

    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const roof of roofPolygons) for (const [lon, lat] of roof.polygon[0]) {
        west = Math.min(west, lon); south = Math.min(south, lat);
        east = Math.max(east, lon); north = Math.max(north, lat);
    }
    const lon0 = (west + east) / 2, lat0 = (south + north) / 2;
    const metresPerLongitude = metresPerDegree * Math.cos(lat0 * Math.PI / 180);
    // Keep real differences in ground level when the dataset uses a common datum.
    const groundDatum = roofPolygons.every(roof => roof.ground !== undefined)
        ? roofPolygons.reduce((min, roof) => Math.min(min, roof.ground!), Infinity) : null;

    const walls: Wall[] = [];
    const roofs = roofPolygons.map((roof): Roof => {
        const ground = groundDatum === null ? 0 : roof.ground! - groundDatum;
        const base = ground + roof.minHeight;
        const elevation = ground + roof.height;
        const polygon = roof.polygon.map((ring, index) => {
            const points = ring.map(([lon, lat]): Point => [
                (lon - lon0) * metresPerLongitude,
                (lat - lat0) * metresPerDegree
            ]);
            // With the solid on the left, the right normal faces out for roofs and courtyard holes.
            if (counterClockwise(points) !== (index === 0)) points.reverse();
            for (let i = 0; i < points.length; i++) {
                const a = points[i], b = points[(i + 1) % points.length];
                const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
                if (length === 0) continue;
                const outward: Point = [dy / length, -dx / length];
                const light = (outward[0] * -0.65 + outward[1] * 0.76 + 1) / 2;
                walls.push({
                    corners: [[...a, base], [...b, base], [...b, elevation], [...a, elevation]],
                    outward,
                    fill: [Math.round(54 + light * 38), Math.round(86 + light * 45), Math.round(69 + light * 42)]
                });
            }
            return points;
        });
        return { polygon, name: roof.name, height: roof.height, base, elevation };
    });
    return { roofs, walls };
}

/** A measured-height axonometric view. The planar layers and route controls remain in Leaflet. */
export function createCampus3D(dialog: HTMLDialogElement, dataUrl: string): { open(): void } {
    const canvas = dialog.querySelector<HTMLCanvasElement>('[data-campus-3d]')!;
    const status = dialog.querySelector<HTMLElement>('[data-campus-3d-status]')!;
    const context = canvas.getContext('2d');
    const camera = { ...initialCamera };
    let scene: Scene | undefined;
    let pending = false;
    let frame = 0;
    let raster: Raster | undefined;
    let drag: { id: number; x: number; y: number; moved: boolean } | undefined;

    function draw() {
        frame = 0;
        if (!context || !scene || !dialog.open) return;
        const width = canvas.clientWidth, height = canvas.clientHeight;
        if (!width || !height) return;
        const ratio = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1), Math.sqrt(2_000_000 / (width * height)));
        const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        if (raster?.image.width !== pixelWidth || raster.image.height !== pixelHeight) {
            raster = {
                image: context.createImageData(pixelWidth, pixelHeight),
                depth: new Float32Array(pixelWidth * pixelHeight),
                roofAt: new Int32Array(pixelWidth * pixelHeight)
            };
        }
        raster.image.data.fill(0);
        raster.depth.fill(Infinity);
        raster.roofAt.fill(0);

        const sin = Math.sin(camera.yaw), cos = Math.cos(camera.yaw);
        const north = (x: number, y: number) => x * sin + y * cos;
        const horizontal = (x: number, y: number) => x * cos - y * sin;
        const vertical = (x: number, y: number, z: number) => north(x, y) * sinPitch + z * cosPitch;
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
        for (const roof of scene.roofs) for (const [x, y] of roof.polygon[0]) {
            const side = horizontal(x, y);
            left = Math.min(left, side);
            right = Math.max(right, side);
            bottom = Math.min(bottom, vertical(x, y, roof.base));
            top = Math.max(top, vertical(x, y, roof.elevation));
        }
        const centerX = (left + right) / 2, centerY = (bottom + top) / 2;
        const scale = 0.89 * Math.min(width / Math.max(right - left, 1), height / Math.max(top - bottom, 1)) * camera.zoom;
        const project = ([x, y, z]: Point3): Pixel => [
            ratio * (width / 2 + camera.x + scale * (horizontal(x, y) - centerX)),
            ratio * (height / 2 + camera.y - scale * (vertical(x, y, z) - centerY)),
            north(x, y) * cosPitch - z * sinPitch
        ];
        for (let index = 0; index < scene.roofs.length; index++) {
            const roof = scene.roofs[index];
            const rings = roof.polygon.map(ring => ring.map(([x, y]) => project([x, y, roof.elevation])));
            rasterFace(raster, rings, [163, 200, 173], index + 1);
        }
        for (const wall of scene.walls) {
            if (north(...wall.outward) >= 0) continue;
            rasterFace(raster, [wall.corners.map(project)], wall.fill, 0);
        }
        context.putImageData(raster.image, 0, 0);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawNorthArrow(context, width, sin, cos);
        context.setTransform(1, 0, 0, 1, 0, 0);
    }

    function invalidate() {
        if (!frame) frame = requestAnimationFrame(draw);
    }

    function act(action: string) {
        switch (action) {
            case 'rotate-left': camera.yaw -= Math.PI / 12; break;
            case 'rotate-right': camera.yaw += Math.PI / 12; break;
            case 'zoom-in': camera.zoom = Math.min(6, camera.zoom * 1.2); break;
            case 'zoom-out': camera.zoom = Math.max(0.65, camera.zoom / 1.2); break;
            case 'pan-up': camera.y += 48; break;
            case 'pan-down': camera.y -= 48; break;
            case 'pan-left': camera.x += 48; break;
            case 'pan-right': camera.x -= 48; break;
            case 'reset': Object.assign(camera, initialCamera); break;
            default: return;
        }
        invalidate();
    }

    const keys = new Map([
        ['ArrowUp', 'pan-up'], ['ArrowDown', 'pan-down'], ['ArrowLeft', 'pan-left'], ['ArrowRight', 'pan-right'],
        ['[', 'rotate-left'], [']', 'rotate-right'], ['+', 'zoom-in'], ['=', 'zoom-in'], ['-', 'zoom-out'], ['Home', 'reset']
    ]);
    canvas.addEventListener('keydown', event => {
        const action = keys.get(event.key);
        if (!action) return;
        event.preventDefault();
        act(action);
    });
    dialog.querySelectorAll<HTMLButtonElement>('button[data-campus-3d-action]').forEach(button =>
        button.addEventListener('click', () => act(button.getAttribute('data-campus-3d-action') ?? '')));
    canvas.addEventListener('wheel', event => {
        if (!scene) return;
        event.preventDefault();
        act(event.deltaY > 0 ? 'zoom-out' : 'zoom-in');
    }, { passive: false });
    canvas.addEventListener('pointerdown', event => {
        if (!scene || drag || event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX; drag.y = event.clientY;
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 0;
        if (event.shiftKey) camera.yaw += dx / 110;
        else { camera.x += dx; camera.y += dy; }
        invalidate();
    });
    canvas.addEventListener('pointerup', event => {
        if (drag?.id !== event.pointerId) return;
        if (!drag.moved && scene && raster) {
            const bounds = canvas.getBoundingClientRect();
            const x = Math.floor((event.clientX - bounds.left) * raster.image.width / bounds.width);
            const y = Math.floor((event.clientY - bounds.top) * raster.image.height / bounds.height);
            const id = x >= 0 && x < raster.image.width && y >= 0 && y < raster.image.height
                ? raster.roofAt[y * raster.image.width + x] : 0;
            const roof = scene.roofs[id - 1];
            status.textContent = roof
                ? `${roof.name ?? 'Measured roof'} · ${Math.round(roof.height * 10) / 10} m above ground`
                : '';
        }
        drag = undefined;
    });
    canvas.addEventListener('lostpointercapture', () => { drag = undefined; });
    new ResizeObserver(invalidate).observe(canvas);

    return {
        open() {
            if (!dialog.open) dialog.showModal();
            canvas.focus();
            if (!context) { status.textContent = 'This browser could not open the 3D view.'; return; }
            if (scene) { invalidate(); return; }
            if (pending) return;
            pending = true;
            status.textContent = 'Loading measured building heights…';
            fetch(dataUrl)
                .then(response => {
                    if (!response.ok) throw new Error('The 3D building data could not load. Close and reopen the view to try again.');
                    return response.json() as Promise<GeoJSON.FeatureCollection>;
                })
                .then(data => {
                    scene = readScene(data);
                    status.textContent = '';
                    invalidate();
                })
                .catch((error: unknown) => {
                    console.error(error);
                    status.textContent = 'The 3D building data could not load. Close and reopen the view to try again.';
                })
                .finally(() => { pending = false; });
        }
    };
}

// Scan each planar face by even-odd crossings to retain courtyards and concave roofs.
// Comparing interpolated depth per pixel keeps neighbouring roof sections from painting over each other.
function rasterFace(raster: Raster, rings: Pixel[][], [red, green, blue]: Color, roofId: number) {
    const { data, width, height } = raster.image;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of rings[0]) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const lastRow = Math.min(height, Math.ceil(maxY - 0.5));
    const cuts: Point[] = [];
    for (let row = Math.max(0, Math.ceil(minY - 0.5)); row < lastRow; row++) {
        const y = row + 0.5;
        cuts.length = 0;
        for (const ring of rings) for (let index = 0; index < ring.length; index++) {
            const [ax, ay, az] = ring[index], [bx, by, bz] = ring[(index + 1) % ring.length];
            if ((ay > y) === (by > y)) continue;
            const t = (y - ay) / (by - ay);
            cuts.push([ax + t * (bx - ax), az + t * (bz - az)]);
        }
        cuts.sort((a, b) => a[0] - b[0]);
        for (let crossing = 0; crossing + 1 < cuts.length; crossing += 2) {
            const [ax, az] = cuts[crossing], [bx, bz] = cuts[crossing + 1];
            if (ax === bx) continue;
            const lastColumn = Math.min(width, Math.ceil(bx - 0.5));
            const gradient = (bz - az) / (bx - ax);
            for (let col = Math.max(0, Math.ceil(ax - 0.5)); col < lastColumn; col++) {
                const index = row * width + col;
                const depth = az + (col + 0.5 - ax) * gradient;
                if (depth >= raster.depth[index]) continue;
                raster.depth[index] = depth;
                raster.roofAt[index] = roofId;
                const offset = index * 4;
                data[offset] = red;
                data[offset + 1] = green;
                data[offset + 2] = blue;
                data[offset + 3] = 255;
            }
        }
    }
}

function drawNorthArrow(context: CanvasRenderingContext2D, width: number, sin: number, cos: number) {
    const x = width - 26, y = 27;
    const dx = -sin, dy = -cos * sinPitch;
    const length = Math.hypot(dx, dy);
    const nx = dx / length, ny = dy / length;
    context.beginPath();
    context.arc(x, y, 20, 0, Math.PI * 2);
    context.fillStyle = '#f5f8f4';
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = '#bfd0c3';
    context.stroke();
    context.beginPath();
    context.moveTo(x + nx * 7, y + ny * 7);
    context.lineTo(x - nx * 8 - ny * 4, y - ny * 8 + nx * 4);
    context.lineTo(x - nx * 4, y - ny * 4);
    context.lineTo(x - nx * 8 + ny * 4, y - ny * 8 - nx * 4);
    context.closePath();
    context.fillStyle = '#254c39';
    context.fill();
    context.font = '600 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('N', x + nx * 13, y + ny * 13);
}
