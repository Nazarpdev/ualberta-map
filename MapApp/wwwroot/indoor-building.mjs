import { IndoorRouter, floorSegments } from './indoor-router.mjs';
import { createSubPlan } from './sub-plan.mjs';
import { requestCampusRoute } from './route-client.mjs';
export async function createIndoorBuilding(map, opts, onSelect, onFloorChange) {
    const { key, dataUrl, panel, panes, titlePrefix, avoidSub } = opts;
    const response = await fetch(dataUrl);
    if (!response.ok)
        throw new Error(`${titlePrefix} floor plans could not be loaded`);
    const data = (await response.json());
    const router = new IndoorRouter(data);
    const bounds = L.latLngBounds(data.bounds);
    let floor = data.floors[0].id, visible = false, outline = [], drawnFloor;
    const details = (panel?.querySelector('details') ?? null);
    if (window.matchMedia('(max-width: 480px)').matches && details)
        details.open = false;
    const stairs = L.layerGroup();
    map.createPane(panes.plans);
    map.getPane(panes.plans).style.zIndex = '410';
    map.createPane(panes.details);
    map.getPane(panes.details).style.zIndex = '430';
    map.createPane(panes.labels);
    map.getPane(panes.labels).style.zIndex = '440';
    for (const name of Object.values(panes)) {
        const pane = map.getPane(name);
        pane.style.transition = 'opacity .3s ease';
        pane.style.opacity = '0';
        pane.inert = true;
    }
    const setPlanOpacity = (value) => {
        for (const name of Object.values(panes)) {
            const pane = map.getPane(name);
            pane.style.opacity = value;
            // Fading rooms must not reopen tooltips as they pass under the pointer.
            pane.inert = value === '0';
        }
    };
    const plan = createSubPlan(map, router, selectRoom, panes);
    function selectRoom(id) {
        const node = router.nodes.get(id) ?? router.spaces.get(id);
        if (!node)
            return;
        if (node.floor !== floor)
            setFloor(node.floor);
        onSelect({ building: key, nodeId: node.id, spaceId: node.spaceId, floor: node.floor, lat: node.lat, lon: node.lon, name: title(node) });
    }
    const stairsIcon = L.divIcon({ className: 'entrance-icon stair-icon', iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 20h6v-6h6V8h6V3"/></svg>' });
    const text = (value) => { const span = document.createElement('span'); span.textContent = value; return span; };
    const title = (node) => `${titlePrefix}${node.code ? ` ${node.code}` : ''} · ${node.name}`;
    const floorName = (value) => data.floors.find(f => f.id === value).name;
    function setFloor(value) {
        floor = value;
        render();
        onFloorChange();
    }
    panel?.querySelectorAll('[data-floor]').forEach(button => button.addEventListener('click', () => setFloor(Number(button.dataset.floor))));
    function syncFloorUI() {
        if (!panel)
            return;
        panel.querySelectorAll('[data-floor]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.floor) === floor)));
        const label = document.getElementById(`${key}FloorName`) ?? panel.querySelector('strong');
        if (label)
            label.textContent = `${titlePrefix} · ${floorName(floor)}`;
    }
    function drawShapes() {
        plan.draw(data.floors.find(f => f.id === floor));
        syncFloorUI();
    }
    function drawMarkers() {
        stairs.clearLayers();
        for (const node of router.nodes.values()) {
            if (node.floor !== floor)
                continue;
            if (node.kind === 'stairs') {
                L.marker([node.lat, node.lon], { pane: panes.details, icon: stairsIcon, title: node.name, keyboard: false })
                    .bindTooltip(text(`${node.name} · ${floorName(floor)}`)).addTo(stairs);
            }
        }
        if (document.getElementById('showStairs').checked)
            stairs.addTo(map);
        else
            map.removeLayer(stairs);
        plan.refreshLabels();
    }
    function fadeInPanes() {
        // Labels lay out a frame later, so fade after to include them, not pop them.
        requestAnimationFrame(() => requestAnimationFrame(() => { if (visible)
            setPlanOpacity('1'); }));
    }
    function render() {
        // Keep hidden layers mounted so Leaflet positions them before zoomanim.
        if (drawnFloor !== floor) {
            drawShapes();
            drawMarkers();
            drawnFloor = floor;
        }
        if (!visible) {
            panel?.classList.remove('show');
            setPlanOpacity('0');
            plan.closeTooltips();
            stairs.eachLayer(layer => layer.closeTooltip());
            return;
        }
        panel?.classList.add('show');
        const fadingIn = map.getPane(panes.plans).style.opacity === '0';
        if (fadingIn)
            setPlanOpacity('0');
        if (fadingIn)
            fadeInPanes();
        else
            setPlanOpacity('1');
    }
    function update() {
        const next = map.getZoom() >= 19 && map.getBounds().intersects(bounds);
        if (next !== visible) {
            visible = next;
            render();
        }
    }
    map.on('moveend', () => { update(); plan.refreshLabels(); });
    map.on('zoomstart', () => {
        // Close rather than just CSS-hide tooltips, so they stay faded after zoom.
        plan.closeTooltips();
        stairs.eachLayer(layer => layer.closeTooltip());
    });
    map.on('zoomend', update);
    // Use the destination zoom so both fades start during the animation.
    map.on('zoomanim', (event) => {
        const next = event.zoom >= 19 && map.getBounds().intersects(bounds);
        if (next !== visible) {
            visible = next;
            render();
        }
    });
    document.getElementById('showStairs').addEventListener('change', drawMarkers);
    function focus(value = floor) {
        setFloor(value);
        const zoom = Math.max(19, Math.min(20, map.getBoundsZoom(bounds, false, L.point(120, 120))));
        map.setView(bounds.getCenter(), zoom, { animate: true });
    }
    map.on('resize', () => { if (window.matchMedia('(max-width: 480px)').matches && details)
        details.open = false; });
    render();
    update();
    const names = new Map([...router.nodes.values()].filter(n => n.kind === 'room').concat([...router.spaces.values()]).map(n => [title(n), n]));
    function inside(lat, lon) {
        // Use the actual campus footprint rather than its bounding rectangle.
        return outline.some(ring => {
            let result = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i], [xj, yj] = ring[j];
                if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
                    result = !result;
            }
            return result;
        });
    }
    async function campusRoute(start, end, preferIndoor) {
        return requestCampusRoute(start, end, { preferIndoor, avoidSub });
    }
    const campusPoint = (portal) => ({ lat: portal.campus[0], lon: portal.campus[1] });
    const indoorSegments = (points) => floorSegments(points, router).map(segment => ({ ...segment, building: key }));
    function transitionsFor(points) {
        const transitions = [];
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            if (a.floor !== b.floor)
                transitions.push({ building: key, from: a.floor, to: b.floor,
                    text: `${a.name}: ${floorName(a.floor)} → ${floorName(b.floor)}` });
        }
        return transitions;
    }
    // Indoor legs from a point on this building to each entrance, ordered from
    // the route start towards the route end. Used for mixed and cross-building
    // routes assembled by the caller.
    function indoorOptions(point, isStart) {
        return [...router.nodes.values()].filter(n => n.kind === 'entrance').map(portal => {
            const indoor = isStart ? router.route(point, { nodeId: portal.id }) : router.route({ nodeId: portal.id }, point);
            return indoor ? { portal, indoor, cost: indoor.cost } : null;
        }).filter((option) => option !== null);
    }
    async function route(start, end, { preferIndoor = false } = {}) {
        const startIndoor = start.floor != null, endIndoor = end.floor != null;
        if (!startIndoor && !endIndoor) {
            const { coordinates: coords } = await campusRoute(start, end, preferIndoor);
            return { segments: [{ floor: null, coords, building: key }], transitions: [] };
        }
        let indoor;
        let outdoor = [], entry;
        if (startIndoor && endIndoor)
            indoor = router.route(start, end) ?? undefined;
        else {
            const options = await Promise.all([...router.nodes.values()].filter(n => n.kind === 'entrance').map(async (portal) => {
                const indoor = startIndoor ? router.route(start, { nodeId: portal.id }) : router.route({ nodeId: portal.id }, end);
                if (!indoor)
                    return null;
                const point = campusPoint(portal);
                const campus = await campusRoute(startIndoor ? point : start, startIndoor ? end : point, preferIndoor);
                const outdoor = campus.coordinates;
                if (!outdoor.length)
                    return null;
                // Compare all entrances using the same indoor preference as the campus leg.
                const cost = indoor.cost + campus.cost;
                return { indoor, outdoor, portal, cost };
            }));
            const best = options.filter((option) => option !== null).sort((a, b) => a.cost - b.cost)[0];
            if (best) {
                indoor = best.indoor;
                outdoor = best.outdoor;
                entry = best.portal;
            }
        }
        if (!indoor)
            throw new Error(`No mapped route. Select a ${titlePrefix} room or a point on a corridor.`);
        const segments = indoorSegments(indoor.points);
        if (outdoor.length) {
            const connector = [entry.lat, entry.lon];
            if (startIndoor) {
                outdoor.unshift(connector);
                segments.push({ floor: null, coords: outdoor, building: null });
            }
            else {
                outdoor.push(connector);
                segments.unshift({ floor: null, coords: outdoor, building: null });
            }
        }
        return { segments, transitions: transitionsFor(indoor.points) };
    }
    return {
        building: key, avoidSub, router, route, floorName, contains: inside, refreshLabels: plan.refreshLabels,
        indoorOptions, campusPoint, indoorSegments, transitionsFor,
        get floor() { return floor; },
        get visible() { return visible; },
        setFloor,
        focus,
        setFootprints(features) { outline = features.filter(f => f.properties?.name === data.building && f.geometry.type === 'Polygon').map(f => f.geometry.coordinates[0]); },
        locations: Object.fromEntries([...names].map(([name, n]) => [name, [n.lat, n.lon]])),
        endpoint(name) {
            const node = names.get(name) ?? (name === data.building ? router.nodes.get('1:entry-north') : null);
            return node ? { building: key, nodeId: node.id, spaceId: node.spaceId, floor: node.floor, lat: node.lat, lon: node.lon, name } : null;
        },
        click(lat, lon) {
            // Resolve indoor points at any zoom; visibility only controls the
            // drawn floor plan, not routing. Pins placed while zoomed out keep
            // their floor so the indoor legs still appear after zooming in.
            if (!inside(lat, lon))
                return { lat, lon };
            const point = { building: key, lat, lon, floor, name: `${titlePrefix} · ${floorName(floor)}` };
            if (!router.locate(point))
                throw new Error('Select a room or an open indoor area.');
            return point;
        }
    };
}
