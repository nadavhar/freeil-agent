/* ══════════════════════════════════════════════════════════════
   Map — Leaflet map with geolocation + radius filter.
   Depends on: state.js, translations.js, utils.js
   External: Leaflet (loaded in <head>)
══════════════════════════════════════════════════════════════ */

function haversineKm(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderMapMarkers() {
    if (!mapInstance) return;

    // Clear existing markers and circle
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];
    if (mapRadiusCircle) { mapRadiusCircle.remove(); mapRadiusCircle = null; }

    const geoEvents = [...publicEvents, ...privateEvents].filter(e => e.latitude && e.longitude);

    if (userLatLng) {
        mapRadiusCircle = L.circle(userLatLng, {
            radius: mapRadius * 1000,
            color: '#00d4aa', fillColor: '#00d4aa',
            fillOpacity: 0.08, weight: 2, dashArray: '6 4',
        }).addTo(mapInstance);

        const nearby  = geoEvents.filter(ev => haversineKm(userLatLng[0], userLatLng[1], ev.latitude, ev.longitude) <= mapRadius);
        const toShow  = nearby.length ? nearby : geoEvents; // fallback: show all if none nearby

        toShow.forEach(ev => {
            const dist = haversineKm(userLatLng[0], userLatLng[1], ev.latitude, ev.longitude);
            const m = L.marker([ev.latitude, ev.longitude])
                .bindPopup(`<strong>${escHtml(ev.title)}</strong><br>${escHtml(ev.date || '')}${ev.city ? ' · ' + escHtml(getCityLabel(ev.city)) : ''}<br>📍 ${dist.toFixed(1)} ק"מ ממך`)
                .addTo(mapInstance);
            mapMarkers.push(m);
        });
    } else {
        geoEvents.forEach(ev => {
            const m = L.marker([ev.latitude, ev.longitude])
                .bindPopup(`<strong>${escHtml(ev.title)}</strong><br>${escHtml(ev.date || '')}${ev.city ? ' · ' + escHtml(getCityLabel(ev.city)) : ''}`)
                .addTo(mapInstance);
            mapMarkers.push(m);
        });
    }
}

function updateMapRadius(val) {
    mapRadius = parseInt(val);
    document.getElementById('radius-val').textContent = val;
    renderMapMarkers();
}

function initMap() {
    // Delay so container is visible and has layout dimensions
    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize();
            renderMapMarkers();
            return;
        }

        mapInstance = L.map('map-el', { center: [31.5, 34.9], zoom: 8 });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(mapInstance);

        if (!navigator.geolocation) { renderMapMarkers(); return; }

        navigator.geolocation.getCurrentPosition(pos => {
            userLatLng = [pos.coords.latitude, pos.coords.longitude];
            mapInstance.setView(userLatLng, 13);

            L.marker(userLatLng, {
                icon: L.divIcon({
                    className: '',
                    html: '<div class="map-user-dot"></div>',
                    iconSize: [16, 16], iconAnchor: [8, 8]
                })
            }).addTo(mapInstance).bindPopup('📍 המיקום שלך');

            renderMapMarkers();
        }, () => {
            renderMapMarkers(); // permission denied — show all
        }, { timeout: 8000 });
    }, 80);
}
