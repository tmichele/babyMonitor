import { auth, A, authErrorMessage } from '../firebase.js';
import { $, toast } from '../ui.js';

export function renderAuth(root) {
  root.innerHTML = `
  <section class="view narrow">
    <div class="card">
      <h2>Accedi</h2>
      <p class="muted">Usa lo stesso account sul dispositivo camera e su quello che guarda: i dati sono visibili solo a chi è autenticato con quell'account.</p>
      <form id="auth-form" autocomplete="on">
        <label>Email <input id="auth-email" type="email" required autocomplete="username" inputmode="email"></label>
        <label>Password <input id="auth-pass" type="password" required minlength="6" autocomplete="current-password"></label>
        <div class="actions">
          <button type="submit" class="btn primary" id="auth-login">Accedi</button>
          <button type="button" class="btn" id="auth-register">Crea account</button>
          <button type="button" class="btn link" id="auth-reset">Password dimenticata</button>
        </div>
      </form>
    </div>
  </section>`;

  const email = () => $('#auth-email', root).value.trim();
  const pass = () => $('#auth-pass', root).value;
  const busy = (on) => $$buttons().forEach((b) => (b.disabled = on));
  const $$buttons = () => Array.from(root.querySelectorAll('button'));

  async function run(action) {
    busy(true);
    try {
      await action();
    } catch (err) {
      toast(authErrorMessage(err), 'error', 5000);
    } finally {
      busy(false);
    }
  }

  $('#auth-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => A.signInWithEmailAndPassword(auth, email(), pass()));
  });
  $('#auth-register', root).addEventListener('click', () => {
    if (!email() || pass().length < 6) return toast('Inserisci email e una password di almeno 6 caratteri.', 'error');
    run(async () => {
      await A.createUserWithEmailAndPassword(auth, email(), pass());
      toast('Account creato', 'ok');
    });
  });
  $('#auth-reset', root).addEventListener('click', () => {
    if (!email()) return toast('Inserisci prima la tua email.', 'error');
    run(async () => {
      await A.sendPasswordResetEmail(auth, email());
      toast('Email di reimpostazione inviata', 'ok');
    });
  });
}
