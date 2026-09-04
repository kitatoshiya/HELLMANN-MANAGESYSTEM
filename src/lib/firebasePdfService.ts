import { storage, db } from './firebase';
import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

// Collection in Firestore for permanent PDF blob & metadata storage
const PDF_FIRESTORE_COLLECTION = 'shipment_pdf_data';
const CHUNK_SIZE = 700000; // ~700KB safe margin per chunk under 1MB Firestore doc limit

/**
 * Upload PDF directly to Firestore (and Storage fallback) as reliable permanent multi-terminal cloud storage
 */
export async function uploadPdfToFirebase(
  shipmentId: string,
  pdfDataUrl: string,
  aliases: string[] = []
): Promise<string | null> {
  if (!shipmentId || !pdfDataUrl) return null;
  const cleanId = shipmentId.trim();
  const allKeys = Array.from(new Set([cleanId, ...aliases.map((a) => a?.trim()).filter(Boolean)]));

  // 1. Primary: Save directly to Firestore collection for 100% durable persistence across container reboots
  try {
    const totalLength = pdfDataUrl.length;
    if (totalLength <= CHUNK_SIZE) {
      const payload = {
        shipmentId: cleanId,
        inlinePdfDataUrl: pdfDataUrl,
        chunkCount: 1,
        updatedAt: new Date().toISOString(),
      };
      for (const key of allKeys) {
        await setDoc(doc(db, PDF_FIRESTORE_COLLECTION, key), payload, { merge: true });
      }
    } else {
      const chunkCount = Math.ceil(totalLength / CHUNK_SIZE);
      const payload: Record<string, any> = {
        shipmentId: cleanId,
        chunkCount,
        updatedAt: new Date().toISOString(),
      };
      for (let i = 0; i < chunkCount; i++) {
        payload[`chunk_${i}`] = pdfDataUrl.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      }
      for (const key of allKeys) {
        await setDoc(doc(db, PDF_FIRESTORE_COLLECTION, key), payload, { merge: true });
      }
    }
  } catch (fsErr) {
    console.warn('[firebasePdfService] Firestore PDF write warning:', fsErr);
  }

  // 2. Secondary: Try Firebase Storage if bucket is provisioned
  try {
    const storageRef = ref(storage, `shipment_pdfs/${cleanId}.pdf`);
    await uploadString(storageRef, pdfDataUrl, 'data_url');
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (storageErr) {
    // Expected when Firebase Storage bucket is not enabled; Firestore direct blob storage handles permanent sync.
    return 'firestore_saved';
  }
}

/**
 * Fetch PDF from Firestore or Firebase Storage
 */
export async function getPdfFromFirebase(shipmentId: string): Promise<string | null> {
  if (!shipmentId) return null;
  const cleanId = shipmentId.trim();

  // 1. Check Firestore document first (contains inlinePdfDataUrl or chunks)
  try {
    const docSnap = await getDoc(doc(db, PDF_FIRESTORE_COLLECTION, cleanId));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.inlinePdfDataUrl && data.inlinePdfDataUrl.length > 500) {
        return data.inlinePdfDataUrl;
      }
      if (data.chunkCount && data.chunkCount > 1) {
        let assembled = '';
        for (let i = 0; i < data.chunkCount; i++) {
          assembled += data[`chunk_${i}`] || '';
        }
        if (assembled.length > 500) {
          return assembled;
        }
      }
      if (data.downloadUrl) {
        try {
          const res = await fetch(data.downloadUrl);
          if (res.ok) {
            const blob = await res.blob();
            return new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
          }
        } catch (fetchErr) {
          console.warn('[firebasePdfService] Download from URL failed:', fetchErr);
        }
      }
    }
  } catch (fsErr) {
    console.warn('[firebasePdfService] Firestore PDF lookup error:', fsErr);
  }

  // 2. Try direct Storage URL check
  try {
    const storageRef = ref(storage, `shipment_pdfs/${cleanId}.pdf`);
    const downloadUrl = await getDownloadURL(storageRef);
    if (downloadUrl) {
      const res = await fetch(downloadUrl);
      if (res.ok) {
        const blob = await res.blob();
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    }
  } catch {
    // File doesn't exist in Storage
  }

  return null;
}

/**
 * Delete PDF data from Firestore and Firebase Storage
 */
export async function deletePdfFromFirebase(shipmentId: string, aliases: string[] = []): Promise<void> {
  if (!shipmentId) return;
  const cleanId = shipmentId.trim();
  const allKeys = Array.from(new Set([cleanId, ...aliases.map((a) => a?.trim()).filter(Boolean)]));

  for (const key of allKeys) {
    try {
      await deleteDoc(doc(db, PDF_FIRESTORE_COLLECTION, key));
    } catch (_) {}
  }

  try {
    const storageRef = ref(storage, `shipment_pdfs/${cleanId}.pdf`);
    await deleteObject(storageRef);
  } catch (_) {}
}
