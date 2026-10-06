export async function printDocument(doc) {
  try {
    const buffer = doc.output("arraybuffer");
    const result = await window.api.invoke("print-pdf", new Uint8Array(buffer));
    return result;
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
}