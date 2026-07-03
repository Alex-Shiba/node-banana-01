import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to define mocks that work with hoisted vi.mock
const { mockGenerateVideos, mockGetVideosOperation, MockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateVideos = vi.fn();
  const mockGetVideosOperation = vi.fn();

  class MockGoogleGenAI {
    apiKey: string;
    models = {
      generateContent: vi.fn(),
      generateVideos: mockGenerateVideos,
    };
    operations = {
      getVideosOperation: mockGetVideosOperation,
    };

    constructor(config: { apiKey: string }) {
      this.apiKey = config.apiKey;
      MockGoogleGenAI.lastCalledWith = config;
    }

    static lastCalledWith: { apiKey: string } | null = null;
    static reset() {
      MockGoogleGenAI.lastCalledWith = null;
    }
  }

  return { mockGenerateVideos, mockGetVideosOperation, MockGoogleGenAI };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// Mock global fetch for video download
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { generateWithGeminiVideo } from "../gemini";

describe("generateWithGeminiVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockGoogleGenAI.reset();
  });

  it("should generate a text-to-video successfully", async () => {
    // Mock generateVideos to return a completed operation immediately
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          {
            video: {
              uri: "https://generativelanguage.googleapis.com/v1/video?id=123",
            },
          },
        ],
      },
    });

    // Mock video download
    const videoBytes = new Uint8Array([0x00, 0x00, 0x01, 0x00]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(videoBytes.buffer),
    });

    const result = await generateWithGeminiVideo(
      "test-001",
      "test-api-key",
      "veo-3.1/text-to-video",
      "A cat playing piano",
      [],
      { aspectRatio: "16:9", durationSeconds: "8" },
    );

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs![0].type).toBe("video");
    expect(result.outputs![0].data).toMatch(/^data:video\/mp4;base64,/);

    // Verify generateVideos was called with correct model
    expect(mockGenerateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "veo-3.1-generate-preview",
        prompt: "A cat playing piano",
        config: expect.objectContaining({
          numberOfVideos: 1,
          aspectRatio: "16:9",
          durationSeconds: 8,
        }),
      })
    );
  });

  it("should poll until operation is done", async () => {
    // Use fake timers to avoid real 10s waits
    vi.useFakeTimers();

    // First call: not done
    mockGenerateVideos.mockResolvedValue({ done: false });

    // Second call (poll): done
    mockGetVideosOperation.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          {
            video: {
              uri: "https://generativelanguage.googleapis.com/v1/video?id=456",
            },
          },
        ],
      },
    });

    // Mock video download
    const videoBytes = new Uint8Array([0x00, 0x01]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(videoBytes.buffer),
    });

    // Start generation (will hit the polling loop)
    const resultPromise = generateWithGeminiVideo(
      "test-002",
      "test-api-key",
      "veo-3.1-fast/text-to-video",
      "A sunset timelapse",
      [],
      {},
    );

    // Advance timer past the poll interval
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(mockGetVideosOperation).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("should handle image-to-video with base64 image input", async () => {
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          { video: { uri: "https://example.com/video?id=789" } },
        ],
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x01]).buffer),
    });

    const result = await generateWithGeminiVideo(
      "test-003",
      "test-api-key",
      "veo-3.1/image-to-video",
      "Animate this image",
      ["data:image/png;base64,iVBORw0KGgo="],
      {},
    );

    expect(result.success).toBe(true);

    // Verify image was passed in the request
    expect(mockGenerateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({
          imageBytes: "iVBORw0KGgo=",
          mimeType: "image/png",
        }),
      })
    );
  });

  it("should return error for unknown model", async () => {
    const result = await generateWithGeminiVideo(
      "test-004",
      "test-api-key",
      "unknown-model",
      "test prompt",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown Veo model");
  });

  it("should return error when no videos are generated", async () => {
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [],
      },
    });

    const result = await generateWithGeminiVideo(
      "test-005",
      "test-api-key",
      "veo-3.1/text-to-video",
      "test prompt",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No video generated");
  });

  it("should return error when video download fails", async () => {
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          { video: { uri: "https://example.com/video?id=fail" } },
        ],
      },
    });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
    });

    const result = await generateWithGeminiVideo(
      "test-006",
      "test-api-key",
      "veo-3.1/text-to-video",
      "test prompt",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to download generated video");
  });

  it("should map veo-3.1-fast models to correct API model ID", async () => {
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          { video: { uri: "https://example.com/video?id=fast" } },
        ],
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x01]).buffer),
    });

    await generateWithGeminiVideo(
      "test-007",
      "test-api-key",
      "veo-3.1-fast/image-to-video",
      "test",
      ["data:image/jpeg;base64,abc123"],
      {},
    );

    expect(mockGenerateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "veo-3.1-fast-generate-preview",
      })
    );
  });

  it("should pass seed and negativePrompt parameters", async () => {
    mockGenerateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [
          { video: { uri: "https://example.com/video?id=params" } },
        ],
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x01]).buffer),
    });

    await generateWithGeminiVideo(
      "test-008",
      "test-api-key",
      "veo-3.1/text-to-video",
      "test",
      [],
      { seed: 42, negativePrompt: "blurry, low quality", resolution: "1080p" },
    );

    expect(mockGenerateVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          seed: 42,
          negativePrompt: "blurry, low quality",
          resolution: "1080p",
        }),
      })
    );
  });
});

describe("generateWithGeminiVideo (Omni models via Interactions API)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockGoogleGenAI.reset();
  });

  it("should generate text-to-video via the interactions endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "v1_abc",
          status: "completed",
          model: "gemini-omni-flash-preview",
          output_video: { type: "video", mime_type: "video/mp4", data: "AAAB" },
        }),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-001",
      "test-api-key",
      "omni-flash/text-to-video",
      "A cat playing piano",
      [],
      { aspectRatio: "9:16" },
    );

    expect(result.success).toBe(true);
    expect(result.outputs![0].type).toBe("video");
    expect(result.outputs![0].data).toBe("data:video/mp4;base64,AAAB");

    // Veo SDK path must not be used
    expect(mockGenerateVideos).not.toHaveBeenCalled();

    // Verify the interactions endpoint and request body
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init.method).toBe("POST");
    expect(init.headers["x-goog-api-key"]).toBe("test-api-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gemini-omni-flash-preview");
    expect(body.input).toBe("A cat playing piano");
    expect(body.response_format).toEqual({ type: "video", aspect_ratio: "9:16" });
  });

  it("should send image + text parts for image-to-video", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "v1_def",
          status: "completed",
          output_video: { type: "video", mime_type: "video/mp4", data: "AAAB" },
        }),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-002",
      "test-api-key",
      "omni-flash/image-to-video",
      "Animate this image",
      ["data:image/jpeg;base64,iVBORw0KGgo="],
      {},
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toEqual([
      { type: "image", data: "iVBORw0KGgo=", mime_type: "image/jpeg" },
      { type: "text", text: "Animate this image" },
    ]);
  });

  it("should return error when image-to-video has no image", async () => {
    const result = await generateWithGeminiVideo(
      "test-omni-003",
      "test-api-key",
      "omni-flash/image-to-video",
      "Animate",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Image required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should extract video from steps content when output_video is absent", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "v1_ghi",
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                { type: "text", text: "Here is your video" },
                { type: "video", mime_type: "video/mp4", data: "BBBB" },
              ],
            },
          ],
        }),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-004",
      "test-api-key",
      "omni-flash/text-to-video",
      "test",
      [],
      {},
    );

    expect(result.success).toBe(true);
    expect(result.outputs![0].data).toBe("data:video/mp4;base64,BBBB");
  });

  it("should return error when response has no video", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ id: "v1_jkl", status: "completed", steps: [] }),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-005",
      "test-api-key",
      "omni-flash/text-to-video",
      "test",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No video generated");
  });

  it("should surface API error messages", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () =>
        Promise.resolve(JSON.stringify({ error: { message: "Quota exceeded" } })),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-006",
      "test-api-key",
      "omni-flash/text-to-video",
      "test",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Quota exceeded");
  });
});

describe("generateWithGeminiVideo (Omni reference-to-video and edit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockGoogleGenAI.reset();
  });

  it("should send all reference images plus task for reference-to-video", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "v1_ref",
          status: "completed",
          output_video: { type: "video", mime_type: "video/mp4", data: "CCCC" },
        }),
    });

    const result = await generateWithGeminiVideo(
      "test-omni-ref-001",
      "test-api-key",
      "omni-flash/reference-to-video",
      "A cat batting at a ball of yarn",
      ["data:image/png;base64,CAT=", "data:image/jpeg;base64,YARN="],
      { aspectRatio: "16:9" },
    );

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gemini-omni-flash-preview");
    expect(body.input).toEqual([
      { type: "image", data: "CAT=", mime_type: "image/png" },
      { type: "image", data: "YARN=", mime_type: "image/jpeg" },
      { type: "text", text: "A cat batting at a ball of yarn" },
    ]);
    expect(body.generation_config).toEqual({ video_config: { task: "reference_to_video" } });
  });

  it("should return error when reference-to-video has no images", async () => {
    const result = await generateWithGeminiVideo(
      "test-omni-ref-002",
      "test-api-key",
      "omni-flash/reference-to-video",
      "test",
      [],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("reference image");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should upload the source video and send a document part for video-edit", async () => {
    // fetch sequence: 1) upload start, 2) upload finalize, 3) interactions POST
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/upload/v1beta/files")) {
        return Promise.resolve({
          ok: true,
          headers: { get: (h: string) => (h.toLowerCase() === "x-goog-upload-url" ? "https://upload.example/session-1" : null) },
        });
      }
      if (url === "https://upload.example/session-1") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              file: { name: "files/vid123", uri: "https://generativelanguage.googleapis.com/v1beta/files/vid123", state: "ACTIVE" },
            }),
        });
      }
      if (url.includes("/interactions")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "v1_edit",
              status: "completed",
              output_video: { type: "video", mime_type: "video/mp4", data: "DDDD" },
            }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const result = await generateWithGeminiVideo(
      "test-omni-edit-001",
      "test-api-key",
      "omni-flash/video-edit",
      "Make the mirror ripple",
      [],
      {},
      { video_url: "data:video/mp4;base64,AAAA" },
    );

    expect(result.success).toBe(true);
    expect(result.outputs![0].data).toBe("data:video/mp4;base64,DDDD");

    // Verify the interactions request carried the uploaded document + prompt
    const interactionsCall = mockFetch.mock.calls.find(([url]) => String(url).includes("/interactions"));
    const body = JSON.parse(interactionsCall![1].body);
    expect(body.input).toEqual([
      { type: "document", uri: "https://generativelanguage.googleapis.com/v1beta/files/vid123" },
      { type: "text", text: "Make the mirror ripple" },
    ]);
    expect(body.generation_config).toEqual({ video_config: { task: "edit" } });
    // Edit must not force an aspect ratio
    expect(body.response_format).toEqual({ type: "video" });
  });

  it("should return error when video-edit has no connected video", async () => {
    const result = await generateWithGeminiVideo(
      "test-omni-edit-002",
      "test-api-key",
      "omni-flash/video-edit",
      "Make it rain",
      [],
      {},
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("source video");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
