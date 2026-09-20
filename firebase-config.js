// Configurazione Firebase condivisa da tutti i dispositivi che aprono questo sito.
// Sostituisci i valori segnaposto con quelli del tuo progetto (Console Firebase →
// Impostazioni progetto → Le tue app → Configurazione SDK): finché restano i segnaposto,
// l'app chiede di incollare la configurazione nella schermata iniziale di ogni dispositivo.
// La chiave API web di Firebase non è un segreto: i dati sono protetti dal login e dalle
// regole Firestore (firestore.rules).
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
