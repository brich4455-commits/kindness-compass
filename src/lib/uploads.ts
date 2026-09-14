import { useCallback, useRef, useState } from "react";

export interface UploadItem {
  /** Stable client-side id */
  id: string;
  /** Original file name (kept only as a label) */
  nombreOriginal: string;
  /** Compressed/original blob ready to send */
  blob: Blob;
  /** Final file name actually used for the request */
  fileName: string;
  /** Bytes originally received vs bytes uploaded */
  tamanoOriginal: number;
  tamanoFinal: number;
  /** Preview URL (images only) */
  preview?: string;
  estado: "comprimiendo" | "listo" | "subiendo" | "listo-done" | "error";
  progreso: number; // 0..1
  error?: string;
}

export const MAX_TAMANO_BYTES = 10 * 1024 * 1024; // hard cap: 10 MB por archivo
const EXTENSIONES_IMAGEN = /\.(jpe?g|png|webp)$/i;

export function fmtBytes(b: number) {
  if (!Number.isFinite(b) || b <= 0) return "0 KB";
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Real mime from the file magic bytes (defends against renamed fake images). */
async function sniffTipo(blob: Blob): Promise<string | null> {
  try {
    const buf = await blob.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
      // RIFF container
      const riff = String.fromCharCode(...Array.from(b.subarray(8, 12)));
      if (riff === "WEBP") return "image/webp";
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Resize + re-encode to WebP in the browser (camera photos are 3–8MB for 400px displays). */
async function comprimirImagen(file: Blob, maxLado = 1600, calidad = 0.82): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * escala));
    const height = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await new Promise((res) => canvas.toBlob(res, "image/webp", calidad));
  } catch {
    return null;
  }
}

interface AgregarFilesOpts {
  onSubir?: (item: UploadItem) => Promise<void>;
  /** Where compressed originals live: "memoria" (default) frees RAM after upload; "archivar" keeps them. */
  modo?: "memoria" | "archivar";
}

export function useUploads(opts: AgregarFilesOpts = {}) {
  const { onSubir, modo = "memoria" } = opts;
  const [items, setItems] = useState<UploadItem[]>([]);
  const dragging = useRef(false);

  const actualizar = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const agregarFiles = useCallback(async (lista: File[]) => {
    if (!lista.length) return;

    // Mobile warning: many heavy files can eat data/wifi quota.
    const pesado = lista.some((f) => f.size > 3 * 1024 * 1024);
    if (pesado && navigator.userAgent.includes("Mobile")) {
      if (!window.confirm(`${lista.length} archivos elegidos (algunos grandes). Continuar sin wifi puede consumir tus datos.`)) {
        return;
      }
    }

    for (const file of lista) {
      const id = crypto.randomUUID();
      const esImagn = EXTENSIONES_IMAGEN.test(file.name);

      // Client-side sanity check only — validation of size/type/name belongs
      // on the server too. We generate our own name regardless.
      if (file.size > MAX_TAMANO_BYTES) {
        setItems((prev) => [
          ...prev,
          {
            id,
            nombreOriginal: file.name,
            blob: file,
            fileName: file.name.replace(/[/\\]/g, "_").slice(-120),
            tamanoOriginal: file.size,
            tamanoFinal: file.size,
            preview: undefined,
            estado: "error",
            progreso: 0,
            error: `Demasiado grande (${fmtBytes(file.size)}, máximo ${fmtBytes(MAX_TAMANO_BYTES)})`,
          },
        ]);
        continue;
      }

      // Instant local preview for images.
      const preview = esImagn ? URL.createObjectURL(file) : undefined;

      const nuevo: UploadItem = {
        id,
        nombreOriginal: file.name,
        blob: file,
        fileName: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${(file.name.split(".").pop() ?? "bin").toLowerCase()}`,
        tamanoOriginal: file.size,
        tamanoFinal: file.size,
        preview,
        estado: esImagn ? "comprimiendo" : "listo",
        progreso: 0,
      };
      setItems((prev) => [...prev, nuevo]);

      // Image: compress in-browser BEFORE sending.
      if (esImagn) {
        const comprimida = await comprimirImagen(file);
        if (comprimida && comprimida.size < file.size) {
          // Drop the eager preview (it pointed to the original file object).
          actualizar(id, {
            blob: comprimida,
            tamanoFinal: comprimida.size,
            preview: URL.createObjectURL(comprimida),
            estado: "listo",
          });
          setTimeout(() => URL.revokeObjectURL(preview!), 1000);
        } else {
          actualizar(id, { estado: "listo" });
        }
      }
    }
  }, [actualizar]);

  const subirUno = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;

      // Re-validate the REAL type from magic bytes right before leaving the client.
      if (EXTENSIONES_IMAGEN.test(item.nombreOriginal)) {
        const tipoReal = await sniffTipo(item.blob);
        if (tipoReal !== "image/jpeg" && tipoReal !== "image/png" && tipoReal !== "image/webp") {
          actualizar(id, { estado: "error", progreso: 0, error: "El contenido no coincide con una imagen válida." });
          return;
        }
      }

      actualizar(id, { estado: "subiendo", progreso: 0, error: undefined });
      try {
        if (!opts.onSubir) throw new Error("No se configuró dónde enviar el archivo.");
        await opts.onSubir({ ...item, estado: "subiendo" });
        actualizar(id, { estado: "listo-done", progreso: 1 });
        if (modo === "memoria" && item.preview) {
          setTimeout(() => URL.revokeObjectURL(item.preview!), 2000);
        }
      } catch (e) {
        actualizar(id, {
          estado: "error",
          progreso: 0,
          error: e instanceof Error ? e.message : "Falló la subida.",
        });
      }
    },
    [items, opts.onSubir, actualizar, modo],
  );

  const quitar = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      // Orphan cleanup: dropping a not-yet-uploaded file releases its preview memory.
      if (item.estado !== "listo-done") {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [items],
  );

  const limpiar = useCallback(() => {
    items.forEach((i) => {
      if (i.preview && i.estado !== "listo-done") URL.revokeObjectURL(i.preview);
    });
    setItems([]);
  }, [items]);

  return { items, dragging, agregarFiles, subirUno, quitar, limpiar };
}
