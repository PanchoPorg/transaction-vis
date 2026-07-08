"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Copy, Database, Radio, SendHorizontal } from "lucide-react";
import { clsx } from "clsx";
import type { AddressFlowNode } from "./types";

function roleIcon(roles: string[]) {
  if (roles.includes("sender")) return <SendHorizontal size={16} />;
  if (roles.includes("receiver")) return <Radio size={16} />;
  return <Database size={16} />;
}

export function AddressNode({ data, selected }: NodeProps<AddressFlowNode>) {
  const primaryRole = data.roles[0] ?? "address";
  const [copied, setCopied] = useState(false);
  const resetCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copySequenceRef = useRef(0);

  useEffect(() => {
    return () => {
      if (resetCopiedTimeoutRef.current) clearTimeout(resetCopiedTimeoutRef.current);
    };
  }, []);

  const handleCopyAddress = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(data.address);
      }

      setCopied(true);
      copySequenceRef.current += 1;
      const copySequence = copySequenceRef.current;
      if (resetCopiedTimeoutRef.current) clearTimeout(resetCopiedTimeoutRef.current);
      resetCopiedTimeoutRef.current = setTimeout(() => {
        if (copySequenceRef.current === copySequence) setCopied(false);
      }, 1200);
    },
    [data.address],
  );

  return (
    <div
      className={clsx(
        "group relative h-[76px] w-[268px] rounded-lg border bg-[#202226]/95 px-4 py-3 text-left shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition",
        selected
          ? "border-[#d1883a] ring-2 ring-[#d1883a]/35"
          : "border-white/8 hover:border-white/18",
      )}
    >
      <Handle
        type="target"
        id="in-left"
        position={Position.Left}
        style={{ top: "36%" }}
        className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        id="out-right"
        position={Position.Right}
        style={{ top: "36%" }}
        className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        id="out-left"
        position={Position.Left}
        style={{ top: "64%" }}
        className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="target"
        id="in-right"
        position={Position.Right}
        style={{ top: "64%" }}
        className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            data.roles.includes("sender")
              ? "bg-[#516eff] text-white"
              : data.roles.includes("receiver")
                ? "bg-[#d1883a] text-[#191919]"
                : "bg-[#4b5f83] text-[#d8e0ef]",
          )}
        >
          {roleIcon(data.roles)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="nodrag nopan cursor-text select-text truncate text-[13px] font-semibold leading-5 text-[#f2f4f8]">
            {data.label}
          </div>
          <div className="flex items-center gap-1">
            <div className="nodrag nopan min-w-0 cursor-text select-text truncate font-mono text-[12px] leading-5 text-[#a8adb8]">
              {data.shortAddress}
            </div>
            <button
              aria-label={`Copy ${data.address}`}
              className={clsx(
                "nodrag nopan pointer-events-none ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#2a2e35]/95 text-[#c8d0dc] opacity-0 shadow-sm transition hover:border-white/20 hover:bg-[#343943] focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#6f85ff]/55 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                copied && "border-[#7bd9a2]/35 text-[#7bd9a2] opacity-100",
              )}
              type="button"
              onClick={handleCopyAddress}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[#757c89]">
        <span>{primaryRole}</span>
        <span className="h-1 w-1 rounded-full bg-[#555d68]" />
        <span>
          {data.incomingCount} in / {data.outgoingCount} out
        </span>
      </div>
    </div>
  );
}
