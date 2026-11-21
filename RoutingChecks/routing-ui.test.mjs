import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const subData = JSON.parse(readFileSync(new URL('../MapApp/wwwroot/indoor/sub/map.json', import.meta.url)));
// These event tests need a loaded indoor building, while the indoor suite exercises its geometry.
const planFixture = {
    ...subData, footprint: undefined, nodes: [], edges: [],
    floors: subData.floors.map(floor => ({ ...floor, spaces: [], partitions: [], staircases: [] }))
};
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

// Exercise the real map event handlers, SUB adapter, and shared request client.
// Leaflet/DOM drawing is stubbed; routing and preference propagation are not.
for (const withSub of [true, false]) {
    test(`checkbox reaches the API and recalculates marker routes (SUB loaded: ${withSub})`, async t => {
        t.mock.method(console, 'error', () => {});
        const saved = Object.fromEntries(['L', 'document', 'window', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame']
            .map(key => [key, globalThis[key]]));
        const elements = new Map(), mapEvents = new Map(), requests = [];
        let rejectPreference = false;
        const element = () => ({
            value: '', checked: false, style: {}, events: new Map(),
            addEventListener(type, handler) { this.events.set(type, handler); },
            appendChild() {}, replaceChildren() {}, querySelectorAll: () => [],
            querySelector: () => null, classList: { remove() {}, toggle() {} },
            parentElement: { appendChild() {} }
        });
        const layer = () => ({ addTo() { return this; }, clearLayers() { return this; }, addData() { return this; }, eachLayer() {} });
        const map = {
            setView() { return this; }, zoomControl: { setPosition() {} },
            createPane() {}, getPane: () => ({ style: {} }),
            on(events, callback) { for (const event of events.split(' ')) mapEvents.set(event, callback); },
            getZoom: () => 16, getBounds: () => ({ intersects: () => true }),
            fitBounds() {}, removeLayer() {}
        };
        try {
            globalThis.document = {
                getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
                createElement: element
            };
            globalThis.window = { matchMedia: () => ({ matches: false }) };
            globalThis.requestAnimationFrame = () => 1;
            globalThis.cancelAnimationFrame = () => {};
            globalThis.L = {
                map: () => map, layerGroup: layer, tileLayer: layer, svg: () => ({}),
                latLngBounds: () => ({ pad() { return this; } }), divIcon: () => ({}), geoJSON: layer,
                marker: layer, polyline: layer, polygon: layer
            };
            globalThis.fetch = async (url, options) => {
                const request = new URL(url, 'http://localhost');
                if (request.pathname === '/indoor/sub/map.json') return { ok: withSub, json: async () => planFixture };
                if (request.pathname.startsWith('/indoor/')) return { ok: false };
                if (request.pathname === '/api/locations') return { ok: true, json: async () => ({}) };
                if (request.pathname.endsWith('.geojson')) return { ok: true, json: async () => ({ features: [] }) };
                const params = request.searchParams;
                requests.push({ params, options });
                return { ok: true, json: async () => ({
                    coordinates: [[53.525262, -113.523927], [53.528026, -113.525568]],
                    cost: 400,
                    preferIndoor: rejectPreference ? false : params.get('preferIndoor') === 'true'
                }) };
            };
            await import(`../MapApp/wwwroot/map.js?ui-test=${withSub}`);
            await settle();
            const click = mapEvents.get('click');
            click({ latlng: { lat: 53.525262, lng: -113.523927 } });
            click({ latlng: { lat: 53.528026, lng: -113.525568 } });
            await settle();
            assert.equal(requests.at(-1).params.get('preferIndoor'), 'false');
            const checkbox = elements.get('preferIndoor');
            checkbox.checked = true;
            checkbox.events.get('change')();
            await settle();
            assert.equal(requests.length, 2);
            assert.equal(requests.at(-1).params.get('preferIndoor'), 'true');
            assert.equal(requests.at(-1).params.get('avoidSub'), String(withSub));
            assert.equal(requests.at(-1).params.get('includeCost'), 'true');
            assert.equal(requests.at(-1).options.cache, 'no-store');
            assert.equal(elements.get('routeStatus').textContent, '');
            checkbox.checked = false;
            checkbox.events.get('change')();
            await settle();
            assert.equal(requests.at(-1).params.get('preferIndoor'), 'false');
            assert.equal(elements.get('routeStatus').textContent, '');
            rejectPreference = true;
            checkbox.checked = true;
            checkbox.events.get('change')();
            await settle();
            assert.match(elements.get('routeStatus').textContent, /has not applied the selected preference/);
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete globalThis[key];
                else globalThis[key] = value;
            }
        }
    });
}
