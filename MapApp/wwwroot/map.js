const map = L.map('map').setView([53.5264, -113.5255], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

fetch('/map.geojson')
    .then(res => res.json())
    .then(data => L.geoJSON(data).addTo(map));
