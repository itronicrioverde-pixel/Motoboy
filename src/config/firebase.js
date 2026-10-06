import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { shouldUseLocalEmulators } from './local-emulators';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

if (shouldUseLocalEmulators(
  import.meta.env.VITE_USE_LOCAL_EMULATORS === 'true',
  import.meta.env.DEV,
  firebaseConfig.projectId,
)) {
  // O proxy local do Vite mantém as chamadas na mesma origem do navegador.
  const emulatorOrigin = new URL(window.location.href);
  connectAuthEmulator(auth, emulatorOrigin.origin, { disableWarnings: true });
  connectFirestoreEmulator(db, emulatorOrigin.hostname, Number(emulatorOrigin.port));
}
