import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeImageCollage } from "../imageCollageExecutor";
import type { NodeExecutionContext } from "../types";
import type { WorkflowNode } from "@/types";

// Mock the collage builder (canvas is unavailable in jsdom)
const mockBuildImageCollage = vi.fn().mockResolvedValue("data:image/jpeg;base64,COLLAGE=");
vi.mock("@/utils/imageCollage", () => ({
  buildImageCollage: (...args: unknown[]) => mockBuildImageCollage(...args),
}));

function makeNode(data: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "collage-1",
    type: "imageCollage",
    position: { x: 0, y: 0 },
    data: {
      inputImages: [],
      outputImage: null,
      columns: null,
      status: "idle",
      error: null,
      ...data,
    },
  } as WorkflowNode;
}

function makeCtx(
  node: WorkflowNode,
  overrides: Partial<NodeExecutionContext> = {}
): NodeExecutionContext {
  return {
    node,
    getConnectedInputs: vi.fn().mockReturnValue({
      images: ["data:image/png;base64,A=", "data:image/png;base64,B="],
      videos: [],
      audio: [],
      text: null,
      namedImages: {},
      dynamicInputs: {},
      easeCurve: null,
    }),
    updateNodeData: vi.fn(),
    getFreshNode: vi.fn().mockReturnValue(node),
    getEdges: vi.fn().mockReturnValue([]),
    getNodes: vi.fn().mockReturnValue([node]),
    providerSettings: { providers: {} },
    addIncurredCost: vi.fn(),
    addToGlobalHistory: vi.fn(),
    generationsPath: null,
    saveDirectoryPath: null,
    trackSaveGeneration: vi.fn(),
    appendOutputGalleryImage: vi.fn(),
    get: vi.fn(),
    ...overrides,
  } as unknown as NodeExecutionContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildImageCollage.mockResolvedValue("data:image/jpeg;base64,COLLAGE=");
});

describe("executeImageCollage", () => {
  it("should combine connected images and store the result", async () => {
    const node = makeNode({ columns: 2 });
    const ctx = makeCtx(node);

    await executeImageCollage(ctx);

    expect(mockBuildImageCollage).toHaveBeenCalledWith(
      ["data:image/png;base64,A=", "data:image/png;base64,B="],
      { columns: 2 }
    );

    const calls = (ctx.updateNodeData as ReturnType<typeof vi.fn>).mock.calls;
    const completeCall = calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === "complete"
    );
    expect(completeCall).toBeDefined();
    expect((completeCall![1] as Record<string, unknown>).outputImage).toBe("data:image/jpeg;base64,COLLAGE=");
  });

  it("should pass a single image through without building a collage", async () => {
    const node = makeNode();
    const ctx = makeCtx(node, {
      getConnectedInputs: vi.fn().mockReturnValue({
        images: ["data:image/png;base64,ONLY="],
        videos: [],
        audio: [],
        text: null,
        namedImages: {},
        dynamicInputs: {},
        easeCurve: null,
      }),
    });

    await executeImageCollage(ctx);

    expect(mockBuildImageCollage).not.toHaveBeenCalled();
    const calls = (ctx.updateNodeData as ReturnType<typeof vi.fn>).mock.calls;
    const completeCall = calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === "complete"
    );
    expect((completeCall![1] as Record<string, unknown>).outputImage).toBe("data:image/png;base64,ONLY=");
  });

  it("should error when no images are connected", async () => {
    const node = makeNode();
    const ctx = makeCtx(node, {
      getConnectedInputs: vi.fn().mockReturnValue({
        images: [],
        videos: [],
        audio: [],
        text: null,
        namedImages: {},
        dynamicInputs: {},
        easeCurve: null,
      }),
    });

    await expect(executeImageCollage(ctx)).rejects.toThrow("No input images connected");
    const calls = (ctx.updateNodeData as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === "error"
    );
    expect(errorCall).toBeDefined();
  });

  it("should surface collage build failures", async () => {
    mockBuildImageCollage.mockRejectedValueOnce(new Error("Failed to load image"));
    const node = makeNode();
    const ctx = makeCtx(node);

    await expect(executeImageCollage(ctx)).rejects.toThrow("Failed to load image");
    const calls = (ctx.updateNodeData as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === "error"
    );
    expect((errorCall![1] as Record<string, unknown>).error).toBe("Failed to load image");
  });
});
