import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export interface Point {
  x: number; // 0 to 1 relative to canvas width
  y: number; // 0 to 1 relative to canvas height
}

export interface PdfAnnotationNote {
  id: string;
  shipmentId: string;
  pageNumber: number; // 1-indexed
  type: 'stroke' | 'line' | 'text' | 'rect';
  rectShape?: 'rectangle' | 'rounded' | 'circle'; // 囲み枠の形状: 四角, 角丸四角, 丸(楕円)
  x?: number; // 0 to 1
  y?: number; // 0 to 1
  startX?: number; // 0 to 1 for line
  startY?: number; // 0 to 1 for line
  endX?: number; // 0 to 1 for line
  endY?: number; // 0 to 1 for line
  width?: number; // 0 to 1
  height?: number; // 0 to 1
  text?: string;
  color: string; // Stroke / Primary color
  textColor?: string;
  bgColor?: string; // Background / Fill color
  borderColor?: string; // Border color for text note or rect
  borderWidth?: number;
  fillColor?: string; // Specific fill color for rect
  fillOpacity?: number; // 0 (transparent) to 1 (solid)
  lineWidth?: number;
  fontSize?: number;
  points?: Point[];
  authorName?: string;
  createdAt: string;
}

const LOCAL_NOTES_KEY = 'export_mgmt_pdf_notes_v2';
const COLLECTION_NAME = 'shipmentPdfNotes';

// Helper to get local cached notes
function getLocalNotes(): PdfAnnotationNote[] {
  try {
    const saved = localStorage.getItem(LOCAL_NOTES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    // Ignore error
  }
  return [];
}

// Helper to save local cached notes
function saveLocalNotes(notes: PdfAnnotationNote[]): void {
  try {
    localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
  } catch (e) {
    // Ignore error
  }
}

/**
 * Get synchronously cached annotation notes for a shipment
 */
export function getShipmentNotesSync(shipmentId: string): PdfAnnotationNote[] {
  return getLocalNotes().filter((n) => n.shipmentId === shipmentId);
}

// Timeout utility for non-blocking Firestore calls
function withTimeout<T>(promise: Promise<T>, ms: number = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
  ]);
}

/**
 * Subscribe to real-time PDF annotation notes for a given shipmentId from Firestore
 * with instant local cache fallback.
 */
export function subscribePdfNotes(
  shipmentId: string,
  onNotesUpdated: (notes: PdfAnnotationNote[]) => void
): () => void {
  let isUnsubscribed = false;

  // 1. Immediately emit local cached notes for instant response
  const localList = getLocalNotes().filter((n) => n.shipmentId === shipmentId);
  onNotesUpdated(localList);

  // 2. Attach Firestore real-time listener
  let unsubscribeFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, COLLECTION_NAME);
    const q = query(colRef, where('shipmentId', '==', shipmentId));

    unsubscribeFirestore = onSnapshot(
      q,
      (snapshot) => {
        if (isUnsubscribed) return;
        const remoteNotes: PdfAnnotationNote[] = [];
        snapshot.forEach((docSnap) => {
          remoteNotes.push({ ...(docSnap.data() as PdfAnnotationNote), id: docSnap.id });
        });

        // Merge remote notes into local cache
        const allLocal = getLocalNotes().filter((n) => n.shipmentId !== shipmentId);
        const merged = [...allLocal, ...remoteNotes];
        saveLocalNotes(merged);

        onNotesUpdated(remoteNotes);
      },
      (err) => {
        // Fallback to local on Firestore error (e.g., offline or permissions)
        console.warn('Firestore onSnapshot error for pdfNotes:', err);
      }
    );
  } catch (err) {
    console.warn('Failed to attach Firestore snapshot listener:', err);
  }

  // Return unsubscribe cleanup function
  return () => {
    isUnsubscribed = true;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Save a new or updated note/drawing annotation to local storage and Firestore.
 */
export async function savePdfNote(note: PdfAnnotationNote): Promise<void> {
  // 1. Instantly update local cache
  const localList = getLocalNotes();
  const filtered = localList.filter((n) => n.id !== note.id);
  const updatedList = [...filtered, note];
  saveLocalNotes(updatedList);

  // 2. Asynchronously sync to Firestore
  try {
    const docRef = doc(db, COLLECTION_NAME, note.id);
    await withTimeout(setDoc(docRef, note, { merge: true }), 3000);
  } catch (err) {
    // Silent fallback to local persistence
  }
}

/**
 * Delete a note/drawing annotation from local storage and Firestore.
 */
export async function deletePdfNote(noteId: string): Promise<void> {
  // 1. Instantly remove from local cache
  const localList = getLocalNotes();
  const updatedList = localList.filter((n) => n.id !== noteId);
  saveLocalNotes(updatedList);

  // 2. Asynchronously delete from Firestore
  try {
    const docRef = doc(db, COLLECTION_NAME, noteId);
    await withTimeout(deleteDoc(docRef), 3000);
  } catch (err) {
    // Silent fallback
  }
}

/**
 * Clear all notes for a specific shipment.
 */
export async function clearAllPdfNotes(shipmentId: string): Promise<void> {
  const localList = getLocalNotes();
  const toDelete = localList.filter((n) => n.shipmentId === shipmentId);
  const remaining = localList.filter((n) => n.shipmentId !== shipmentId);
  saveLocalNotes(remaining);

  // Async delete from Firestore
  try {
    for (const note of toDelete) {
      const docRef = doc(db, COLLECTION_NAME, note.id);
      await withTimeout(deleteDoc(docRef), 1500).catch(() => null);
    }
  } catch (err) {
    // Ignore error
  }
}
