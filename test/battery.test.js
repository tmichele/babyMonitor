import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBattery, batteryLabel, isLowBattery } from '../js/battery.js';

test('normalizeBattery accetta 0..1 (API) e 0..100 (remoto)', () => {
  assert.deepEqual(normalizeBattery({ level: 0.847, charging: false }), { level: 85, charging: false });
  assert.deepEqual(normalizeBattery({ level: 42, charging: true }), { level: 42, charging: true });
  assert.deepEqual(normalizeBattery({ level: 1, charging: false }), { level: 100, charging: false });
  assert.equal(normalizeBattery(null), null);
  assert.equal(normalizeBattery({ level: 'x' }), null);
});

test('batteryLabel e isLowBattery', () => {
  assert.equal(batteryLabel(null), '🔋 n/d');
  assert.equal(batteryLabel({ level: 85, charging: false }), '🔋 85%');
  assert.equal(batteryLabel({ level: 12, charging: false }), '🪫 12%');
  assert.equal(batteryLabel({ level: 12, charging: true }), '⚡ 12%');
  assert.ok(isLowBattery({ level: 15, charging: false }));
  assert.ok(!isLowBattery({ level: 15, charging: true }));
  assert.ok(!isLowBattery({ level: 16, charging: false }));
  assert.ok(!isLowBattery(null));
});
