import { createIndoorBuilding } from './indoor-building.mjs';
export function createCscMap(map, onSelect, onFloorChange) {
    // Level 1 only: a single floor needs no side panel, just its own panes.
    const options = {
        key: 'csc',
        dataUrl: '/indoor/csc/map.json',
        panel: null,
        panes: { plans: 'cscPlans', details: 'cscDetails', labels: 'cscLabels' },
        titlePrefix: 'CSC',
        avoidSub: false
    };
    return createIndoorBuilding(map, options, onSelect, onFloorChange);
}
