import { createSubMap } from './sub-map.mjs?v=sub-routing-3';
import { requestCampusRoute } from './route-client.mjs';

const centerLimit = L.latLngBounds(
    [53.5170, -113.5350], // Southwest corner (University Ave / 116 St)
    [53.5310, -113.5150]  // Northeast corner (Saskatchewan Dr / 112 St)
).pad(0.2); // campus + a bit extra; applies to the center so it never changes with zoom

const map = L.map('map', {
    minZoom: 15
}).setView([53.5264, -113.5255], 16); // Start closer
map.on('moveend', () => {
    const center = map.getCenter();
    const clamped = L.latLng(
        Math.min(Math.max(center.lat, centerLimit.getSouth()), centerLimit.getNorth()),
        Math.min(Math.max(center.lng, centerLimit.getWest()), centerLimit.getEast())
    );
    if (!center.equals(clamped)) map.setView(clamped, map.getZoom(), { animate: false });
});
map.zoomControl.setPosition('bottomright');

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    className: 'base-tiles',
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let locations = {};
let sub;
const campusEntrances = [];
let startPoint, endPoint, routeResult;
let requestVersion = 0;
const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const selectionIcon = L.divIcon({
    className: 'selection-marker', iconSize: [36, 46], iconAnchor: [18, 42],
    html: '<svg width="36" height="46" viewBox="0 0 36 46" aria-hidden="true">'
        + '<ellipse class="pin-shadow" cx="19" cy="42" rx="10" ry="3" fill="#20382b" opacity=".25"/>'
        + '<path d="M18 2C10 2 4 8 4 16c0 10 14 26 14 26s14-16 14-26C32 8 26 2 18 2Z" fill="#338bc4" stroke="#246c9a" stroke-width="1.5"/>'
        + '<circle cx="18" cy="16" r="6" fill="#fff" stroke="#246c9a" stroke-width="1.5"/></svg>'
});
map.createPane('routes'); map.getPane('routes').style.zIndex = 450;
try {
    sub = await createSubMap(map, selectPoint, renderRoute);
} catch (error) {
    document.getElementById('showStairs').disabled = true;
}

function setupAutocomplete(input) {
    let matches = [];
    let activeIndex = -1;

    const list = document.createElement('div');
    list.className = 'ac-list';
    list.style.display = 'none';
    input.parentElement.appendChild(list);

    const close = () => {
        list.style.display = 'none';
        activeIndex = -1;
    };

    const render = () => {
        list.innerHTML = '';
        matches.forEach((name, i) => {
            const item = document.createElement('div');
            item.className = 'ac-item' + (i === activeIndex ? ' ac-active' : '');
            item.textContent = name;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // keep focus on the input
                input.value = name;
                close();
            });
            list.appendChild(item);
        });
        list.style.display = matches.length ? 'block' : 'none';
    };

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { matches = []; close(); return; }
        matches = Object.keys(locations)
            .filter(n => n.toLowerCase().includes(q))
            .sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q))
            .slice(0, 10);
        activeIndex = matches.length ? 0 : -1; // highlight top result by default
        render();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (!matches.length) return;
            e.preventDefault();
            input.value = matches[activeIndex >= 0 ? activeIndex : 0];
            close();
        } else if (e.key === 'ArrowDown' && matches.length) {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % matches.length;
            render();
        } else if (e.key === 'ArrowUp' && matches.length) {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + matches.length) % matches.length;
            render();
        } else if (e.key === 'Escape') {
            close();
        }
    });

    input.addEventListener('blur', close);
}

fetch('/api/locations')
    .then(res => res.json())
    .then(data => {
        locations = { ...data, ...(sub?.locations ?? {}) };
        setupAutocomplete(document.getElementById('startLoc'));
        setupAutocomplete(document.getElementById('endLoc'));
    });

const entranceLayer = L.layerGroup().addTo(map);
const entranceIcon = L.divIcon({
    className: 'entrance-icon',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V3h14v18M3 21h18M8 21V6l8-1v16"/><path d="M12 13h1"/></svg>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
});
const isEntrance = feature => feature.geometry?.type === 'Point'
    && Boolean(feature.properties?.entrance) && feature.properties.entrance !== 'no';

document.getElementById('showEntrances').addEventListener('change', (event) => {
    if (event.target.checked) entranceLayer.addTo(map);
    else map.removeLayer(entranceLayer);
});

fetch('/map.geojson')
    .then(res => {
        if (!res.ok) throw new Error(`Map data failed to load (${res.status})`);
        return res.json();
    })
    .then(data => {
        sub?.setFootprints(data.features);
        L.geoJSON(data, {
            filter: feature => !isEntrance(feature),
            style: { color: '#8fa99b', weight: 1, opacity: 0.6, fillOpacity: 0.08 }
        }).addTo(map);
        L.geoJSON(data, {
            filter: isEntrance,
            pointToLayer: (feature, latlng) => {
                const type = feature.properties.entrance;
                const label = feature.properties.name || (type === 'yes' ? 'Entrance' : `${type.charAt(0).toUpperCase()}${type.slice(1)} entrance`);
                const tooltip = document.createElement('span');
                tooltip.textContent = label;
                const marker = L.marker(latlng, {
                    icon: entranceIcon,
                    title: label,
                    keyboard: false,
                    zIndexOffset: -1000,
                    bubblingMouseEvents: true
                }).bindTooltip(tooltip, { direction: 'top', offset: [0, -10] });
                campusEntrances.push(marker);
                return marker;
            }
        }).addTo(entranceLayer);
    })
    .catch(error => {
        console.error(error);
        const toggle = document.getElementById('showEntrances');
        toggle.checked = false;
        toggle.disabled = true;
        toggle.parentElement.title = 'Entrance data could not be loaded. Refresh to try again.';
    });

function renderRoute() {
    routeLayer.clearLayers(); markerLayer.clearLayers();
    for (const marker of campusEntrances) {
        const point = marker.getLatLng();
        const hidden = sub?.visible && sub.floor !== 1 && sub.contains(point.lat, point.lng);
        marker.setOpacity(hidden ? 0 : 1);
        if (marker.getElement()) marker.getElement().style.pointerEvents = hidden ? 'none' : '';
    }
    for (const point of [startPoint, endPoint]) {
        if (point && (point.floor == null || !sub?.visible || point.floor === sub.floor))
            L.marker([point.lat, point.lon], { icon: selectionIcon, title: point.name ?? 'Selected location' }).addTo(markerLayer);
    }
    for (const segment of routeResult?.segments ?? []) {
        if (segment.floor != null && (!sub?.visible || segment.floor !== sub.floor)) continue;
        L.polyline(segment.coords, { pane: 'routes', color: '#236348', weight: 5 }).addTo(routeLayer);
    }
    sub?.refreshLabels();
}

async function calculateRoute() {
    const version = ++requestVersion;
    routeResult = null; renderRoute();
    document.getElementById('routeSteps').replaceChildren();
    try {
        let result;
        const preferIndoor = document.getElementById('preferIndoor').checked;
        if (sub) result = await sub.route(startPoint, endPoint, { preferIndoor });
        else {
            const route = await requestCampusRoute(startPoint, endPoint, { preferIndoor });
            result = { segments: [{ floor: null, coords: route.coordinates }], transitions: [] };
        }
        if (version !== requestVersion) return;
        routeResult = result;
        if (!routeResult.segments.some(segment => segment.coords.length)) throw new Error('No mapped route found.');
        const steps = document.getElementById('routeSteps');
        for (const transition of routeResult.transitions) {
            const button = document.createElement('button');
            button.className = 'route-step'; button.textContent = transition.text;
            button.onclick = () => sub.focus(transition.to); steps.appendChild(button);
        }
        const indoorFloor = startPoint.floor ?? endPoint.floor;
        if (indoorFloor != null) sub.focus(startPoint.floor ?? 1);
        else {
            const coords = routeResult.segments.flatMap(s => s.coords);
            map.fitBounds(L.latLngBounds(coords), { padding: [50, 50], maxZoom: 19 });
        }
        renderRoute();
    } catch (error) {
        if (version !== requestVersion) return;
        routeResult = null; renderRoute();
    }
}

function samePoint(a, b) {
    const aId = a.nodeId ?? a.spaceId, bId = b.nodeId ?? b.spaceId;
    if (aId && bId) return aId === bId;
    const dLat = (a.lat - b.lat) * 111320;
    const dLon = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dLat, dLon) < 10;
}

function selectPoint(point) {
    if (startPoint && !endPoint && samePoint(point, startPoint)) {
        ++requestVersion;
        startPoint = null; routeResult = null;
        document.getElementById('startLoc').value = '';
        document.getElementById('routeSteps').replaceChildren();
        renderRoute();
        return;
    }
    if (!startPoint || endPoint) {
        ++requestVersion;
        startPoint = point; endPoint = null; routeResult = null;
        document.getElementById('startLoc').value = point.name ?? '';
        document.getElementById('endLoc').value = '';
        document.getElementById('routeSteps').replaceChildren();
        renderRoute();
    } else {
        endPoint = point;
        document.getElementById('endLoc').value = point.name ?? '';
        calculateRoute();
    }
}

map.on('click', event => {
    try { selectPoint(sub ? sub.click(event.latlng.lat, event.latlng.lng) : { lat: event.latlng.lat, lon: event.latlng.lng }); }
    catch (error) { /* invalid SUB click: ignore */ }
});
map.on('zoomend moveend', renderRoute);
document.getElementById('preferIndoor').addEventListener('change', () => {
    if (startPoint && endPoint) calculateRoute();
});

document.getElementById('routeBtn').onclick = () => {
    const resolve = (id, previous) => {
        const name = document.getElementById(id).value;
        if (!name && previous) return previous;
        if (!locations[name]) throw new Error('Choose a location from the suggestions, or place a marker.');
        return sub?.endpoint(name) ?? { lat: locations[name][0], lon: locations[name][1], name };
    };
    try {
        const start = resolve('startLoc', startPoint), end = resolve('endLoc', endPoint);
        startPoint = start; endPoint = end; calculateRoute();
    } catch (error) { /* invalid location: ignore */ }
};
