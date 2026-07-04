"use client";

import React, { useCallback } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useWorkflowStore } from "@/store/workflowStore";
import { ImageCollageNodeData } from "@/types";
import { useAdaptiveImageSrc } from "@/hooks/useAdaptiveImageSrc";
import { getConnectedInputsPure } from "@/store/utils/connectedInputs";

type ImageCollageNodeType = Node<ImageCollageNodeData, "imageCollage">;

const COLUMN_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Auto" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];

export function ImageCollageNode({ id, data, selected }: NodeProps<ImageCollageNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);

  // Reactively read connected images from upstream nodes
  const connectedCount = useWorkflowStore((state) => {
    const { images } = getConnectedInputsPure(id, state.nodes, state.edges);
    return images.length;
  });

  const adaptiveOutputImage = useAdaptiveImageSrc(data.outputImage, id);

  const handleCombine = useCallback(() => {
    regenerateNode(id);
  }, [id, regenerateNode]);

  const handleColumnsChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const raw = e.target.value;
      updateNodeData(id, { columns: raw === "auto" ? null : parseInt(raw, 10) });
    },
    [id, updateNodeData]
  );

  const canCombine = connectedCount > 0 && data.status !== "loading";

  return (
    <BaseNode
      id={id}
      selected={selected}
      isExecuting={data.status === "loading"}
      hasError={data.status === "error"}
      fullBleed
      aspectFitMedia={data.outputImage}
    >
      {/* Image inputs (multiple connections) */}
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        data-handletype="image"
        style={{ zIndex: 10 }}
      />
      <div
        className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
        style={{
          right: `calc(100% + 8px)`,
          top: "calc(50% - 18px)",
          color: "var(--handle-color-image)",
          zIndex: 10,
        }}
      >
        Images
      </div>

      {/* Combined image output */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        data-handletype="image"
        style={{ zIndex: 10 }}
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
        {/* Preview */}
        {adaptiveOutputImage ? (
          <img src={adaptiveOutputImage} alt="Collage" className="w-full h-full object-contain bg-neutral-900/40" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-neutral-900/40">
            <svg className="w-8 h-8 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <span className="text-neutral-500 text-xs">
              {connectedCount > 0 ? "Run to combine" : "Connect images"}
            </span>
          </div>
        )}

        {/* Loading overlay */}
        {data.status === "loading" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Error overlay */}
        {data.error && data.status === "error" && (
          <div className="absolute inset-x-0 top-0 px-2 py-1 bg-red-900/80 text-[10px] text-red-200 truncate" title={data.error}>
            {data.error}
          </div>
        )}

        {/* Bottom controls */}
        <div className="nodrag nopan absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-6 pb-2 px-2 flex items-center gap-2">
          <span className="text-[10px] text-neutral-300 shrink-0">
            {connectedCount} img
          </span>
          <select
            value={data.columns === null ? "auto" : String(data.columns)}
            onChange={handleColumnsChange}
            className="nodrag nopan text-[11px] py-0.5 px-1.5 rounded bg-neutral-800/80 text-white focus:outline-none focus:ring-1 focus:ring-neutral-600"
            title="Columns"
          >
            {COLUMN_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value === null ? "auto" : String(opt.value)}>
                {opt.value === null ? "Auto" : `${opt.label} col`}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <button
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              canCombine && !isRunning
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "bg-neutral-800/60 text-neutral-500 cursor-not-allowed"
            }`}
            onClick={handleCombine}
            disabled={!canCombine || isRunning}
          >
            {data.status === "loading" ? "Combining..." : "Combine"}
          </button>
        </div>
      </div>
    </BaseNode>
  );
}
