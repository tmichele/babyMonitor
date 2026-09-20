// Configurazione Firebase condivisa da tutti i dispositivi che aprono questo sito.
// Sostituisci i valori segnaposto con quelli del tuo progetto (Console Firebase →
// Impostazioni progetto → Le tue app → Configurazione SDK): finché restano i segnaposto,
// l'app chiede di incollare la configurazione nella schermata iniziale di ogni dispositivo.
// La chiave API web di Firebase non è un segreto: i dati sono protetti dal login e dalle
// regole Firestore (firestore.rules).
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCV9n3FD9_df0U3fYANPKx9dYcRV1j7CNM',
  authDomain: 'babymonitor-640f9.firebaseapp.com',
  projectId: 'babymonitor-640f9',
  storageBucket: 'babymonitor-640f9.firebasestorage.app',
  messagingSenderId: '564374747420',
  appId: '1:564374747420:web:b7b03ffff1f5437f93a2d9',
};

// Opzionale: server ICE/TURN per il video WebRTC quando i due dispositivi sono su reti diverse.
// window.ICE_SERVERS = [
//   { urls: 'stun:stun.l.google.com:19302' },
//   { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
// ];
