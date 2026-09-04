import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Operator } from '../types';

export const DEFAULT_OPERATORS: Operator[] = [];

const OPERATORS_COLLECTION = 'operators';
const LOCAL_OPERATORS_KEY = 'export_mgmt_operators_v1';

// Helper to manage local operators cache
function getLocalOperators(): Operator[] {
  try {
    const saved = localStorage.getItem(LOCAL_OPERATORS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore error
  }
  return [];
}

function saveLocalOperators(operators: Operator[]): void {
  try {
    localStorage.setItem(LOCAL_OPERATORS_KEY, JSON.stringify(operators));
  } catch (e) {
    // Ignore error
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
  ]);
}

export async function fetchOperatorByEmail(email: string): Promise<Operator | null> {
  const cleanEmail = email.trim().toLowerCase();
  const localList = getLocalOperators();
  const localFound = localList.find((op) => op.email.toLowerCase() === cleanEmail);

  // Attempt Firestore fetch with fallback
  try {
    const docRef = doc(db, OPERATORS_COLLECTION, cleanEmail);
    const docSnap = await withTimeout(getDoc(docRef), 2000);
    if (docSnap.exists()) {
      const remoteData = docSnap.data() as Operator;
      // Update local storage cache
      const updatedList = [remoteData, ...localList.filter((op) => op.email.toLowerCase() !== cleanEmail)];
      saveLocalOperators(updatedList);
      return remoteData;
    }
  } catch (err) {
    // Silent fallback to local cache
  }

  return localFound || null;
}

export async function saveOperatorMaster(operator: Operator): Promise<void> {
  const cleanEmail = operator.email.trim().toLowerCase();
  const operatorData: Operator = {
    ...operator,
    id: cleanEmail,
    email: cleanEmail,
    createdAt: operator.createdAt || new Date().toISOString(),
  };

  // 1. Instantly save to local cache
  const localList = getLocalOperators();
  const updatedList = [operatorData, ...localList.filter((op) => op.email.toLowerCase() !== cleanEmail)];
  saveLocalOperators(updatedList);

  // 2. Async save to Firestore in background (non-blocking)
  try {
    const docRef = doc(db, OPERATORS_COLLECTION, cleanEmail);
    await withTimeout(setDoc(docRef, operatorData, { merge: true }), 3000);
  } catch (err) {
    // Silent fallback - local cache is already updated
  }
}

export async function deleteOperatorMaster(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();

  // 1. Instantly remove from local cache
  const localList = getLocalOperators();
  const updatedList = localList.filter((op) => op.email.toLowerCase() !== cleanEmail);
  saveLocalOperators(updatedList);

  // 2. Async delete in Firestore
  try {
    const docRef = doc(db, OPERATORS_COLLECTION, cleanEmail);
    await withTimeout(deleteDoc(docRef), 3000);
  } catch (err) {
    // Ignore error - local cache is already updated
  }
}

export async function fetchAllOperators(): Promise<Operator[]> {
  const localList = getLocalOperators();

  try {
    const colRef = collection(db, OPERATORS_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2000);
    if (!querySnap.empty) {
      const results: Operator[] = [];
      querySnap.forEach((d) => {
        results.push(d.data() as Operator);
      });
      if (results.length > 0) {
        saveLocalOperators(results);
        return results;
      }
    }
  } catch (err) {
    // Silent fallback
  }

  return localList;
}

export async function seedInitialOperatorsIfNeeded(): Promise<void> {
  // No demo operator seeding needed
  return;
}

