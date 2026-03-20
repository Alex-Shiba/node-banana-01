"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useWorkflowStore } from "@/store/workflowStore";
import { InpaintNodeData, InpaintProvider } from "@/types";
import { InpaintMaskModal } from "@/components/InpaintMaskModal";
import { useAdaptiveImageSrc } from "@/hooks/useAdaptiveImageSrc";
import { getConnectedInputsPure } from "@/store/utils/connectedInputs";

type InpaintNodeType = Node<InpaintNodeData, "inpaint">;

const PROVIDER_OPTIONS: { value: InpaintProvider; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "wavespeed", label: "WaveSpeed" },
];

export function InpaintNode({ id, data, selected }: NodeProps<InpaintNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const [maskModalOpen, setMaskModalOpen] = useState(false);

  // Reactively read connected image from upstream nodes
  const connectedImage = useWorkflowStore((state) => {
    const { images } = getConnectedInputsPure(id, state.nodes, state.edges);
    return images[0] ?? null;
  });

  const connectedText = useWorkflowStore((state) => {
    const { text } = getConnectedInputsPure(id, state.nodes, state.edges);
    return text;
  });

  // Sync connected inputs into node data so executor and mask modal can use them
  useEffect(() => {
    if (connectedImage && connectedImage !== data.inputImage) {
      updateNodeData(id, { inputImage: connectedImage });
    }
  }, [connectedImage, data.inputImage, id, updateNodeData]);

  useEffect(() => {
    if (connectedText !== undefined && connectedText !== data.inputPrompt) {
      updateNodeData(id, { inputPrompt: connectedText });
    }
  }, [connectedText, data.inputPrompt, id, updateNodeData]);

  const adaptiveOutputImage = useAdaptiveImageSrc(data.outputImage, id);
  const adaptiveInputImage = useAdaptiveImageSrc(connectedImage || data.inputImage, id);

  const handleGenerate = useCallback(() => {
    regenerateNode(id);
  }, [id, regenerateNode]);

  const handleMaskSave = useCallback(
    (maskDataUrl: string, brushSize: number) => {
      updateNodeData(id, { maskImage: maskDataUrl, maskBrushSize: brushSize });
      setMaskModalOpen(false);
    },
    [id, updateNodeData]
  );

  const handleProviderChange = useCallback(
    (provider: InpaintProvider) => {
      updateNodeData(id, { inpaintProvider: provider });
    },
    [id, updateNodeData]
  );

  const displayImage = adaptiveOutputImage || adaptiveInputImage;
  const hasMask = !!data.maskImage;
  const hasInput = !!(connectedImage || data.inputImage);
  const hasPrompt = !!(connectedText || data.inputPrompt);
  // Image + mask required; prompt is optional (will use default if not connected)
  const canGenerate = hasInput && hasMask;
  const isRunning = data.status === "loading";

  return (
    <>
      <BaseNode
        id={id}
        selected={selected}
        isExecuting={isRunning}
        hasError={data.status === "error"}
        fullBleed
        aspectFitMedia={data.outputImage}
      >
        {/* Input handles */}
        <Handle
          type="target"
          position={Position.Left}
          id="image"
          style={{ top: "35%", zIndex: 10 }}
          data-handletype="image"
          isConnectable={true}
        />
        <div
          className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
          style={{
            right: `calc(100% + 8px)`,
            top: "calc(35% - 18px)",
            color: "var(--handle-color-image)",
            zIndex: 10,
          }}
        >
          Image
        </div>
        <Handle
          type="target"
          position={Position.Left}
          id="text"
          style={{ top: "65%", zIndex: 10 }}
          data-handletype="text"
          isConnectable={true}
        />
        <div
          className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
          style={{
            right: `calc(100% + 8px)`,
            top: "calc(65% - 18px)",
            color: "var(--handle-color-text)",
            zIndex: 10,
          }}
        >
          Prompt
        </div>

        {/* Output handle */}
        <Handle
          type="source"
          position={Position.Right}
          id="image"
          style={{ top: "50%", zIndex: 10 }}
          data-handletype="image"
        />
        <div
          className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none"
          style={{
            left: `calc(100% + 8px)`,
            top: "calc(50% - 18px)",
            color: "var(--handle-color-image)",
            zIndex: 10,
          }}
        >
          Image
        </div>

        <div className="relative w-full h-full min-h-0 overflow-hidden rounded-lg">
          {/* Image preview */}
          {displayImage ? (
            <img src={displayImage} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-neutral-900/40">
              <span className="text-neutral-500 text-xs">Connect image</span>
            </div>
          )}

          {/* Mask overlay indicator */}
          {hasMask && hasInput && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] text-white backdrop-blur-sm">
              Masked
            </div>
          )}

          {/* Loading overlay */}
          {isRunning && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {/* Error overlay */}
          {data.error && !isRunning && (
            <div className="absolute inset-x-0 top-0 px-2 py-1 bg-red-900/80 text-[10px] text-red-200 truncate" title={data.error}>
              {data.error}
            </div>
          )}

          {/* Bottom controls overlay */}
          <div className="nodrag nopan absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2 px-2 space-y-1.5">
            {/* Provider selection */}
            <div className="flex gap-1">
              {PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`flex-1 px-2 py-1 rounded text-[11px] transition-colors ${
                    data.inpaintProvider === opt.value
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700/80"
                  }`}
                  onClick={() => handleProviderChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-1">
              <button
                className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                  hasInput
                    ? hasMask
                      ? "bg-neutral-700/80 text-white hover:bg-neutral-600/80"
                      : "bg-orange-600 text-white hover:bg-orange-500"
                    : "bg-neutral-800/60 text-neutral-500 cursor-not-allowed"
                }`}
                onClick={() => hasInput && setMaskModalOpen(true)}
                disabled={!hasInput}
              >
                {hasMask ? "Edit Mask" : "Draw Mask"}
              </button>
              <button
                className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                  canGenerate && !isRunning
                    ? "bg-green-600 text-white hover:bg-green-500"
                    : "bg-neutral-800/60 text-neutral-500 cursor-not-allowed"
                }`}
                onClick={handleGenerate}
                disabled={!canGenerate || isRunning}
              >
                {isRunning ? "Generating..." : "Inpaint"}
              </button>
            </div>

            {/* Status hint */}
            {!hasInput && !data.error && !isRunning && (
              <div className="text-[10px] text-neutral-400 text-center">
                Connect an image to get started
              </div>
            )}
          </div>
        </div>
      </BaseNode>

      {/* Mask drawing modal - rendered via portal in InpaintMaskModal */}
      {maskModalOpen && (connectedImage || data.inputImage) && (
        <InpaintMaskModal
          isOpen={maskModalOpen}
          sourceImage={(connectedImage || data.inputImage)!}
          existingMask={data.maskImage}
          brushSize={data.maskBrushSize}
          onClose={() => setMaskModalOpen(false)}
          onSave={handleMaskSave}
        />
      )}
    </>
  );
}
