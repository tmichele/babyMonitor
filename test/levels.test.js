import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreToLevel, scaledThresholds, LevelTracker, normalizeSettings, settingsEqual, shouldLogEvent, ema, DEFAULT_SETTINGS,
} from '../js/detection/levels.js';

test('scoreToLevel mappa il punteggio ai 4 livelli', () => {
  const thr = [10, 20, 30];
  assert.equal(scoreToLevel(0, thr), 0);
  assert.equal(scoreToLevel(9.9, thr), 0);
  assert.equal(scoreToLevel(10, thr), 1);
  assert.equal(scoreToLevel(25, thr), 2);
  assert.equal(scoreToLevel(30, thr), 3);
  assert.equal(scoreToLevel(999, thr), 3);
});

test('scaledThresholds: sensibilità alta abbassa le soglie, 5 le lascia invariate', () => {
  assert.deepEqual(scaledThresholds([10, 20, 30], 5), [10, 20, 30]);
  assert.deepEqual(scaledThresholds([10, 20, 30], 10), [5, 10, 15]);
  assert.deepEqual(scaledThresholds([10, 20, 30], 1), [50, 100, 150]);
  assert.deepEqual(scaledThresholds([10, 20, 30], 'x'), [10, 20, 30]);
});

test('LevelTracker mantiene il livello per holdMs prima di scendere', () => {
  const t = new LevelTracker({ holdMs: 1000 });
  assert.equal(t.update(3, 0), 3);
  assert.equal(t.update(0, 500), 3);
  assert.equal(t.update(0, 999), 3);
  assert.equal(t.update(0, 1000), 0);
  assert.equal(t.update(2, 1100), 2);
  assert.equal(t.update(3, 1200), 3, 'sale subito');
  assert.equal(t.update(1, 1500), 3);
  assert.equal(t.update(1, 2300), 1);
});

test('normalizeSettings applica default e limiti', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
  const s = normalizeSettings({ motionSensitivity: 42, crySensitivity: '3', motionThresholds: [5, 1, 2], eventMinLevel: 0, holdMs: 'abc' });
  assert.equal(s.motionSensitivity, 10);
  assert.equal(s.crySensitivity, 3);
  assert.deepEqual(s.motionThresholds, DEFAULT_SETTINGS.motionThresholds, 'soglie non crescenti → default');
  assert.equal(s.eventMinLevel, 1);
  assert.equal(s.holdMs, DEFAULT_SETTINGS.holdMs);
  assert.ok(settingsEqual({ motionSensitivity: 5 }, {}));
  assert.ok(!settingsEqual({ motionSensitivity: 6 }, {}));
});

test('shouldLogEvent: registra su salita, rispetta cooldown, azzera sotto il minimo', () => {
  const cfg = { eventMinLevel: 2, eventCooldownMs: 10000, minGapMs: 1000 };
  let r = shouldLogEvent(null, 1, 0, cfg);
  assert.equal(r.log, false);
  r = shouldLogEvent(r.next, 2, 100, cfg);
  assert.equal(r.log, true, 'primo evento a livello 2');
  r = shouldLogEvent(r.next, 2, 2000, cfg);
  assert.equal(r.log, false, 'stesso livello entro il cooldown');
  r = shouldLogEvent(r.next, 3, 2500, cfg);
  assert.equal(r.log, true, 'salita a 3');
  r = shouldLogEvent(r.next, 0, 3000, cfg);
  assert.equal(r.log, false);
  assert.equal(r.next.level, 0);
  r = shouldLogEvent(r.next, 2, 3200, cfg);
  assert.equal(r.log, false, 'risalita troppo ravvicinata (minGap)');
  r = shouldLogEvent(r.next, 2, 14000, cfg);
  assert.equal(r.log, true, 'cooldown scaduto');
});

test('ema', () => {
  assert.equal(ema(null, 10, 0.5), 10);
  assert.equal(ema(10, 20, 0.5), 15);
});
