import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import rawConfig from '../../firebase-applet-config.json';

const firebaseConfig = { ...rawConfig };
delete (firebaseConfig as any).firestoreDatabaseId;

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// ★ここを変更：カッコなしの "default" を明示的に指定します！
export const db = getFirestore(app, "default");
export const storage = getStorage(app);

export default app;