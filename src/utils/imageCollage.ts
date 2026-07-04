/**
 * Image Collage utility
 *
 * Combines multiple images into a single grid image (the inverse of
 * gridSplitter). Used by the imageCollage node to pack several reference
 * views into one image — e.g. to keep multi-angle references inside a
 * single prompt-constructor image variable.
 */

export interface CollageOptions {
  /** Number of columns; null/undefined = auto (≈ square grid) */
  columns?: number | null;
  /** Gap between cells in pixels */
  gap?: number;
  /** Canvas background color */
  background?: string;
}

/** Longest allowed side of the output canvas */
const MAX_CANVAS_SIDE = 4096;
/** Longest allowed side of a single cell */
const MAX_CELL_SIDE = 1536;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/**
 * Build a single collage image from multiple input images.
 * Cells are uniform; each image is drawn object-contain, centered.
 * Returns a JPEG data URL (solid background, keeps payload size sane).
 */
export async function buildImageCollage(
  imageDataUrls: string[],
  options: CollageOptions = {}
): Promise<string> {
  if (imageDataUrls.length === 0) {
    throw new Error("No images to combine");
  }

  const images = await Promise.all(imageDataUrls.map(loadImage));

  const count = images.length;
  const cols = options.columns && options.columns > 0
    ? Math.min(options.columns, count)
    : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const gap = options.gap ?? 8;
  const background = options.background ?? "#ffffff";

  // Uniform cell size: large enough for the biggest image, capped
  let cellWidth = Math.max(...images.map((img) => img.naturalWidth || img.width));
  let cellHeight = Math.max(...images.map((img) => img.naturalHeight || img.height));
  const cellScale = Math.min(1, MAX_CELL_SIDE / Math.max(cellWidth, cellHeight));
  cellWidth = Math.round(cellWidth * cellScale);
  cellHeight = Math.round(cellHeight * cellScale);

  // Cap the whole canvas
  let canvasWidth = cols * cellWidth + (cols + 1) * gap;
  let canvasHeight = rows * cellHeight + (rows + 1) * gap;
  const canvasScale = Math.min(1, MAX_CANVAS_SIDE / Math.max(canvasWidth, canvasHeight));
  if (canvasScale < 1) {
    cellWidth = Math.floor(cellWidth * canvasScale);
    cellHeight = Math.floor(cellHeight * canvasScale);
    canvasWidth = cols * cellWidth + (cols + 1) * gap;
    canvasHeight = rows * cellHeight + (rows + 1) * gap;
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  images.forEach((img, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cellX = gap + col * (cellWidth + gap);
    const cellY = gap + row * (cellHeight + gap);

    // object-contain: fit the image inside the cell, centered
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(cellWidth / iw, cellHeight / ih);
    const drawW = Math.round(iw * scale);
    const drawH = Math.round(ih * scale);
    const dx = cellX + Math.round((cellWidth - drawW) / 2);
    const dy = cellY + Math.round((cellHeight - drawH) / 2);

    ctx.drawImage(img, dx, dy, drawW, drawH);
  });

  return canvas.toDataURL("image/jpeg", 0.92);
}
