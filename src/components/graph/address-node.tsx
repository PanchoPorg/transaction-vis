"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, Copy, Database, Radio, SendHorizontal } from "lucide-react";
import { clsx } from "clsx";
import { DEFAULT_GRAPH_PORTS } from "./geometry";
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
        "group relative h-[76px] w-[268px] rounded-lg border bg-tx-card/95 px-4 py-3 text-left shadow-[0_18px_48px_rgba(3,2,8,0.34)] transition",
        selected
          ? "border-tx-accent-pale ring-2 ring-tx-accent/25"
          : "border-tx-border hover:border-tx-border-strong",
      )}
    >
      {(data.ports ?? DEFAULT_GRAPH_PORTS).map((port) => (
        <Handle
          key={port.id}
          type={port.type}
          id={port.id}
          position={port.side === "left" ? Position.Left : Position.Right}
          style={{ top: `${port.ratio * 100}%` }}
          className="!h-2.5 !w-2.5 !border-0 !bg-transparent !opacity-0"
        />
      ))}
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            data.roles.includes("sender")
              ? "bg-tx-accent text-white"
              : data.roles.includes("receiver")
                ? "bg-tx-erc20 text-tx-accent-contrast"
                : "bg-tx-raised text-tx-accent-pale",
          )}
        >
          {roleIcon(data.roles)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="nodrag nopan cursor-text select-text truncate text-[13px] font-semibold leading-5 text-tx-primary">
            {data.label}
          </div>
          <div className="flex items-center gap-1">
            <div className="nodrag nopan min-w-0 cursor-text select-text truncate font-mono text-[12px] leading-5 text-tx-secondary">
              {data.shortAddress}
            </div>
            <button
              aria-label={`Copy ${data.address}`}
              className={clsx(
                "nodrag nopan pointer-events-none ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-tx-border bg-tx-raised/95 text-tx-secondary opacity-0 shadow-sm transition hover:border-tx-border-strong hover:bg-tx-raised-hover focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-tx-accent/55 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                copied && "border-tx-success/35 text-tx-success opacity-100",
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
      <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-tx-faint">
        <span>{primaryRole}</span>
        <span className="h-1 w-1 rounded-full bg-tx-border-strong" />
        <span>
          {data.incomingCount} in / {data.outgoingCount} out
        </span>
      </div>
    </div>
  );
}
