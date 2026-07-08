import { NextResponse } from "next/server";
import { enrichTraceWithAddressLabels } from "@/lib/address-labels";
import { TraceError } from "@/lib/tx/etherscan";
import { buildTrace } from "@/lib/tx/trace";
import type { TraceApiError } from "@/lib/tx/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const txHash = url.searchParams.get("txHash");

  if (!txHash) {
    return NextResponse.json<TraceApiError>(
      { code: "missing-tx-hash", error: "Missing txHash query parameter." },
      { status: 400 },
    );
  }

  try {
    const trace = enrichTraceWithAddressLabels(await buildTrace(txHash));
    return NextResponse.json(trace);
  } catch (error) {
    if (error instanceof TraceError) {
      return NextResponse.json<TraceApiError>(
        { code: error.code, error: error.message, warnings: error.warnings },
        { status: error.status },
      );
    }

    console.error("Unexpected trace failure", error);
    return NextResponse.json<TraceApiError>(
      { code: "unexpected-error", error: "Unexpected trace failure." },
      { status: 500 },
    );
  }
}
