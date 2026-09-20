# Baby Monitor

Baby monitor web (single-page application in HTML/JavaScript puro) che trasforma due dispositivi
qualsiasi con browser in un sistema di sorveglianza per il bambino:

- **Camera**: il telefono/tablet/PC lasciato vicino al bambino riprende, **rileva il movimento e il
  pianto a 4 livelli** e trasmette video e audio in diretta.
- **Visualizzatore**: uno o più dispositivi che mostrano i livelli in tempo reale, lo storico degli
  eventi, il video in diretta (WebRTC) e avvisano con suono, vibrazione e notifiche.

La comunicazione tra i dispositivi passa da un **progetto Firebase tuo** (Authentication +
Cloud Firestore): i dati sono visibili solo a chi accede con lo stesso account.

## Funzionalità

| Area | Dettagli |
| --- | --- |
| Movimento | Confronto di frame a bassa risoluzione (64×48) sul canvas; punteggio = % di pixel cambiati; livelli `Fermo / Leggero / Moderato / Intenso`; overlay rosso sulle zone in movimento. |
| Pianto | Web Audio API: volume RMS in dB + quota di energia nella banda 300–3000 Hz + "picchi" armonici; punteggio 0–100; livelli `Silenzio / Rumore / Lamento / Pianto`. |
| Livelli stabili | Media mobile esponenziale + tenuta del livello (2,5 s) per evitare sfarfallii; sensibilità 1–10 per movimento e pianto, regolabile anche **dal visualizzatore**. |
| Eventi | Registrati su Firestore quando un livello sale (soglia minima e cooldown configurabili); elenco degli ultimi 50 sul visualizzatore. |
| Video live | WebRTC (audio + video) con segnalazione via Firestore; STUN di Google di default, TURN opzionale. |
| Avvisi | Banner, beep, vibrazione e notifiche di sistema quando movimento/pianto superano il livello scelto; avviso se la camera va offline. |
| Comodità | Schermo tenuto acceso (Wake Lock), modalità "schermo scuro" per la notte, scelta della videocamera, PWA installabile. |

## Requisiti

- Un progetto Firebase (piano gratuito sufficiente).
- L'app va servita via **HTTPS** (o `localhost`): i browser lo richiedono per camera, microfono e
  notifiche. **GitHub Pages** è la scelta più semplice (vedi sotto); vanno bene anche Firebase
  Hosting, Netlify o qualsiasi hosting statico.
- Browser recenti (Chrome/Edge/Firefox/Safari). Su iOS l'app funziona in Safari con la scheda in
  primo piano.

## Configurazione Firebase

1. Nella [console Firebase](https://console.firebase.google.com/) crea un progetto e aggiungi
   un'**app Web**.
2. **Authentication → Metodo di accesso**: abilita **Email/Password**.
3. **Firestore Database**: crea il database (modalità produzione) e pubblica le regole contenute in
   [`firestore.rules`](firestore.rules) (oppure `firebase deploy --only firestore:rules`).
4. Copia la configurazione dell'app web (Impostazioni progetto → Le tue app → Configurazione SDK).
   Puoi:
   - inserirla in **`firebase-config.js`** nel repository (anche direttamente da GitHub con la
     matita "Edit"): vale per tutti i dispositivi che aprono il sito, che passano subito al login; oppure
   - incollarla nella **schermata iniziale** dell'app su ogni dispositivo (viene salvata nel browser).
5. Se pubblichi su un dominio diverso da quelli Firebase, aggiungilo in
   **Authentication → Impostazioni → Domini autorizzati**.

Nessun indice composito è necessario: le query usano un solo campo di ordinamento.

## Pubblicazione su GitHub Pages (consigliata, gratuita)

Come per l'app della spesa: nessun build, basta servire i file del repository.

1. Su GitHub apri il repository → **Settings** → **Pages**.
2. Source: **Deploy from a branch** → Branch: **main** → cartella **/ (root)** → **Save**.
3. Dopo 1-2 minuti l'app è online su `https://TUOUSERNAME.github.io/babyMonitor/`
   (HTTPS incluso, quindi camera, microfono e notifiche funzionano).
4. Apri l'URL su ogni dispositivo: se hai compilato `firebase-config.js` vedi subito il login,
   altrimenti incolla la configurazione Firebase nella schermata iniziale.
5. In Firebase → **Authentication → Impostazioni → Domini autorizzati** aggiungi
   `TUOUSERNAME.github.io`.

## Avvio in locale

```bash
npm run serve          # http://127.0.0.1:8080 (localhost è considerato sicuro dai browser)
```

In alternativa a GitHub Pages: `npm run deploy` pubblica su Firebase Hosting (richiede
`firebase-tools` e `firebase use <progetto>`).

## Uso sui due dispositivi


1. Apri l'app, accedi con lo **stesso account** (registrati la prima volta).
2. Sul dispositivo vicino al bambino scegli **Camera**, dai un nome, premi **Avvia monitoraggio**
   e concedi camera e microfono. Di notte usa **Schermo scuro**.
3. Sull'altro dispositivo scegli **Visualizzatore**: la camera compare nell'elenco con i livelli in
   tempo reale. **Avvia video** apre il flusso in diretta; in **Avvisi** scegli da quale livello
   essere avvisato e abilita le notifiche.
4. Dalla sezione **Sensibilità della camera (remoto)** puoi alzare/abbassare la sensibilità senza
   toccare il dispositivo camera.

## Come funziona la rilevazione

**Movimento** (`js/detection/motion.js`): ogni 125 ms il frame video viene disegnato su un canvas
64×48, convertito in luminanza e confrontato con il precedente. I pixel la cui differenza supera
`pixelDelta` (28/255, per ignorare il rumore del sensore) contano come "in movimento"; la
percentuale viene smussata (EMA) e confrontata con le soglie `[1.5, 5, 12] × (5 / sensibilità)`.

**Pianto** (`js/detection/cry.js`): un `AnalyserNode` (FFT 2048) fornisce ogni 100 ms spettro e
forma d'onda. Si calcolano il volume in dB, la quota di energia nella banda 300–3000 Hz (dove si
concentra il pianto infantile) e la "picchiosità" dello spettro in banda (un pianto è armonico, un
rumore di fondo è piatto). Il punteggio è `100 × volume × (0,35 + 0,65 × somiglianza)`, smussato e
confrontato con le soglie `[20, 45, 70] × (5 / sensibilità)`.

Entrambi passano per un `LevelTracker` che mantiene un livello raggiunto per almeno 2,5 s.

## Modello dati Firestore

```
users/{uid}/cameras/{cameraId}
  name, status: online|offline, monitoring, lastSeen (server), settings {...},
  motion { score, level }, cry { score, level }
users/{uid}/cameras/{cameraId}/events/{eventId}
  type: motion|cry, level 1..3, score, label, ts (server), tsLocal
users/{uid}/cameras/{cameraId}/calls/{callId}          ← segnalazione WebRTC (temporanea)
  status: requested|offered|answered|ended, viewerId, offer, answer
  cameraCandidates/*, viewerCandidates/*
```

La camera invia un battito ogni 20 s; il visualizzatore la considera offline dopo 60 s senza
segnali o quando lo stato è `offline`. Le chiamate WebRTC vengono cancellate al termine.

## Struttura del progetto

```
index.html                 shell della SPA
css/style.css              stile (tema chiaro/scuro automatico, mobile-first)
js/app.js                  bootstrap, router hash (#/, #/camera, #/viewer, #/setup)
js/config.js               config Firebase/ICE, identità dispositivo, preferenze locali
js/firebase.js             caricamento SDK (CDN), auth, riferimenti Firestore
js/rtc.js                  CameraStreamer / ViewerStream (WebRTC + segnalazione Firestore)
js/alerts.js               beep, vibrazione, notifiche, Wake Lock
js/detection/levels.js     soglie, livelli, LevelTracker, impostazioni, logica eventi
js/detection/motion.js     rilevatore movimento
js/detection/cry.js        rilevatore pianto
js/views/*.js              schermate: setup, auth, home, camera, viewer
firestore.rules            regole di sicurezza (solo il proprietario legge/scrive i propri dati)
firebase.json              hosting + regole
test/*.test.js             test unitari (node --test)
test/e2e/                  test end-to-end in Chromium con Firebase finto e media simulati
```

## Test

```bash
npm test                   # unitari: livelli, movimento, pianto, parsing configurazione
node test/e2e/run.mjs      # end-to-end (richiede Playwright: npm i -D playwright)
```

Il test end-to-end avvia Chromium con camera/microfono finti (un tono armonico simula il pianto),
sostituisce l'SDK Firebase con `test/e2e/fake-firebase.js` e verifica registrazione, camera,
visualizzatore, sensibilità remota, video WebRTC tra due schede, eventi e stop. Con
`E2E_SCREENSHOTS=<cartella>` salva anche gli screenshot delle schermate.

## Limiti noti

- **Rete**: senza server TURN il video può non connettersi se i due dispositivi sono dietro NAT
  restrittivi (reti mobili diverse). Aggiungi un TURN nella schermata di configurazione o in
  `firebase-config.js` (`window.ICE_SERVERS`).
- **Background**: i browser sospendono camera e microfono quando la scheda va in secondo piano;
  tieni l'app in primo piano sul dispositivo camera (lo schermo resta acceso da solo).
- **Rilevazione euristica**: non è un classificatore addestrato; regola la sensibilità in base
  alla stanza (luce, rumore di fondo). Il rilevatore reagisce anche a voci e rumori forti, che
  vengono comunque segnalati come `Rumore`/`Lamento`.
- **Costi Firestore**: lo stato viene scritto al massimo ogni 1,5 s solo quando cambia; con uso
  notturno normale si resta nel piano gratuito. Gli eventi non vengono cancellati automaticamente:
  puoi impostare una policy TTL sul campo `tsLocal` o eliminarli dalla console.
