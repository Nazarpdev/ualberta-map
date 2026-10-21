import { createIndoorBuilding } from './indoor-building.mjs';
import type { IndoorBuilding, IndoorBuildingOptions, SelectedPoint } from './indoor-building.mjs';

export function createSubMap(map: L.Map, onSelect: (point: SelectedPoint) => void, onFloorChange: () => void): Promise<IndoorBuilding> {
    // Three floors with the shared side panel and its floor buttons.
    const options: IndoorBuildingOptions = {
        key: 'sub',
        dataUrl: '/indoor/sub/map.json',
        panel: document.getElementById('subPanel'),
        panes: { plans: 'subPlans', details: 'subDetails', labels: 'subLabels' },
        titlePrefix: 'SUB',
        avoidSub: true
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
