// Copia questo file in `firebase-config.js` e inserisci i valori del tuo progetto Firebase
// (Console Firebase → Impostazioni progetto → Le tue app → Configurazione SDK).
// Il file `firebase-config.js` è ignorato da git.
window.FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

// Opzionale: server ICE/TURN per il video WebRTC quando i due dispositivi sono su reti diverse.
// window.ICE_SERVERS = [
//   { urls: 'stun:stun.l.google.com:19302' },
//   { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
// ];
