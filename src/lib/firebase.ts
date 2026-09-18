import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import rawConfig from '../../firebase-applet-config.json';

const firebaseConfig = { ...rawConfig };
delete (firebaseConfig as any).firestoreDatabaseId;

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Initialize Firestore with default database or explicitly configured databaseId
const dbId = (rawConfig as any)?.firestoreDatabaseId;
export const db = dbId && dbId !== '(default)' && dbId !== 'default'
  ? getFirestore(app, dbId)
  : getFirestore(app);
export const storage = getStorage(app);

export default app;