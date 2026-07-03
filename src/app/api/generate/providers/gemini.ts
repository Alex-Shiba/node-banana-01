/**
 * Gemini Provider for Generate API Route
 *
 * Handles image generation and video generation using Google's Gemini API models.
 */

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { GenerateResponse, ModelType } from "@/types";
import { GenerationOutput } from "@/lib/providers/types";

/**
 * Map model types to Gemini model IDs
 */
export const MODEL_MAP: Record<ModelType, string> = {
  "nano-banana": "gemini-2.5-flash-image",
  "nano-banana-pro": "gemini-3-pro-image-preview",
  "nano-banana-2": "gemini-3.1-flash-image-preview",
};

/**
 * Convert a base64 data URL image to Gemini inlineData format
 */
function imageToInlineData(
  requestId: string,
  image: string,
  label: string
): { inlineData: { mimeType: string; data: string } } {
  if (image.includes("base64,")) {
    const [header, data] = image.split("base64,");
    const mimeMatch = header.match(/data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
    console.log(`[API:${requestId}]   Image ${label}: ${mimeType}, ${(data.length / 1024).toFixed(1)}KB`);
    return { inlineData: { mimeType, data } };
  }
  console.log(`[API:${requestId}]   Image ${label}: raw, ${(image.length / 1024).toFixed(1)}KB`);
  return { inlineData: { mimeType: "image/png", data: image } };
}

/**
 * Generate image using Gemini API (legacy/default path)
 */
export async function generateWithGemini(
  requestId: string,
  apiKey: string,
  prompt: string,
  images: string[],
  model: ModelType,
  aspectRatio?: string,
  resolution?: string,
  useGoogleSearch?: boolean,
  useImageSearch?: boolean,
  multimodalParts?: Array<{ type: string; value: string; name?: string }>
): Promise<NextResponse<GenerateResponse>> {
  console.log(`[API:${requestId}] Gemini generation - Model: ${model}, Images: ${images?.length || 0}, Prompt: ${prompt?.length || 0} chars, Parts: ${multimodalParts?.length || 0}`);

  // Initialize Gemini client
  const ai = new GoogleGenAI({ apiKey });

  // Build request parts array — use multimodal parts if provided, otherwise legacy prompt+images
  type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
  let requestParts: GeminiPart[];

  if (multimodalParts && multimodalParts.length > 0) {
    // Build interleaved multimodal request from image variable parts
    requestParts = multimodalParts.map((part) => {
      if (part.type === "image" && part.value) {
        return imageToInlineData(requestId, part.value, part.name || "var");
      }
      return { text: part.value };
    });
  } else {
    // Legacy: prompt text + all images appended
    const imageData = (images || []).map((image, idx) => imageToInlineData(requestId, image, `${idx + 1}`));
    requestParts = [
      { text: prompt },
      ...imageData,
    ];
  }

  // Build config object based on model capabilities
  const config: Record<string, unknown> = {
    responseModalities: ["IMAGE", "TEXT"],
  };

  // Add imageConfig for both models (both support aspect ratio)
  if (aspectRatio) {
    config.imageConfig = {
      aspectRatio,
    };
  }

  // Add resolution for Nano Banana Pro and Nano Banana 2
  if ((model === "nano-banana-pro" || model === "nano-banana-2") && resolution) {
    if (!config.imageConfig) {
      config.imageConfig = {};
    }
    (config.imageConfig as Record<string, unknown>).imageSize = resolution;
  }

  // Add tools array for Google Search (Nano Banana Pro and Nano Banana 2)
  const tools = [];
  if (model === "nano-banana-2" && (useGoogleSearch || useImageSearch)) {
    // Nano Banana 2 uses searchTypes to enable web and/or image search independently
    const searchTypes: Record<string, Record<string, never>> = {};
    if (useGoogleSearch) searchTypes.webSearch = {};
    if (useImageSearch) searchTypes.imageSearch = {};
    tools.push({ googleSearch: { searchTypes } });
  } else if (model === "nano-banana-pro" && useGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  console.log(`[API:${requestId}] Config: ${JSON.stringify(config)}`);

  // Make request to Gemini
  const geminiStartTime = Date.now();

  const response = await ai.models.generateContent({
    model: MODEL_MAP[model],
    contents: [
      {
        role: "user",
        parts: requestParts,
      },
    ],
    config,
    ...(tools.length > 0 && { tools }),
  });

  const geminiDuration = Date.now() - geminiStartTime;
  console.log(`[API:${requestId}] Gemini API completed in ${geminiDuration}ms`);

  // Extract image from response
  const candidates = response.candidates;

  if (!candidates || candidates.length === 0) {
    console.error(`[API:${requestId}] No candidates in Gemini response`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No response from AI model",
      },
      { status: 500 }
    );
  }

  const parts = candidates[0].content?.parts;
  console.log(`[API:${requestId}] Response parts: ${parts?.length || 0}`);

  if (!parts) {
    console.error(`[API:${requestId}] No parts in Gemini candidate content`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: "No content in response",
      },
      { status: 500 }
    );
  }

  // Find image part in response
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const imgData = part.inlineData.data;
      const imageSizeKB = (imgData.length / 1024).toFixed(1);

      console.log(`[API:${requestId}] Output image: ${mimeType}, ${imageSizeKB}KB`);

      const dataUrl = `data:${mimeType};base64,${imgData}`;

      const responsePayload = { success: true, image: dataUrl };
      const responseSize = JSON.stringify(responsePayload).length;
      const responseSizeMB = (responseSize / (1024 * 1024)).toFixed(2);

      if (responseSize > 4.5 * 1024 * 1024) {
        console.warn(`[API:${requestId}] Response size (${responseSizeMB}MB) approaching Next.js 5MB limit`);
      }

      console.log(`[API:${requestId}] SUCCESS - Returning ${responseSizeMB}MB payload`);

      return NextResponse.json<GenerateResponse>(responsePayload);
    }
  }

  // If no image found, check for text error
  for (const part of parts) {
    if (part.text) {
      console.error(`[API:${requestId}] Gemini returned text instead of image: ${part.text.substring(0, 100)}`);
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: `Model returned text instead of image: ${part.text.substring(0, 200)}`,
        },
        { status: 500 }
      );
    }
  }

  console.error(`[API:${requestId}] No image or text found in Gemini response`);
  return NextResponse.json<GenerateResponse>(
    {
      success: false,
      error: "No image in response",
    },
    { status: 500 }
  );
}

/**
 * Map internal Veo model IDs to Gemini API model IDs
 */
const VEO_MODEL_MAP: Record<string, string> = {
  "veo-3.1/text-to-video": "veo-3.1-generate-preview",
  "veo-3.1/image-to-video": "veo-3.1-generate-preview",
  "veo-3.1-fast/text-to-video": "veo-3.1-fast-generate-preview",
  "veo-3.1-fast/image-to-video": "veo-3.1-fast-generate-preview",
};

/**
 * Map internal Omni model IDs to Gemini API model IDs.
 * Omni models use the Interactions API rather than the Veo generateVideos operation.
 */
const OMNI_MODEL_MAP: Record<string, string> = {
  "omni-flash/text-to-video": "gemini-omni-flash-preview",
  "omni-flash/image-to-video": "gemini-omni-flash-preview",
  "omni-flash/reference-to-video": "gemini-omni-flash-preview",
  "omni-flash/video-edit": "gemini-omni-flash-preview",
};

/** Map internal Omni model IDs to the Interactions API video_config task */
const OMNI_TASK_MAP: Record<string, string> = {
  "omni-flash/text-to-video": "text_to_video",
  "omni-flash/image-to-video": "image_to_video",
  "omni-flash/reference-to-video": "reference_to_video",
  "omni-flash/video-edit": "edit",
};

/** Returns true for any Gemini-native video model (Veo or Omni) */
export function isGeminiVideoModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  // Prefix checks keep unknown veo-*/omni-* IDs on the video path so they
  // surface a clear "unknown model" error instead of hitting the image API
  return modelId.startsWith("veo-") || modelId.startsWith("omni-");
}

/**
 * Generate video using Gemini API (Veo models)
 */
export async function generateWithGeminiVideo(
  requestId: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[],
  parameters: Record<string, unknown> = {},
  dynamicInputs?: Record<string, string | string[]>,
  parts?: Array<{ type: string; value: string; name?: string }>,
): Promise<GenerationOutput> {
  // Omni models use the Interactions API instead of the Veo operations flow
  if (OMNI_MODEL_MAP[modelId]) {
    return generateWithGeminiOmniVideo(requestId, apiKey, modelId, prompt, images, parameters, dynamicInputs, parts);
  }

  const apiModelId = VEO_MODEL_MAP[modelId];
  if (!apiModelId) {
    return { success: false, error: `Unknown Veo model: ${modelId}` };
  }

  console.log(`[API:${requestId}] Gemini video generation - Model: ${apiModelId}, Prompt: ${prompt?.length || 0} chars, Images: ${images?.length || 0}`);

  const ai = new GoogleGenAI({ apiKey });

  // Build config from parameters
  const config: Record<string, unknown> = {
    numberOfVideos: 1,
  };

  if (parameters.aspectRatio) {
    config.aspectRatio = parameters.aspectRatio;
  }
  if (parameters.durationSeconds) {
    config.durationSeconds = Number(parameters.durationSeconds);
  }
  if (parameters.resolution) {
    config.resolution = parameters.resolution;
  }
  if (parameters.negativePrompt) {
    config.negativePrompt = parameters.negativePrompt;
  }
  if (parameters.seed !== undefined && parameters.seed !== null && parameters.seed !== "") {
    config.seed = Number(parameters.seed);
  }

  // Build request args
  const requestArgs: Record<string, unknown> = {
    model: apiModelId,
    prompt,
    config,
  };

  // Validate image-to-video models have an image
  if (modelId.includes("image-to-video") && (!images || images.length === 0)) {
    console.error(`[API:${requestId}] Image required for image-to-video model: ${modelId}`);
    return { success: false, error: "Image required for image-to-video model" };
  }

  // Add image for image-to-video models
  if (images && images.length > 0 && modelId.includes("image-to-video")) {
    const imageInput = images[0];
    if (imageInput.includes("base64,")) {
      const [header, data] = imageInput.split("base64,");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      requestArgs.image = {
        imageBytes: data,
        mimeType,
      };
    } else {
      requestArgs.image = {
        imageBytes: imageInput,
        mimeType: "image/png",
      };
    }
  }

  console.log(`[API:${requestId}] Veo config: ${JSON.stringify(config)}`);

  // Start video generation (async operation)
  const startTime = Date.now();

  let operation;
  try {
    operation = await ai.models.generateVideos(requestArgs as unknown as Parameters<typeof ai.models.generateVideos>[0]);

    // Poll for completion (10s intervals, 5min timeout)
    const POLL_INTERVAL = 10_000;
    const TIMEOUT = 5 * 60 * 1000;

    while (!operation.done) {
      const elapsed = Date.now() - startTime;
      if (elapsed > TIMEOUT) {
        console.error(`[API:${requestId}] Veo generation timed out after ${(elapsed / 1000).toFixed(0)}s`);
        return { success: false, error: "Video generation timed out after 5 minutes" };
      }

      console.log(`[API:${requestId}] Veo polling... (${(elapsed / 1000).toFixed(0)}s elapsed)`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      operation = await ai.operations.getVideosOperation({ operation });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[API:${requestId}] Veo generation failed: ${msg}`);
    return { success: false, error: `Video generation failed: ${msg}` };
  }

  const duration = Date.now() - startTime;
  console.log(`[API:${requestId}] Veo generation completed in ${(duration / 1000).toFixed(1)}s`);

  // Extract generated video
  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    console.error(`[API:${requestId}] No generated videos in Veo response`);
    return { success: false, error: "No video generated. The content may have been filtered by safety policies." };
  }

  const videoUri = generatedVideos[0]?.video?.uri;
  if (!videoUri) {
    console.error(`[API:${requestId}] No video URI in Veo response`);
    return { success: false, error: "No video URI in response" };
  }

  // Fetch the video (append API key for authentication)
  const videoUrl = `${videoUri}&key=${apiKey}`;
  console.log(`[API:${requestId}] Fetching video from URI...`);

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const videoResponse = await fetch(videoUrl, { signal: controller.signal });
    if (!videoResponse.ok) {
      console.error(`[API:${requestId}] Failed to fetch video: ${videoResponse.status}`);
      return { success: false, error: `Failed to download generated video: ${videoResponse.status}` };
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoSizeMB = (videoBuffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[API:${requestId}] Video downloaded: ${videoSizeMB}MB`);

    const base64Video = Buffer.from(videoBuffer).toString("base64");
    const dataUrl = `data:video/mp4;base64,${base64Video}`;

    console.log(`[API:${requestId}] SUCCESS - Returning ${videoSizeMB}MB video`);

    return {
      success: true,
      outputs: [{ type: "video", data: dataUrl }],
    };
  } catch (error) {
    console.error(`[API:${requestId}] Failed to download video: ${error}`);
    return { success: false, error: "Failed to download generated video" };
  } finally {
    clearTimeout(fetchTimeout);
  }
}

const INTERACTIONS_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** A video content part returned by the Interactions API */
interface OmniVideoContent {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
}

/**
 * Extract the video content part from an Interactions API response.
 * The video may live in `output_video` or inside `steps[].content[]`.
 */
function extractOmniVideo(interaction: Record<string, unknown>): OmniVideoContent | null {
  const outputVideo = interaction.output_video as OmniVideoContent | undefined;
  if (outputVideo && (outputVideo.data || outputVideo.uri)) {
    return outputVideo;
  }

  const steps = interaction.steps as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step.type !== "model_output") continue;
      const content = step.content as OmniVideoContent[] | undefined;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part.type === "video" && (part.data || part.uri)) {
          return part;
        }
      }
    }
  }

  return null;
}

/**
 * Download a video delivered as a Files API URI: poll until the file is
 * ACTIVE, then fetch its bytes via the :download endpoint.
 */
async function downloadOmniVideoFromUri(
  requestId: string,
  apiKey: string,
  uri: string,
): Promise<GenerationOutput> {
  const fileIdMatch = uri.match(/files\/([a-zA-Z0-9_-]+)/);
  if (!fileIdMatch) {
    console.error(`[API:${requestId}] Unrecognized Omni video URI format: ${uri}`);
    return { success: false, error: "Unrecognized video URI in Omni response" };
  }
  const fileName = `files/${fileIdMatch[1]}`;

  // Poll file state until ACTIVE (5s intervals, 60s budget)
  const POLL_INTERVAL = 5_000;
  const POLL_TIMEOUT = 60_000;
  const pollStart = Date.now();

  while (true) {
    const metaResponse = await fetch(`${INTERACTIONS_API_BASE}/${fileName}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!metaResponse.ok) {
      console.error(`[API:${requestId}] Omni file metadata fetch failed: ${metaResponse.status}`);
      return { success: false, error: `Failed to fetch generated video metadata: ${metaResponse.status}` };
    }
    const meta = await metaResponse.json();
    const state = typeof meta.state === "string" ? meta.state : meta.state?.name;
    if (state === "ACTIVE") break;
    if (state === "FAILED") {
      return { success: false, error: "Video file processing failed" };
    }
    if (Date.now() - pollStart > POLL_TIMEOUT) {
      return { success: false, error: "Timed out waiting for generated video file" };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  const downloadResponse = await fetch(`${INTERACTIONS_API_BASE}/${fileName}:download?alt=media`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!downloadResponse.ok) {
    console.error(`[API:${requestId}] Omni video download failed: ${downloadResponse.status}`);
    return { success: false, error: `Failed to download generated video: ${downloadResponse.status}` };
  }

  const videoBuffer = await downloadResponse.arrayBuffer();
  const videoSizeMB = (videoBuffer.byteLength / (1024 * 1024)).toFixed(2);
  console.log(`[API:${requestId}] Omni video downloaded: ${videoSizeMB}MB`);

  const base64Video = Buffer.from(videoBuffer).toString("base64");
  return {
    success: true,
    outputs: [{ type: "video", data: `data:video/mp4;base64,${base64Video}` }],
  };
}

/** Convert a base64 data URL (or raw base64) image to an Interactions API image part */
function toOmniImagePart(image: string): { type: "image"; data: string; mime_type: string } {
  let data = image;
  let mimeType = "image/png";
  if (image.includes("base64,")) {
    const [header, base64Data] = image.split("base64,");
    const mimeMatch = header.match(/data:([^;]+)/);
    if (mimeMatch) mimeType = mimeMatch[1];
    data = base64Data;
  }
  return { type: "image", data, mime_type: mimeType };
}

/**
 * Upload a video to the Gemini Files API (resumable upload) and wait for it
 * to become ACTIVE. Accepts a base64 data URL or an http(s) URL.
 * Returns the file URI for use as a `document` part in the Interactions API.
 */
async function uploadOmniSourceVideo(
  requestId: string,
  apiKey: string,
  video: string,
): Promise<{ uri: string } | { error: string }> {
  // Resolve the video to raw bytes + mime type
  let videoBuffer: Buffer;
  let mimeType = "video/mp4";

  if (video.startsWith("data:")) {
    const [header, base64Data] = video.split("base64,");
    if (!base64Data) return { error: "Unsupported video data format" };
    const mimeMatch = header.match(/data:([^;]+)/);
    if (mimeMatch) mimeType = mimeMatch[1];
    videoBuffer = Buffer.from(base64Data, "base64");
  } else if (video.startsWith("http")) {
    const fetchResponse = await fetch(video);
    if (!fetchResponse.ok) {
      return { error: `Failed to fetch source video: ${fetchResponse.status}` };
    }
    mimeType = fetchResponse.headers.get("content-type") || "video/mp4";
    videoBuffer = Buffer.from(await fetchResponse.arrayBuffer());
  } else {
    return { error: "Unsupported video input format (expected data URL or http URL)" };
  }

  const sizeMB = (videoBuffer.byteLength / (1024 * 1024)).toFixed(2);
  console.log(`[API:${requestId}] Uploading ${sizeMB}MB source video to Files API...`);

  // Step 1: start resumable upload
  const startResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(videoBuffer.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `omni-edit-source-${requestId}` } }),
  });
  if (!startResponse.ok) {
    return { error: `Failed to start video upload: ${startResponse.status}` };
  }
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    return { error: "Files API did not return an upload URL" };
  }

  // Step 2: upload bytes and finalize
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(videoBuffer.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(videoBuffer),
  });
  if (!uploadResponse.ok) {
    return { error: `Failed to upload video: ${uploadResponse.status}` };
  }
  const uploadResult = await uploadResponse.json();
  const file = uploadResult.file;
  if (!file?.uri || !file?.name) {
    return { error: "Files API upload returned no file URI" };
  }

  // Step 3: wait until the file is processed
  const POLL_INTERVAL = 5_000;
  const POLL_TIMEOUT = 90_000;
  const pollStart = Date.now();
  let state = typeof file.state === "string" ? file.state : file.state?.name;

  while (state === "PROCESSING") {
    if (Date.now() - pollStart > POLL_TIMEOUT) {
      return { error: "Timed out waiting for uploaded video to be processed" };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    const metaResponse = await fetch(`${INTERACTIONS_API_BASE}/${file.name}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!metaResponse.ok) {
      return { error: `Failed to check uploaded video status: ${metaResponse.status}` };
    }
    const meta = await metaResponse.json();
    state = typeof meta.state === "string" ? meta.state : meta.state?.name;
  }

  if (state === "FAILED") {
    return { error: "Uploaded video failed processing" };
  }

  console.log(`[API:${requestId}] Source video uploaded: ${file.uri}`);
  return { uri: file.uri };
}

/**
 * Generate video using the Gemini Interactions API (Omni models).
 * Unlike Veo, this is a synchronous unary request — the response contains
 * the video inline (base64) or as a Files API URI.
 * Supports four tasks: text_to_video, image_to_video, reference_to_video
 * (multiple reference images), and edit (regenerate a connected video).
 */
async function generateWithGeminiOmniVideo(
  requestId: string,
  apiKey: string,
  modelId: string,
  prompt: string,
  images: string[],
  parameters: Record<string, unknown> = {},
  dynamicInputs?: Record<string, string | string[]>,
  parts?: Array<{ type: string; value: string; name?: string }>,
): Promise<GenerationOutput> {
  const apiModelId = OMNI_MODEL_MAP[modelId];
  const task = OMNI_TASK_MAP[modelId];

  console.log(`[API:${requestId}] Gemini Omni video generation - Model: ${apiModelId}, Task: ${task}, Prompt: ${prompt?.length || 0} chars, Images: ${images?.length || 0}, Parts: ${parts?.length || 0}`);

  // Multimodal parts from prompt-constructor image variables: the image sits
  // at the exact position it was referenced in the text, which is precisely
  // the Interactions API input format
  const usableParts = (parts || []).filter((p) => p.value);
  const partImages = usableParts.filter((p) => p.type === "image");

  // Build the input parts per task
  let input: unknown = prompt;

  if (task !== "edit" && partImages.length > 0) {
    // Images wired directly to the node that aren't already referenced as
    // variables go first, then the authored interleaved sequence
    const directExtra = (images || []).filter(
      (img) => !partImages.some((p) => p.value === img)
    );
    input = [
      ...directExtra.map(toOmniImagePart),
      ...usableParts.map((p) =>
        p.type === "image" ? toOmniImagePart(p.value) : { type: "text", text: p.value }
      ),
    ];
  } else if (task === "image_to_video") {
    if (!images || images.length === 0) {
      console.error(`[API:${requestId}] Image required for image-to-video model: ${modelId}`);
      return { success: false, error: "Image required for image-to-video model" };
    }
    input = [toOmniImagePart(images[0]), { type: "text", text: prompt }];
  } else if (task === "reference_to_video") {
    if (!images || images.length === 0) {
      console.error(`[API:${requestId}] Reference images required for model: ${modelId}`);
      return { success: false, error: "Connect at least one reference image or use image variables in the prompt" };
    }
    input = [...images.map(toOmniImagePart), { type: "text", text: prompt }];
  } else if (task === "edit") {
    const rawVideo = dynamicInputs?.video_url;
    const sourceVideo = Array.isArray(rawVideo) ? rawVideo[0] : rawVideo;
    if (!sourceVideo) {
      console.error(`[API:${requestId}] Source video required for edit model: ${modelId}`);
      return { success: false, error: "Connect a source video to edit" };
    }
    const uploaded = await uploadOmniSourceVideo(requestId, apiKey, sourceVideo);
    if ("error" in uploaded) {
      console.error(`[API:${requestId}] ${uploaded.error}`);
      return { success: false, error: uploaded.error };
    }
    input = [
      { type: "document", uri: uploaded.uri },
      { type: "text", text: prompt },
    ];
  }

  const responseFormat: Record<string, unknown> = { type: "video" };
  // Edit output follows the source video geometry — no aspect ratio override
  if (parameters.aspectRatio && task !== "edit") {
    responseFormat.aspect_ratio = parameters.aspectRatio;
  }

  const requestBody = {
    model: apiModelId,
    input,
    response_format: responseFormat,
    generation_config: {
      video_config: { task },
    },
  };

  // Synchronous unary call — budget most of the route's 5min for the POST,
  // leaving room for a potential Files API download afterwards
  const startTime = Date.now();
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => controller.abort(), 4 * 60 * 1000);

  let interaction: Record<string, unknown>;
  try {
    const response = await fetch(`${INTERACTIONS_API_BASE}/interactions`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Omni generation failed: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
      }
      console.error(`[API:${requestId}] ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    interaction = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[API:${requestId}] Omni generation timed out`);
      return { success: false, error: "Video generation timed out after 4 minutes" };
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[API:${requestId}] Omni generation failed: ${msg}`);
    return { success: false, error: `Video generation failed: ${msg}` };
  } finally {
    clearTimeout(requestTimeout);
  }

  const duration = Date.now() - startTime;
  console.log(`[API:${requestId}] Omni generation completed in ${(duration / 1000).toFixed(1)}s (status: ${interaction.status})`);

  const video = extractOmniVideo(interaction);
  if (!video) {
    const status = typeof interaction.status === "string" ? interaction.status : "unknown";
    console.error(`[API:${requestId}] No video in Omni response (status: ${status})`);
    return {
      success: false,
      error: status === "completed"
        ? "No video generated. The content may have been filtered by safety policies."
        : `No video generated (interaction status: ${status})`,
    };
  }

  if (video.data) {
    const mimeType = video.mime_type || "video/mp4";
    const videoSizeMB = ((video.data.length * 0.75) / (1024 * 1024)).toFixed(2);
    console.log(`[API:${requestId}] SUCCESS - Returning ${videoSizeMB}MB inline video`);
    return {
      success: true,
      outputs: [{ type: "video", data: `data:${mimeType};base64,${video.data}` }],
    };
  }

  return downloadOmniVideoFromUri(requestId, apiKey, video.uri!);
}
