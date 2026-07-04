/**
 * ImageCollage Executor
 *
 * Combines all connected input images into a single grid image
 * (inverse of splitGrid).
 */

import type { ImageCollageNodeData } from "@/types";
import type { NodeExecutionContext } from "./types";

export async function executeImageCollage(ctx: NodeExecutionContext): Promise<void> {
  const { node, getConnectedInputs, updateNodeData } = ctx;

  const { images } = getConnectedInputs(node.id);

  if (images.length === 0) {
    updateNodeData(node.id, {
      status: "error",
      error: "No input images connected",
    });
    throw new Error("No input images connected");
  }

  const nodeData = node.data as ImageCollageNodeData;

  updateNodeData(node.id, {
    inputImages: images,
    status: "loading",
    error: null,
  });

  try {
    const { buildImageCollage } = await import("@/utils/imageCollage");
    const outputImage = images.length === 1
      ? images[0] // single image: pass through untouched
      : await buildImageCollage(images, { columns: nodeData.columns });

    updateNodeData(node.id, {
      outputImage,
      outputImageRef: undefined,
      status: "complete",
      error: null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      updateNodeData(node.id, { status: "idle", error: null });
      throw error;
    }
    updateNodeData(node.id, {
      status: "error",
      error: error instanceof Error ? error.message : "Failed to build collage",
    });
    throw error instanceof Error ? error : new Error("Failed to build collage");
  }
}
