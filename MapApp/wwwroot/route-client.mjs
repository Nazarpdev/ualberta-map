export async function requestCampusRoute(start, end, { preferIndoor = false, avoidSub = false } = {}) {
    const params = new URLSearchParams({
        slat: String(start.lat), slon: String(start.lon), elat: String(end.lat), elon: String(end.lon),
        preferIndoor: String(preferIndoor), avoidSub: String(avoidSub), includeCost: 'true'
    });
    if (start.name)
        params.set('startName', start.name);
    if (end.name)
        params.set('endName', end.name);
    const response = await fetch(`/api/route?${params}`, { cache: 'no-store' });
    if (!response.ok)
        throw new Error('Could not calculate a campus route');
    const route = (await response.json());
    if (!Array.isArray(route.coordinates) || route.preferIndoor !== preferIndoor)
        throw new Error('The route server has not applied the selected preference. Restart the app and refresh this page.');
    return route;
}
