/** Keep phone photos within the server body limit; server decoding and face checks still apply. */
export async function shrinkPhoto(file: File, maxBytes = 3_000_000): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= maxBytes && ['image/jpeg', 'image/png'].includes(file.type)) { bitmap.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw Error('canvas');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.65, 0.5, 0.35]) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) break;
    }
    if (!blob) throw Error('encode'); return blob;
  } catch { return file; }
}
