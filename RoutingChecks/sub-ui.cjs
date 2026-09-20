// Optional browser smoke check: run with Playwright installed and the app running.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(process.env.SUB_TEST_URL || 'http://127.0.0.1:5287');
        await page.locator('#viewSub').click();
        await page.locator('#subFloors').waitFor({ state: 'visible' });
        await page.locator('.sub-footprint').waitFor({ state: 'visible' });
        await page.locator('.sub-room-label').first().waitFor({ state: 'visible' });
        assert.equal(await page.locator('.leaflet-image-layer').count(), 0, 'SUB uses vector geometry, not a floor-plan image');
        assert.ok(await page.locator('.sub-space').count() > 15);
        const checkLabels = async () => {
            await page.waitForFunction(() => !document.getElementById('map').classList.contains('leaflet-zoom-anim'));
            return page.evaluate(() => {
                const labels = [...document.querySelectorAll('.sub-room-label')];
                const icons = [...document.querySelectorAll('.leaflet-marker-icon:not(.sub-room-label)')]
                    .filter(el => Number(getComputedStyle(el).opacity) > 0);
                const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                return labels.length > 0 && labels.every((label, i) => {
                    const matrix = new DOMMatrix(getComputedStyle(label).transform);
                    return matrix.b === 0 && matrix.c === 0
                        && !labels.slice(i + 1).some(other => overlaps(label.getBoundingClientRect(), other.getBoundingClientRect()))
                        && !icons.some(icon => overlaps(label.getBoundingClientRect(), icon.getBoundingClientRect()));
                });
            });
        };
        assert.ok(await checkLabels(), 'Labels are upright and do not overlap labels/icons');
        await page.locator('.leaflet-control-zoom-in').click();
        await page.waitForFunction(() => !document.getElementById('map').classList.contains('leaflet-zoom-anim'));
        await page.locator('.leaflet-control-zoom-in').click();
        await page.waitForFunction(() => !document.getElementById('map').classList.contains('leaflet-zoom-anim'));
        assert.ok(await checkLabels(), 'Labels stay upright and collision-free at close zoom');
        assert.equal(await page.locator('.leaflet-image-layer').count(), 0);
        await page.locator('#viewSub').click();
        await page.waitForFunction(() => !document.getElementById('map').classList.contains('leaflet-zoom-anim'));
        assert.equal(await page.locator('.stair-icon').count(), 3);
        await page.locator('.sub-washroom').first().waitFor();
        assert.equal(await page.locator('.sub-washroom').count(), 2, 'Main floor has east and west washroom locations');
        assert.equal(await page.locator('.sub-pedway[title="Pedway to Stadium Parkade"]').count(), 1);
        await page.locator('.sub-room-label[title="Pedway to Stadium Parkade"]').waitFor({ state: 'visible' });
        await page.locator('#showEntrances').uncheck();
        assert.equal(await page.locator('.entrance-icon:not(.stair-icon)').count(), 0);
        await page.locator('#showEntrances').check();
        await page.locator('#showStairs').uncheck();
        assert.equal(await page.locator('.stair-icon').count(), 0);
        await page.locator('#showStairs').check();
        await page.locator('[data-floor="2"]').click();
        assert.equal(await page.locator('.stair-icon').count(), 2);
        assert.equal(await page.locator('[data-floor="2"]').getAttribute('aria-pressed'), 'true');
        assert.ok(await checkLabels(), 'Level 2 labels avoid collisions');
        assert.equal(await page.locator('.sub-washroom').count(), 1);
        assert.equal(await page.locator('.sub-pedway[title="Pedway to Agriculture / Forestry Centre"]').count(), 1);
        await page.locator('[data-floor="0"]').click();
        assert.equal(await page.locator('.stair-icon').count(), 3);
        assert.ok(await checkLabels(), 'Lower-floor labels avoid collisions');
        assert.equal(await page.locator('.sub-washroom').count(), 1);
        if (process.env.SUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SUB_SCREENSHOT_DIR, 'sub-lower-details.png') });
        await page.locator('[data-floor="1"]').click();
        await page.locator('.sub-pedway[title="Pedway to Stadium Parkade"]').click();
        await page.locator('.sub-washroom[title="West washrooms"]').click();
        await page.locator('.leaflet-routes-pane path').first().waitFor();
        assert.match(await page.locator('#startLoc').inputValue(), /Stadium Parkade/);
        assert.match(await page.locator('#endLoc').inputValue(), /West washrooms/);
        await page.locator('#startLoc').fill('SUB 1-40 · SUBmart');
        await page.locator('#endLoc').fill('SUB 2-200 · University Health Centre (UHC)');
        await page.locator('#endLoc').press('Enter');
        await page.locator('#routeBtn').click();
        await page.locator('.route-step').waitFor();
        assert.equal(await page.locator('.route-step').count(), 1);
        assert.match(await page.locator('.route-step').innerText(), /Main → Level 2/);
        assert.equal(await page.locator('[data-floor="1"]').getAttribute('aria-pressed'), 'true');
        if (process.env.SUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SUB_SCREENSHOT_DIR, 'sub-main-route.png') });
        await page.locator('.route-step').click();
        assert.equal(await page.locator('[data-floor="2"]').getAttribute('aria-pressed'), 'true');
        assert.ok(await page.locator('.leaflet-routes-pane path').count());
        const routeShape = await page.locator('.leaflet-routes-pane path').first().getAttribute('d');
        await page.locator('#showStairs').uncheck();
        assert.equal(await page.locator('.leaflet-routes-pane path').first().getAttribute('d'), routeShape);
        await page.locator('#showStairs').check();
        if (process.env.SUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SUB_SCREENSHOT_DIR, 'sub-level2-route.png') });
        // Autocomplete includes lower-level rooms as well as second-floor rooms.
        await page.locator('#endLoc').fill('Marigold');
        await page.locator('.ac-item').filter({ hasText: 'Marigold' }).click();
        await page.locator('#routeBtn').click();
        await page.waitForFunction(() => document.querySelector('.route-step')?.textContent.includes('Main → Lower'));
        await page.locator('[data-floor="1"]').click();
        await page.locator('.sub-space[data-room="1:1-14"]').click({ position: { x: 8, y: 8 } });
        assert.equal(await page.locator('#startLoc').inputValue(), 'SUB 1-14 · Alumni Room');
        await page.locator('[data-floor="2"]').click();
        await page.locator('.sub-room-label[title="Dinwoodie Lounge"]').click();
        await page.waitForFunction(() => document.querySelector('.route-step')?.textContent.includes('Main → Level 2'));
        // Mixed campus/indoor routing includes a stair handoff.
        await page.locator('#startLoc').fill('Central Academic Building');
        await page.locator('#endLoc').fill('SUB 2-100 · Career Centre');
        await page.locator('#endLoc').press('Enter');
        await page.locator('#routeBtn').click();
        await page.waitForFunction(() => document.querySelector('.route-step')?.textContent.includes('Main → Level 2'));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.route-step').click();
        await page.waitForFunction(() => !document.getElementById('map').classList.contains('leaflet-zoom-anim'));
        assert.ok(await page.locator('#subFloors').isVisible());
        assert.ok(await page.locator('#subLegend').isVisible());
        assert.equal(await page.locator('#subLegend').getAttribute('open'), null);
        if (process.env.SUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SUB_SCREENSHOT_DIR, 'sub-mobile.png') });
        assert.deepEqual(errors, []);
        console.log('PASS: Vector plans, upright collision-free labels, three floors, stair toggle, autocomplete, floor-specific routes, campus handoff, mobile UI; no page errors.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
