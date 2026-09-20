const ualbertaBounds = [
    [53.5170, -113.5350], // Tighter Southwest corner (University Ave / 116 St)
    [53.5310, -113.5150]  // Tighter Northeast corner (Saskatchewan Dr / 112 St)
];

const map = L.map('map', {
    maxBounds: ualbertaBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 15 // Increased from 14 to block zoom out further
}).setView([53.5264, -113.5255], 16); // Start closer

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

let locations = {};

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
        locations = data;
        setupAutocomplete(document.getElementById('startLoc'));
        setupAutocomplete(document.getElementById('endLoc'));
    });

fetch('/map.geojson')
    .then(res => res.json())
    .then(data => L.geoJSON(data, { style: { color: '#a0c4ff', weight: 2 } }).addTo(map));

let startMarker, endMarker, routeLayer;
let step = 0;

map.on('click', async (e) => {
    if (step === 0) {
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        if (routeLayer) map.removeLayer(routeLayer);

        startMarker = L.marker(e.latlng).addTo(map);
        step = 1;
    } else {
        endMarker = L.marker(e.latlng).addTo(map);
        step = 0;

        const slat = startMarker.getLatLng().lat;
        const slon = startMarker.getLatLng().lng;
        const elat = endMarker.getLatLng().lat;
        const elon = endMarker.getLatLng().lng;

        const res = await fetch(`/api/route?slat=${slat}&slon=${slon}&elat=${elat}&elon=${elon}`);
        const coords = await res.json();

        routeLayer = L.polyline(coords, { color: 'red', weight: 5 }).addTo(map);
    }
});

document.getElementById('routeBtn').onclick = async () => {
    const start = document.getElementById('startLoc').value;
    const end = document.getElementById('endLoc').value;

    if (!locations[start] || !locations[end]) return; // Stop if invalid name

    const [slat, slon] = locations[start];
    const [elat, elon] = locations[end];

    const res = await fetch(`/api/route?slat=${slat}&slon=${slon}&elat=${elat}&elon=${elon}`);
    const coords = await res.json();

    if (routeLayer) map.removeLayer(routeLayer);

    routeLayer = L.polyline(coords, { color: 'red', weight: 5 }).addTo(map);
    map.fitBounds(routeLayer.getBounds()); // Zoom to fit route
};
