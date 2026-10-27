// Foto de producto: se guarda como data URL en `products.image_path` y viaja
// a las cajas con el catálogo, así que se reduce a algo ligero (lado mayor
// MAX_SIDE px, WebP; JPEG si el navegador no sabe codificar WebP). Fondo
// blanco para que un PNG con transparencia no se vea negro.

const MAX_SIDE = 320;
const QUALITY = 0.82;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const fileToProductImage = (file) =>
  new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error("El archivo no es una imagen"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("La imagen es demasiado grande (máx. 15 MB)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo abrir la imagen"));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const webp = canvas.toDataURL("image/webp", QUALITY);
        resolve(
          webp.startsWith("data:image/webp")
            ? webp
            : canvas.toDataURL("image/jpeg", QUALITY),
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
