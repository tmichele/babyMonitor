// Video/audio in diretta via WebRTC. La segnalazione passa da Firestore:
//   users/{uid}/cameras/{cameraId}/calls/{callId}
//     { status: requested|offered|answered|ended, viewerId, offer, answer }
//     cameraCandidates/*, viewerCandidates/*
// Il visualizzatore crea la richiesta, la camera risponde con l'offerta (tracce audio+video),
// il visualizzatore invia la risposta. I candidati ICE si ascoltano solo dopo la remote description.
import { S, db } from './firebase.js';
import { loadIceServers } from './config.js';

const DISCONNECT_GRACE_MS = 10000;
const OFFER_TIMEOUT_MS = 25000;

function rtcConfig() {
  return { iceServers: loadIceServers() };
}

async function deleteCollection(colRef) {
  const snap = await S.getDocs(colRef);
  await Promise.all(snap.docs.map((d) => S.deleteDoc(d.ref)));
}

export async function deleteCall(callRef) {
  try {
    await deleteCollection(S.collection(callRef, 'cameraCandidates'));
    await deleteCollection(S.collection(callRef, 'viewerCandidates'));
    await S.deleteDoc(callRef);
  } catch (err) {
    console.warn('Pulizia chiamata fallita', err);
  }
}

/** Lato camera: risponde alle richieste di visione con il MediaStream locale. */
export class CameraStreamer {
  constructor({ stream, callsRef, sessionId = '', onViewersChange = () => {} }) {
    this.stream = stream;
    this.callsRef = callsRef;
    this.sessionId = sessionId;
    this.onViewersChange = onViewersChange;
    this.peers = new Map();
    this.unsubscribe = null;
  }

  async start() {
    await deleteCollection(this.callsRef).catch(() => {});
    const q = S.query(this.callsRef, S.where('status', '==', 'requested'));
    this.unsubscribe = S.onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added' && !this.peers.has(change.doc.id)) {
          this.handleRequest(change.doc.ref).catch((err) => console.error('Errore chiamata', err));
        }
      });
    }, (err) => console.error('Ascolto chiamate fallito', err));
  }

  replaceStream(stream) {
    this.stream = stream;
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        const track = stream.getTracks().find((t) => t.kind === sender.track?.kind);
        if (track) sender.replaceTrack(track).catch(() => {});
      }
    }
  }

  /** Si aggiudica la richiesta: se un'altra scheda camera l'ha già presa, non risponde. */
  async claimRequest(callRef) {
    try {
      return await S.runTransaction(db, async (tx) => {
        const snap = await tx.get(callRef);
        if (!snap.exists() || snap.data().status !== 'requested') return false;
        tx.update(callRef, { status: 'claimed', cameraSession: this.sessionId });
        return true;
      });
    } catch (err) {
      console.warn('Richiesta non aggiudicata', err);
      return false;
    }
  }

  async handleRequest(callRef) {
    if (!(await this.claimRequest(callRef))) return;
    const pc = new RTCPeerConnection(rtcConfig());
    const peer = { pc, unsubs: [], disconnectTimer: null };
    this.peers.set(callRef.id, peer);
    this.emitViewers();

    this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) S.addDoc(S.collection(callRef, 'cameraCandidates'), e.candidate.toJSON()).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = null;
        this.emitViewers();
      } else if (st === 'failed' || st === 'closed') {
        this.endCall(callRef);
      } else if (st === 'disconnected' && !peer.disconnectTimer) {
        peer.disconnectTimer = setTimeout(() => {
          if (pc.connectionState !== 'connected') this.endCall(callRef);
        }, DISCONNECT_GRACE_MS);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await S.updateDoc(callRef, {
      offer: { type: offer.type, sdp: offer.sdp },
      status: 'offered',
      offeredAt: S.serverTimestamp(),
    });

    let answered = false;
    peer.unsubs.push(S.onSnapshot(callRef, async (snap) => {
      if (!snap.exists()) return this.endCall(callRef);
      const data = snap.data();
      if (data.status === 'ended') return this.endCall(callRef);
      if (data.answer && !answered) {
        answered = true;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) {
          console.error('Risposta non valida', err);
          return this.endCall(callRef);
        }
        peer.unsubs.push(S.onSnapshot(S.collection(callRef, 'viewerCandidates'), (cs) => {
          cs.docChanges().forEach((c) => {
            if (c.type === 'added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
          });
        }));
      }
    }));

    peer.offerTimer = setTimeout(() => {
      if (!answered) this.endCall(callRef);
    }, OFFER_TIMEOUT_MS);
  }

  endCall(callRef) {
    const peer = this.peers.get(callRef.id);
    if (!peer) return;
    this.peers.delete(callRef.id);
    peer.unsubs.forEach((u) => u());
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    if (peer.offerTimer) clearTimeout(peer.offerTimer);
    try {
      peer.pc.close();
    } catch {
      /* ignora */
    }
    deleteCall(callRef);
    this.emitViewers();
  }

  emitViewers() {
    let connected = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') connected++;
    this.onViewersChange({ connected, total: this.peers.size });
  }

  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const [id] of this.peers) this.endCall(S.doc(this.callsRef, id));
  }

  /** Chiude tutto senza cancellare documenti: un'altra sessione camera è ora responsabile. */
  stopLocal() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const peer of this.peers.values()) {
      peer.unsubs.forEach((u) => u());
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      if (peer.offerTimer) clearTimeout(peer.offerTimer);
      try {
        peer.pc.close();
      } catch {
        /* ignora */
      }
    }
    this.peers.clear();
    this.emitViewers();
  }
}

/** Lato visualizzatore: richiede il flusso a una camera e lo mostra in un <video>. */
export class ViewerStream {
  constructor({ callsRef, videoEl, viewerId, onStatus = () => {} }) {
    this.callsRef = callsRef;
    this.videoEl = videoEl;
    this.viewerId = viewerId;
    this.onStatus = onStatus;
    this.pc = null;
    this.callRef = null;
    this.unsubs = [];
    this.timers = [];
    this.stopped = false;
  }

  async start() {
    this.stopped = false;
    this.onStatus('requesting');
    const pc = new RTCPeerConnection(rtcConfig());
    this.pc = pc;
    const remote = new MediaStream();
    this.videoEl.srcObject = remote;
    pc.ontrack = (e) => {
      (e.streams[0]?.getTracks() || [e.track]).forEach((t) => {
        if (!remote.getTracks().includes(t)) remote.addTrack(t);
      });
      this.tryPlay();
    };
    pc.oniceconnectionstatechange = () => console.info('ICE:', pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') this.onStatus('connected');
      else if (st === 'failed') this.fail('Connessione fallita (serve forse un server TURN).');
      else if (st === 'disconnected') {
        this.onStatus('disconnected');
        this.timers.push(setTimeout(() => {
          if (pc.connectionState !== 'connected') this.fail('Connessione interrotta.');
        }, DISCONNECT_GRACE_MS));
      }
    };

    this.callRef = await S.addDoc(this.callsRef, {
      status: 'requested',
      viewerId: this.viewerId,
      createdAt: S.serverTimestamp(),
    });
    const callRef = this.callRef;
    pc.onicecandidate = (e) => {
      if (e.candidate) S.addDoc(S.collection(callRef, 'viewerCandidates'), e.candidate.toJSON()).catch(() => {});
    };

    let answering = false;
    this.unsubs.push(S.onSnapshot(callRef, async (snap) => {
      if (this.stopped) return;
      if (!snap.exists()) return this.fail('La camera ha chiuso la trasmissione.');
      const data = snap.data();
      if (data.status === 'ended') return this.fail('Trasmissione terminata.');
      if (data.offer && !answering) {
        answering = true;
        this.onStatus('connecting');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await S.updateDoc(callRef, { answer: { type: answer.type, sdp: answer.sdp }, status: 'answered' });
          this.unsubs.push(S.onSnapshot(S.collection(callRef, 'cameraCandidates'), (cs) => {
            cs.docChanges().forEach((c) => {
              if (c.type === 'added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
            });
          }));
        } catch (err) {
          console.error(err);
          this.fail('Negoziazione fallita.');
        }
      }
    }, (err) => this.fail(err.message)));

    this.timers.push(setTimeout(() => {
      if (!answering && !this.stopped) this.fail('La camera non risponde: è attiva?');
    }, OFFER_TIMEOUT_MS));
  }

  /** Alcuni browser (iOS) bloccano la riproduzione con audio fuori da un tocco: ripiega su muto. */
  tryPlay() {
    const v = this.videoEl;
    if (!v?.play) return;
    v.play().catch(() => {
      v.muted = true;
      v.play().then(() => this.onStatus('muted')).catch(() => {});
    });
  }

  fail(message) {
    if (this.stopped) return;
    this.onStatus('error', message);
    this.stop();
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    try {
      this.pc?.close();
    } catch {
      /* ignora */
    }
    this.pc = null;
    if (this.videoEl) this.videoEl.srcObject = null;
    if (this.callRef) {
      const ref = this.callRef;
      this.callRef = null;
      try {
        await S.updateDoc(ref, { status: 'ended' });
      } catch {
        /* già cancellata dalla camera */
      }
    }
    this.onStatus('idle');
  }
}
