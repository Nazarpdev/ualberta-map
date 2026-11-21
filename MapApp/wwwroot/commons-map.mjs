import { createIndoorBuilding } from './indoor-building.mjs';
export function createCommonsMap(map, onSelect, onFloorChange) {
    const options = {
        key: 'commons',
        dataUrl: './indoor/commons/map.json',
        panel: null,
        panes: { plans: 'commonsPlans', details: 'commonsDetails', labels: 'commonsLabels' },
        titlePrefix: 'University Commons',
        avoidSub: false
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
