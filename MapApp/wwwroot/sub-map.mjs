import { createIndoorBuilding } from './indoor-building.mjs';
export function createSubMap(map, onSelect, onFloorChange) {
    // Three floors with the shared side panel and its floor buttons.
    const options = {
        key: 'sub',
        dataUrl: '/indoor/sub/map.json',
        panel: document.getElementById('subPanel'),
        panes: { plans: 'subPlans', details: 'subDetails', labels: 'subLabels' },
        titlePrefix: 'SUB',
        avoidSub: true
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
