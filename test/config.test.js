import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFirebaseConfigInput, isValidFirebaseConfig, parseIceServersInput } from '../js/config.js';

test('parseFirebaseConfigInput accetta JSON', () => {
  const cfg = parseFirebaseConfigInput('{"apiKey":"k","projectId":"p","appId":"a"}');
  assert.deepEqual(cfg, { apiKey: 'k', projectId: 'p', appId: 'a' });
});

test('parseFirebaseConfigInput accetta lo snippet della console Firebase', () => {
  const snippet = `
    // Import the functions you need
    const firebaseConfig = {
      apiKey: "AIza-xyz",
      authDomain: 'demo.firebaseapp.com',
      projectId: "demo",
      storageBucket: "demo.appspot.com", // commento
      messagingSenderId: "123",
      appId: "1:123:web:abc",
    };
    const app = initializeApp(firebaseConfig);`;
  const cfg = parseFirebaseConfigInput(snippet);
  assert.equal(cfg.apiKey, 'AIza-xyz');
  assert.equal(cfg.authDomain, 'demo.firebaseapp.com');
  assert.equal(cfg.appId, '1:123:web:abc');
});

test('parseFirebaseConfigInput rifiuta configurazioni incomplete o placeholder', () => {
  assert.throws(() => parseFirebaseConfigInput('ciao'), /non riconosciuta/);
  assert.throws(() => parseFirebaseConfigInput('{"apiKey":"k"}'), /incompleta/);
  assert.throws(() => parseFirebaseConfigInput('{"apiKey":"YOUR_API_KEY","projectId":"p","appId":"a"}'), /incompleta/);
  assert.throws(() => parseFirebaseConfigInput('{apiKey: "k", projectId: }'), /non valida/);
  assert.equal(isValidFirebaseConfig(null), false);
});

test('parseIceServersInput', () => {
  assert.equal(parseIceServersInput(''), null);
  assert.deepEqual(parseIceServersInput('{"urls":"stun:a"}'), [{ urls: 'stun:a' }]);
  assert.throws(() => parseIceServersInput('[{"url":"x"}]'), /urls/);
});
