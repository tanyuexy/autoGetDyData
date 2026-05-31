/** 参考图上传前在浏览器侧压缩，避免生成时服务端塞入超大 base64 */
export const REFERENCE_IMAGE_COMPRESS_MAX_EDGE = 1536;
export const REFERENCE_IMAGE_COMPRESS_SKIP_BELOW_BYTES = 700_000;
export const REFERENCE_IMAGE_JPEG_QUALITY = 0.82;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片，请换一张试试"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
      type,
      quality
    );
  });
}

export async function compressReferenceImageFile(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  if (file.size <= REFERENCE_IMAGE_COMPRESS_SKIP_BELOW_BYTES) return file;

  const img = await loadImageFromFile(file);
  const maxEdge = REFERENCE_IMAGE_COMPRESS_MAX_EDGE;
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  /** 大图 PNG 转 JPEG，减小 edits 上传体积、缩短上游耗时 */
  const outputType =
    file.type === "image/png" && file.size > REFERENCE_IMAGE_COMPRESS_SKIP_BELOW_BYTES
      ? "image/jpeg"
      : file.type === "image/png"
        ? "image/png"
        : "image/jpeg";
  const quality = outputType === "image/jpeg" ? REFERENCE_IMAGE_JPEG_QUALITY : undefined;
  const blob = await canvasToBlob(canvas, outputType, quality ?? 1);
  if (blob.size >= file.size) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "reference";
  const ext = outputType === "image/png" ? ".png" : ".jpg";
  return new File([blob], `${base}${ext}`, { type: outputType });
}
