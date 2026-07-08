"use client";

import { AlertTriangle, ArrowRight, Copy, ExternalLink } from "lucide-react";
import { shortAddress } from "@/lib/tx/format";
import { ETHEREUM_MAINNET } from "@/lib/tx/chains";
import type { TransferRecord, TxTraceResponse } from "@/lib/tx/types";
import type { GraphSelection } from "./graph/types";

function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value);
  }
}

function TransferRow({ transfer }: { transfer: TransferRecord }) {
  return (
    <div className="rounded-lg border border-white/8 bg-[#171a1f] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="rounded-md bg-white/6 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9fa7b4]">
          {transfer.kind}
        </span>
        <span className="font-mono text-[12px] font-semibold text-[#f3f5f8]">
          {transfer.valueFormatted} {transfer.symbol}
        </span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[11px] text-[#a8adb8]">
        <span>{shortAddress(transfer.from, 4)}</span>
        <ArrowRight size={13} className="text-[#67707e]" />
        <span>{shortAddress(transfer.to, 4)}</span>
      </div>
      {transfer.tokenAddress ? (
        <div className="mt-2 truncate font-mono text-[10px] text-[#69717f]">
          token {shortAddress(transfer.tokenAddress, 5)}
        </div>
      ) : null}
    </div>
  );
}

type InspectorProps = {
  trace: TxTraceResponse;
  selection: GraphSelection;
  mode: "demo" | "live";
};

export function Inspector({ trace, selection, mode }: InspectorProps) {
  const nodeTransfers =
    selection?.type === "node"
      ? trace.transfers.filter(
          (transfer) =>
            transfer.from.toLowerCase() === selection.node.id ||
            transfer.to.toLowerCase() === selection.node.id,
        )
      : [];

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-white/8 bg-[#1b1e23]">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#747d8b]">
              Selection
            </div>
            <h2 className="mt-1 text-[15px] font-semibold text-[#f2f4f8]">
              {selection?.type === "node"
                ? selection.node.label
                : selection?.type === "edge"
                  ? "Aggregated edge"
                  : "Transaction"}
            </h2>
          </div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-[#a9b1bd]">
            {mode === "demo" ? "Preview" : "Live"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {selection?.type === "node" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-white/8 bg-[#15171b] p-4">
              <div className="mb-3 font-mono text-[12px] leading-5 text-[#d9dde4]">
                {selection.node.address}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-white/5 px-2 py-2">
                  <div className="text-[15px] font-semibold text-white">
                    {selection.node.incomingCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">in</div>
                </div>
                <div className="rounded-md bg-white/5 px-2 py-2">
                  <div className="text-[15px] font-semibold text-white">
                    {selection.node.outgoingCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">out</div>
                </div>
                <div className="rounded-md bg-white/5 px-2 py-2">
                  <div className="text-[15px] font-semibold text-white">
                    {selection.node.transferCount}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">total</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[12px] text-[#c3cad5] hover:bg-white/5"
                  type="button"
                  onClick={() => copyText(selection.node.address)}
                >
                  <Copy size={13} /> Copy
                </button>
                <a
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[12px] text-[#c3cad5] hover:bg-white/5"
                  href={ETHEREUM_MAINNET.explorerAddressUrl(selection.node.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Etherscan
                </a>
              </div>
            </div>
            <div className="space-y-2">
              {nodeTransfers.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} />
              ))}
            </div>
          </div>
        ) : selection?.type === "edge" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-white/8 bg-[#15171b] p-4">
              <div className="mb-3 font-mono text-[13px] font-semibold text-white">
                {selection.edge.label}
              </div>
              <div className="space-y-2">
                {selection.edge.assets.map((asset) => (
                  <div
                    key={asset.assetKey}
                    className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2"
                  >
                    <span className="text-[12px] text-[#aeb6c2]">{asset.symbol}</span>
                    <span className="font-mono text-[12px] text-white">
                      {asset.valueFormatted}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {selection.transfers.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-white/8 bg-[#15171b] p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#737c8a]">
                Hash
              </div>
              <div className="break-all font-mono text-[12px] leading-5 text-[#d9dde4]">
                {trace.tx.hash}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[12px] text-[#c3cad5] hover:bg-white/5"
                  type="button"
                  onClick={() => copyText(trace.tx.hash)}
                >
                  <Copy size={13} /> Copy
                </button>
                <a
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[12px] text-[#c3cad5] hover:bg-white/5"
                  href={ETHEREUM_MAINNET.explorerTxUrl(trace.tx.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Etherscan
                </a>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-white/8 bg-[#15171b] p-3">
                <div className="text-[18px] font-semibold text-white">{trace.nodes.length}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">nodes</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-[#15171b] p-3">
                <div className="text-[18px] font-semibold text-white">{trace.edges.length}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">edges</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-[#15171b] p-3">
                <div className="text-[18px] font-semibold text-white">{trace.transfers.length}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-[#737c8a]">moves</div>
              </div>
            </div>
          </div>
        )}

        {trace.warnings.length > 0 ? (
          <div className="mt-4 rounded-lg border border-[#d1883a]/30 bg-[#2a2118] p-3 text-[12px] leading-5 text-[#e3b273]">
            <div className="mb-1 flex items-center gap-2 font-semibold text-[#f2c58d]">
              <AlertTriangle size={14} /> Warnings
            </div>
            {trace.warnings.slice(0, 4).map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
