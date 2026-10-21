import { createIndoorBuilding } from './indoor-building.mjs';
import type { IndoorBuilding, IndoorBuildingOptions, SelectedPoint } from './indoor-building.mjs';

export function createCscMap(map: L.Map, onSelect: (point: SelectedPoint) => void, onFloorChange: () => void): Promise<IndoorBuilding> {
    // Level 1 only: a single floor needs no side panel, just its own panes.
    const options: IndoorBuildingOptions = {
        key: 'csc',
        dataUrl: '/indoor/csc/map.json',
        panel: null,
        panes: { plans: 'cscPlans', details: 'cscDetails', labels: 'cscLabels' },
        titlePrefix: 'CSC',
        avoidSub: false
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
