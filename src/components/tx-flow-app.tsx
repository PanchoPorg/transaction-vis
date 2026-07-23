"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Loader2, Network, Search } from "lucide-react";
import { GraphCanvas } from "./graph/graph-canvas";
import { Inspector } from "./inspector";
import { sampleTrace } from "@/lib/tx/sample";
import type { TraceApiError, TxTraceResponse } from "@/lib/tx/types";
import type { GraphSelection } from "./graph/types";

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "success" };

export function TxFlowApp() {
  const [txHash, setTxHash] = useState("");
  const [trace, setTrace] = useState<TxTraceResponse>(sampleTrace);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [selection, setSelection] = useState<GraphSelection>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedHash = txHash.trim();

    if (!TX_HASH_PATTERN.test(normalizedHash)) {
      setLoadState({
        status: "error",
        code: "invalid-tx-hash",
        message: "Enter a valid 32-byte transaction hash.",
      });
      return;
    }

    setLoadState({ status: "loading" });
    setSelection(null);

    try {
      const response = await fetch(`/api/trace?txHash=${encodeURIComponent(normalizedHash)}`);
      const body = (await response.json()) as TxTraceResponse | TraceApiError;

      if (!response.ok) {
        const errorBody = body as TraceApiError;
        throw new Error(`${errorBody.code}: ${errorBody.error}`);
      }

      setTrace(body as TxTraceResponse);
      setMode("live");
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({
        status: "error",
        code: "trace-error",
        message: error instanceof Error ? error.message : "Trace request failed.",
      });
    }
  }

  return (
    <main className="flex h-dvh min-h-[720px] min-w-[1180px] flex-col bg-tx-canvas text-tx-primary">
      <header className="z-10 flex min-h-[72px] items-center gap-3 border-b border-tx-border bg-tx-shell/96 px-5 py-0 shadow-[0_18px_52px_rgba(3,2,8,0.3)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-tx-accent-hover to-tx-accent text-white shadow-[0_0_24px_rgba(125,95,188,0.24)]">
            <Network size={18} />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold leading-5 tracking-normal text-tx-primary">
              TxFlow
            </h1>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-tx-faint">
              Ethereum transfer graph
            </div>
          </div>
        </div>

        <form className="ml-auto flex min-w-0 flex-1 items-center gap-3" onSubmit={handleSubmit}>
          <div className="flex h-9 items-center rounded-md border border-tx-border bg-tx-raised px-3 text-[12px] font-semibold text-tx-secondary">
            Ethereum
          </div>
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tx-faint"
            />
            <input
              value={txHash}
              onChange={(event) => setTxHash(event.target.value)}
              placeholder="0x transaction hash"
              spellCheck={false}
              className="h-10 w-full rounded-md border border-tx-border bg-tx-input pl-9 pr-3 font-mono text-[13px] text-tx-primary outline-none transition placeholder:text-tx-faint focus:border-tx-accent focus:ring-2 focus:ring-tx-accent/25"
            />
          </div>
          <button
            disabled={loadState.status === "loading"}
            className="inline-flex h-10 min-w-[92px] items-center justify-center gap-2 rounded-md bg-tx-accent px-4 text-[13px] font-semibold text-white shadow-[0_6px_18px_rgba(125,95,188,0.15)] transition hover:bg-tx-accent-hover disabled:cursor-not-allowed disabled:bg-tx-raised disabled:text-tx-faint disabled:shadow-none"
            type="submit"
          >
            {loadState.status === "loading" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} />
            )}
            Trace
          </button>
        </form>

        <div className="flex min-w-[128px] items-center justify-end gap-2 text-[12px] text-tx-muted">
          <span
            className={`h-2 w-2 rounded-full ${
              loadState.status === "error"
                ? "bg-tx-danger"
                : loadState.status === "loading"
                  ? "bg-tx-accent-pale"
                  : "bg-tx-success"
            }`}
          />
          {loadState.status === "loading"
            ? "Fetching"
            : loadState.status === "error"
              ? "Needs attention"
              : mode === "live"
                ? "Live trace"
                : "Preview"}
        </div>
      </header>

      {loadState.status === "error" ? (
        <div className="flex items-center gap-2 border-b border-tx-danger/25 bg-tx-danger-bg px-5 py-2 text-[12px] text-tx-danger-soft">
          <AlertTriangle size={14} />
          <span className="truncate">{loadState.message}</span>
        </div>
      ) : null}

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative min-h-0">
          <GraphCanvas trace={trace} onSelectionChange={setSelection} />
          <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-tx-border bg-tx-raised/90 px-3 py-2 text-[11px] font-medium text-tx-secondary shadow-[0_14px_36px_rgba(3,2,8,0.28)] backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-tx-native" /> Native
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-tx-internal" /> Internal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-tx-erc20" /> ERC20
            </span>
          </div>
        </div>
        <div className="min-h-0">
          <Inspector trace={trace} selection={selection} mode={mode} />
        </div>
      </section>
    </main>
  );
}
