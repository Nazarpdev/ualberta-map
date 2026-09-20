// Hand-traced room geometry. Leaflet renders SVG paths, while labels are ordinary
// upright text at screen resolution; there is no PDF/image layer to rotate.
export const spaceColors = {
    'Student Space': '#e3eed3', Food: '#f9e6d1', Services: '#deecf4',
    Businesses: '#dcebe2', Venues: '#f2dddd', Offices: '#e7e9ed', Corridors: '#f3f6f3'
};

export function createSubPlan(map, router, onSelect) {
    const shapes = L.layerGroup();
    const labels = L.layerGroup();
    const amenities = L.layerGroup();
    const renderer = L.svg({ pane: 'subPlans' });
    let current, frame;
    let clipPath;
    const geo = (floor, [x, y]) => {
        const point = router.toGeo({ floor, x, y });
        return [point.lat, point.lon];
    };
    const text = value => { const span = document.createElement('span'); span.textContent = value; return span; };
    const geoLine = (floor, points, closed = false) => router.toGeoPath(floor, closed ? [...points, points[0]] : points).map(p => [p.lat, p.lon]);
    const footprint = router.data.footprint?.map(([lon, lat]) => [lat, lon]);
    function updateClip() {
        if (!clipPath || !footprint) return;
        clipPath.setAttribute('d', footprint.map((p, i) => {
            const pixel = map.latLngToLayerPoint(p);
            return `${i ? 'L' : 'M'}${pixel.x},${pixel.y}`;
        }).join(' ') + ' Z');
    }
    function withinBuilding(lat, lon) {
        if (!footprint) return true;
        let inside = false;
        for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
            const [ay, ax] = footprint[i], [by, bx] = footprint[j];
            if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
        }
        return inside;
    }
    map.on('zoomend moveend viewreset', updateClip);
    const select = (layer, id) => {
        if (id) layer.on('click', () => onSelect(id));
    };

    function draw(floor) {
        clear(); current = floor;
        shapes.addTo(map); labels.addTo(map); amenities.addTo(map);
        const outline = L.polygon(footprint ?? geoLine(floor.id, floor.footprint, true), {
            renderer, pane: 'subPlans', className: 'sub-footprint',
            fillColor: spaceColors.Corridors, fillOpacity: 1, color: '#87988d', weight: 2,
            interactive: false
        }).addTo(shapes);
        if (footprint) {
            const svg = outline.getElement().ownerSVGElement;
            let clip = svg.querySelector('#sub-building-clip');
            if (!clip) {
                clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
                clip.id = 'sub-building-clip'; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
                clip.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                defs.appendChild(clip); svg.prepend(defs);
            }
            clipPath = clip.firstElementChild; updateClip();
        }
        for (const space of floor.spaces) {
            if (!space.polygon) continue;
            const layer = L.polygon(geoLine(floor.id, space.polygon, true), {
                renderer, pane: 'subPlans', className: 'sub-space',
                color: '#9daea3', weight: 1.2, fillColor: spaceColors[space.category],
                fillOpacity: 1, bubblingMouseEvents: false
            }).bindTooltip(text(`${space.code ? `${space.code} · ` : ''}${space.name}${space.note ? ` · ${space.note}` : ''}`)).addTo(shapes);
            if (clipPath) layer.getElement().setAttribute('clip-path', 'url(#sub-building-clip)');
            if (space.node ?? space.destination) layer.getElement().dataset.room = space.node ?? space.destination;
            select(layer, space.node ?? space.destination);

            // Cut a small opening in the wall at the traced room access point.
            const door = router.nodes.get(space.node);
            if (!door) continue;
            let closest;
            for (let i = 0; i < space.polygon.length; i++) {
                const a = space.polygon[i], b = space.polygon[(i + 1) % space.polygon.length];
                const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
                if (!length) continue;
                const t = Math.max(0, Math.min(1, ((door.x - a[0]) * dx + (door.y - a[1]) * dy) / length ** 2));
                const x = a[0] + dx * t, y = a[1] + dy * t, distance = Math.hypot(x - door.x, y - door.y);
                if (!closest || distance < closest.distance) closest = { x, y, dx: dx / length, dy: dy / length, distance };
            }
            if (closest?.distance <= 8) {
                const { x, y, dx, dy } = closest;
                const opening = L.polyline(geoLine(floor.id, [[x - dx * 3, y - dy * 3], [x + dx * 3, y + dy * 3]]), {
                    renderer, pane: 'subPlans', color: spaceColors.Corridors, weight: 3, lineCap: 'butt', interactive: false
                }).addTo(shapes);
                if (clipPath) opening.getElement().setAttribute('clip-path', 'url(#sub-building-clip)');
            }
        }
        for (const line of floor.partitions ?? []) {
            const wall = L.polyline(geoLine(floor.id, line), {
                renderer, pane: 'subPlans', color: '#9daea3', weight: 1.2, interactive: false
            }).addTo(shapes);
            if (clipPath) wall.getElement().setAttribute('clip-path', 'url(#sub-building-clip)');
        }
    }

    const overlaps = (a, b) => a.left < b.right + 3 && a.right + 3 > b.left && a.top < b.bottom + 3 && a.bottom + 3 > b.top;
    function layoutLabels() {
        labels.clearLayers(); amenities.clearLayers();
        if (!current) return;
        const container = map.getContainer(), mapRect = container.getBoundingClientRect();
        const occupied = [...container.querySelectorAll('.leaflet-marker-icon:not(.sub-room-label)')]
            .filter(el => Number(getComputedStyle(el).opacity) > 0)
            .map(el => {
                const r = el.getBoundingClientRect();
                return { left: r.left - mapRect.left, right: r.right - mapRect.left, top: r.top - mapRect.top, bottom: r.bottom - mapRect.top };
            });
        for (const space of current.spaces.filter(s => s.iconPoint).sort((a, b) => (a.icon === 'lift') - (b.icon === 'lift'))) {
            const center = geo(current.id, space.iconPoint);
            if (!withinBuilding(center[0], center[1])) continue;
            const p = map.latLngToContainerPoint(center);
            const rect = { left: p.x - 9, right: p.x + 9, top: p.y - 9, bottom: p.y + 9 };
            if (occupied.some(other => overlaps(rect, other))) continue;
            const symbol = document.createElement('span');
            symbol.textContent = space.icon === 'washroom' ? 'WC' : space.icon === 'lift' ? '↕' : space.arrow;
            symbol.setAttribute('aria-hidden', 'true');
            const marker = L.marker(center, {
                pane: 'subDetails', icon: L.divIcon({ className: `sub-amenity-icon sub-${space.icon}`, html: symbol, iconSize: [18, 18], iconAnchor: [9, 9] }),
                title: space.name, keyboard: Boolean(space.node), bubblingMouseEvents: false
            }).bindTooltip(text(`${space.name}${space.note ? ` · ${space.note}` : ''}`)).addTo(amenities);
            select(marker, space.node);
            occupied.push(rect);
        }
        for (const node of router.nodes.values()) {
            if (node.floor !== current.id || node.kind !== 'room' || node.amenity) continue;
            const p = map.latLngToContainerPoint([node.lat, node.lon]);
            occupied.push({ left: p.x - 6, right: p.x + 6, top: p.y - 6, bottom: p.y + 6 });
        }
        // Labels are constrained to an interior rectangle traced for each room.
        // At small zooms, fall back to room numbers; hide anything that cannot fit.
        const candidates = current.spaces.filter(s => s.labelBox).map(space => {
            const [x0, y0, x1, y1] = space.labelBox;
            const a = map.latLngToContainerPoint(geo(current.id, [x0, y0]));
            const b = map.latLngToContainerPoint(geo(current.id, [x1, y1]));
            return { space, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
                center: geo(current.id, [(x0 + x1) / 2, (y0 + y1) / 2]) };
        }).sort((a, b) => b.width * b.height - a.width * a.height);
        for (const { space, width, height, center } of candidates) {
            if (!withinBuilding(center[0], center[1])) continue;
            const w = Math.min(150, Math.floor(width - 4));
            if (w < 22 || height < 13) continue;
            const element = document.createElement('div');
            element.className = 'sub-label-content';
            const name = document.createElement('span'); name.className = 'sub-label-name';
            name.textContent = space.label ?? space.name; element.appendChild(name);
            if (!space.icon && (space.code || space.note)) {
                const code = document.createElement('span'); code.className = 'sub-label-code';
                code.textContent = space.code ?? space.note; element.appendChild(code);
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
                element.replaceChildren(text(space.code));
                element.classList.add('sub-code-only');
                h = Math.ceil(element.getBoundingClientRect().height);
            }
            const fits = h <= height - 2 && element.scrollWidth <= w;
            probe.remove();
            if (!fits) continue;
            const p = map.latLngToContainerPoint(center);
            const rect = { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
            if (occupied.some(other => overlaps(rect, other))) continue;
            occupied.push(rect);
            const marker = L.marker(center, {
                pane: 'subLabels', icon: L.divIcon({ className: 'sub-room-label', html: element, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }),
                title: space.name, keyboard: Boolean(space.node ?? space.destination),
                interactive: Boolean(space.node ?? space.destination), bubblingMouseEvents: false
            }).addTo(labels);
            select(marker, space.node ?? space.destination);
        }
    }
    function refreshLabels() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(layoutLabels);
    }
    function clear() {
        cancelAnimationFrame(frame); current = null;
        shapes.clearLayers(); labels.clearLayers(); amenities.clearLayers();
        map.removeLayer(shapes); map.removeLayer(labels); map.removeLayer(amenities);
    }
    return { draw, clear, refreshLabels };
}
