import { createIndoorBuilding } from './indoor-building.mjs';
import type { IndoorBuilding, IndoorBuildingOptions, SelectedPoint } from './indoor-building.mjs';

export function createCommonsMap(map: L.Map, onSelect: (point: SelectedPoint) => void, onFloorChange: () => void): Promise<IndoorBuilding> {
    const options: IndoorBuildingOptions = {
        key: 'commons',
        dataUrl: './indoor/commons/map.json',
        panel: null,
        panes: { plans: 'commonsPlans', details: 'commonsDetails', labels: 'commonsLabels' },
        titlePrefix: 'University Commons',
        avoidSub: false
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
