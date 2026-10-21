// Hand-traced room geometry. Leaflet renders SVG paths, while labels are ordinary
// upright text at screen resolution; there is no PDF/image layer to rotate.
import type { IndoorFloor, IndoorRouter, IndoorSpace, XY } from './indoor-router.mjs';

export const spaceColors: Record<string, string> = {
    'Student Space': '#e3eed3', Food: '#f9e6d1', Services: '#deecf4',
    Businesses: '#dcebe2', Venues: '#f2dddd', Offices: '#e7e9ed', Corridors: '#f3f6f3'
};

export interface PlanPanes { plans: string; details: string; labels: string }

interface Rect { left: number; right: number; top: number; bottom: number }

export interface SubPlan {
    draw(floor: IndoorFloor): void;
    clear(): void;
    refreshLabels(): void;
    closeTooltips(): void;
}

export function createSubPlan(
    map: L.Map,
    router: IndoorRouter,
    onSelect: (id: string) => void,
    panes: PlanPanes = { plans: 'subPlans', details: 'subDetails', labels: 'subLabels' }
): SubPlan {
    const shapes = L.layerGroup();
    const labels = L.layerGroup();
    const amenities = L.layerGroup();
    const renderer = L.svg({ pane: panes.plans });
    const clipId = `${panes.plans}-building-clip`;
    let current: IndoorFloor | null = null;
    let frame = 0;
    let displayedLabels = new Set<IndoorSpace>();
    let clipPath: SVGPathElement | null = null;
    const geo = (floor: number, [x, y]: XY): [number, number] => {
        const point = router.toGeo({ floor, x, y });
        return [point.lat, point.lon];
    };
    const text = (value: string): HTMLSpanElement => { const span = document.createElement('span'); span.textContent = value; return span; };
    const geoLine = (floor: number, points: XY[], closed = false): [number, number][] =>
        router.toGeoPath(floor, closed ? [...points, points[0] as XY] : points).map(p => [p.lat, p.lon] as [number, number]);
    // Geographic footprint pairs ([lon, lat]), when the data supplies them.
    const footprint = router.data.footprint?.map(([lon, lat]): [number, number] => [lat, lon]);
    function updateClip() {
        if (!clipPath || !footprint) return;
        clipPath.setAttribute('d', footprint.map((p, i) => {
            const pixel = map.latLngToLayerPoint(p);
            return `${i ? 'L' : 'M'}${pixel.x},${pixel.y}`;
        }).join(' ') + ' Z');
    }
    function withinBuilding(lat: number, lon: number): boolean {
        if (!footprint) return true;
        const inside = (a: [number, number], b: [number, number]) => {
            const [ay, ax] = a, [by, bx] = b;
            return (ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax;
        };
        let result = false;
        for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
            if (inside(footprint[i], footprint[j])) result = !result;
        }
        return result;
    }
    map.on('zoomend moveend viewreset', updateClip);
    const select = (layer: L.Layer, id?: string) => {
        if (id) layer.on('click', () => onSelect(id));
    };
    const destination = (space: IndoorSpace): string => {
        const floor = current as IndoorFloor;
        return space.node ?? space.destination ?? `${floor.id}:space:${floor.spaces.indexOf(space)}`;
    };

    function draw(floor: IndoorFloor) {
        clear(); current = floor;
        shapes.addTo(map); labels.addTo(map); amenities.addTo(map);
        const outline = L.polygon(footprint ?? geoLine(floor.id, floor.footprint as XY[], true), {
            renderer, pane: panes.plans, className: 'sub-footprint',
            fillColor: spaceColors.Corridors, fillOpacity: 1, color: '#87988d', weight: 2,
            interactive: false
        }).addTo(shapes);
        if (footprint) {
            const svg = (outline.getElement() as SVGPathElement).ownerSVGElement as SVGSVGElement;
            let clip = svg.querySelector(`#${clipId}`) as SVGClipPathElement | null;
            if (!clip) {
                clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath') as SVGClipPathElement;
                clip.id = clipId; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
                clip.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                defs.appendChild(clip); svg.prepend(defs);
            }
            clipPath = clip.firstElementChild as SVGPathElement;
            updateClip();
        }
        for (const space of floor.spaces) {
            const box = space.labelBox;
            const polygon = space.polygon ?? (box ? [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]] as XY[] : undefined);
            if (!polygon) continue;
            const layer = L.polygon(geoLine(floor.id, polygon, true), {
                renderer, pane: panes.plans, className: 'sub-space',
                color: '#9daea3', weight: 1.2, fillColor: spaceColors[space.category],
                fillOpacity: space.polygon ? 1 : 0, stroke: Boolean(space.polygon), bubblingMouseEvents: false
            }).bindTooltip(text(`${space.code ? `${space.code} · ` : ''}${space.name}${space.note ? ` · ${space.note}` : ''}`)).addTo(shapes);
            if (clipPath) layer.getElement()!.setAttribute('clip-path', `url(#${clipId})`);
            (layer.getElement() as SVGPathElement).dataset.room = destination(space);
            select(layer, destination(space));

            // Cut a small opening in the wall at the traced room access point.
            const door = router.nodes.get(space.node as string);
            if (!door || !space.polygon) continue;
            let closest: { x: number; y: number; dx: number; dy: number; distance: number } | undefined;
            for (let i = 0; i < space.polygon.length; i++) {
                const a = space.polygon[i], b = space.polygon[(i + 1) % space.polygon.length];
                const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
                if (!length) continue;
                const t = Math.max(0, Math.min(1, ((door.x - a[0]) * dx + (door.y - a[1]) * dy) / length ** 2));
                const x = a[0] + dx * t, y = a[1] + dy * t, doorDistance = Math.hypot(x - door.x, y - door.y);
                if (!closest || doorDistance < closest.distance) closest = { x, y, dx: dx / length, dy: dy / length, distance: doorDistance };
            }
            if (closest && closest.distance <= 8) {
                const { x, y, dx, dy } = closest;
                const opening = L.polyline(geoLine(floor.id, [[x - dx * 3, y - dy * 3], [x + dx * 3, y + dy * 3]]), {
                    renderer, pane: panes.plans, color: spaceColors.Corridors, weight: 3, lineCap: 'butt', interactive: false
                }).addTo(shapes);
                if (clipPath) opening.getElement()!.setAttribute('clip-path', `url(#${clipId})`);
            }
        }
        for (const line of floor.partitions ?? []) {
            const wall = L.polyline(geoLine(floor.id, line), {
                renderer, pane: panes.plans, color: '#9daea3', weight: 1.2, interactive: false
            }).addTo(shapes);
            if (clipPath) wall.getElement()!.setAttribute('clip-path', `url(#${clipId})`);
        }
        // Atrium stairs: broad seating steps with a narrow walking flight,
        // following the PDF pattern and aligned to the corrected south wing.
        for (const stair of floor.staircases ?? []) {
            const [a, b, c, d] = stair.corners;
            const mix = (p: XY, q: XY, t: number): XY => p.map((value, i) => value + (q[i] - value) * t) as unknown as XY;
            // Follow the actual wall slope rather than an inset rectangle.
            const point = (across: number, along: number): XY => mix(mix(a, d, along), mix(b, c, along), across);
            const outline = L.polygon(geoLine(floor.id, stair.corners, true), {
                renderer, pane: panes.plans, color: '#9daea3', weight: 1.2,
                fillColor: '#e7ece7', fillOpacity: 1, interactive: false
            }).addTo(shapes);
            if (clipPath) outline.getElement()!.setAttribute('clip-path', `url(#${clipId})`);
            const lines: XY[][] = [];
            for (let i = 0; i < stair.flights; i++) {
                const along = i / stair.flights;
                if (i) lines.push([point(0, along), point(1, along)]);
                for (let j = 1; j <= 3; j++) {
                    const tread = (i + j / 4) / stair.flights;
                    lines.push([point(0, tread), point(1 / 3, tread)]);
                }
            }
            lines.push([point(1 / 3, 0), point(1 / 3, 1)]);
            for (const line of lines) {
                const tread = L.polyline(geoLine(floor.id, line), {
                    renderer, pane: panes.plans, color: '#9daea3', weight: 1, interactive: false
                }).addTo(shapes);
                if (clipPath) tread.getElement()!.setAttribute('clip-path', `url(#${clipId})`);
            }
        }
    }

    const overlaps = (a: Rect, b: Rect) => a.left < b.right + 3 && a.right + 3 > b.left && a.top < b.bottom + 3 && a.bottom + 3 > b.top;
    function layoutLabels() {
        const previousLabels = displayedLabels;
        displayedLabels = new Set();
        labels.clearLayers(); amenities.clearLayers();
        if (!current) return;
        const currentFloor: IndoorFloor = current;
        const container = map.getContainer(), mapRect = container.getBoundingClientRect();
        // Lay out hidden labels at the entry zoom, including collision checks.
        const layoutZoom = Math.max(19, map.getZoom());
        const scale = map.getZoomScale(layoutZoom, map.getZoom());
        const center = map.getSize().divideBy(2);
        const layoutPoint = (latlng: [number, number]) => {
            const p = map.latLngToContainerPoint(latlng);
            return center.add(p.subtract(center).multiplyBy(scale));
        };
        const occupied: Rect[] = [...container.querySelectorAll<HTMLElement>('.leaflet-marker-icon:not(.sub-room-label)')]
            .filter(el => Number(getComputedStyle(el).opacity) > 0)
            .map(el => {
                const r = el.getBoundingClientRect();
                const x = center.x + ((r.left + r.right) / 2 - mapRect.left - center.x) * scale;
                const y = center.y + ((r.top + r.bottom) / 2 - mapRect.top - center.y) * scale;
                return { left: x - r.width / 2, right: x + r.width / 2, top: y - r.height / 2, bottom: y + r.height / 2 };
            });
        for (const space of currentFloor.spaces.filter(s => s.iconPoint).sort((a, b) => Number(a.icon === 'lift') - Number(b.icon === 'lift'))) {
            const iconCenter = geo(currentFloor.id, space.iconPoint as XY);
            if (!withinBuilding(iconCenter[0], iconCenter[1])) continue;
            const p = layoutPoint(iconCenter);
            const rect = { left: p.x - 9, right: p.x + 9, top: p.y - 9, bottom: p.y + 9 };
            if (occupied.some(other => overlaps(rect, other))) continue;
            const symbol = document.createElement('span');
            symbol.textContent = space.icon === 'washroom' ? 'WC' : space.icon === 'lift' ? '↕' : space.arrow as string;
            symbol.setAttribute('aria-hidden', 'true');
            const marker = L.marker(iconCenter, {
                pane: panes.details, icon: L.divIcon({ className: `sub-amenity-icon sub-${space.icon as string}`, html: symbol, iconSize: [18, 18], iconAnchor: [9, 9] }),
                title: space.name, keyboard: true, bubblingMouseEvents: false
            }).bindTooltip(text(`${space.name}${space.note ? ` · ${space.note}` : ''}`)).addTo(amenities);
            select(marker, destination(space));
            occupied.push(rect);
        }
        for (const node of router.nodes.values()) {
            if (node.floor !== currentFloor.id || node.kind !== 'room' || node.amenity) continue;
            const p = layoutPoint([node.lat, node.lon]);
            occupied.push({ left: p.x - 6, right: p.x + 6, top: p.y - 6, bottom: p.y + 6 });
        }
        // Labels are constrained to an interior rectangle traced for each room.
        // At small zooms, fall back to room numbers; hide anything that cannot fit.
        const candidates = currentFloor.spaces.filter(s => s.labelBox).map(space => {
            const [x0, y0, x1, y1] = space.labelBox as [number, number, number, number];
            const a = layoutPoint(geo(currentFloor.id, [x0, y0]));
            const b = layoutPoint(geo(currentFloor.id, [x1, y1]));
            return { space, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
                center: geo(currentFloor.id, [(x0 + x1) / 2, (y0 + y1) / 2]) };
        }).sort((a, b) => b.width * b.height - a.width * a.height);
        for (const { space, width, height, center: labelCenter } of candidates) {
            if (!withinBuilding(labelCenter[0], labelCenter[1])) continue;
            const w = Math.min(150, Math.floor(width - 4));
            if (w < 22 || height < 13) continue;
            const element = document.createElement('div');
            element.className = 'sub-label-content';
            const name = document.createElement('span'); name.className = 'sub-label-name';
            name.textContent = space.label ?? space.name; element.appendChild(name);
            if (!space.icon && (space.code || space.note)) {
                const code = document.createElement('span'); code.className = 'sub-label-code';
                code.textContent = space.code ?? space.note ?? ''; element.appendChild(code);
            }
            const probe = document.createElement('div');
            probe.className = 'sub-room-label';
            Object.assign(probe.style, { position: 'fixed', visibility: 'hidden', width: `${w}px` });
            probe.appendChild(element); container.appendChild(probe);
            let h = Math.ceil(element.getBoundingClientRect().height);
            if ((h > height - 2 || element.scrollWidth > w) && space.shortLabel) {
                element.replaceChildren(text(space.shortLabel));
                h = Math.ceil(element.getBoundingClientRect().height);
            }
            if (h > height - 2 || element.scrollWidth > w) {
                if (!space.code) { probe.remove(); continue; }
                element.replaceChildren(text(space.code as string));
                element.classList.add('sub-code-only');
                h = Math.ceil(element.getBoundingClientRect().height);
            }
            const fits = h <= height - 2 && element.scrollWidth <= w;
            probe.remove();
            if (!fits) continue;
            const p = layoutPoint(labelCenter);
            const rect = { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
            if (occupied.some(other => overlaps(rect, other))) continue;
            occupied.push(rect);
            // A zoom-end refresh must not restart the fade on existing text.
            if (previousLabels.has(space)) element.style.animation = 'none';
            displayedLabels.add(space);
            const marker = L.marker(labelCenter, {
                pane: panes.labels, icon: L.divIcon({ className: 'sub-room-label', html: element, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }),
                title: space.name, keyboard: true,
                interactive: true, bubblingMouseEvents: false
            }).addTo(labels);
            select(marker, destination(space));
        }
    }
    function refreshLabels() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(layoutLabels);
    }
    function closeTooltips() {
        for (const group of [shapes, labels, amenities]) group.eachLayer(layer => layer.closeTooltip());
    }
    function clear() {
        cancelAnimationFrame(frame); current = null;
        displayedLabels.clear();
        shapes.clearLayers(); labels.clearLayers(); amenities.clearLayers();
        map.removeLayer(shapes); map.removeLayer(labels); map.removeLayer(amenities);
    }
    return { draw, clear, refreshLabels, closeTooltips };
}
