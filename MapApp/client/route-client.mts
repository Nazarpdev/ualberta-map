// Shared by ordinary campus routes and the campus legs of SUB routes.
import type { GeoPoint } from './indoor-router.mjs';

export interface CampusRoute {
    coordinates: [number, number][];
    cost: number;
    preferIndoor: boolean;
}

export type CampusEndpoint = GeoPoint & { name?: string };

export async function requestCampusRoute(
    start: CampusEndpoint,
    end: CampusEndpoint,
    { preferIndoor = false, avoidSub = false }: { preferIndoor?: boolean; avoidSub?: boolean } = {}
): Promise<CampusRoute> {
    const params = new URLSearchParams({
        slat: String(start.lat), slon: String(start.lon), elat: String(end.lat), elon: String(end.lon),
        preferIndoor: String(preferIndoor), avoidSub: String(avoidSub), includeCost: 'true'
    });
    if (start.name) params.set('startName', start.name);
    if (end.name) params.set('endName', end.name);
    const response = await fetch(`/api/route?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not calculate a campus route');
    const route = (await response.json()) as CampusRoute;
    if (!Array.isArray(route.coordinates) || route.preferIndoor !== preferIndoor)
        throw new Error('The route server has not applied the selected preference. Restart the app and refresh this page.');
    return route;
}
