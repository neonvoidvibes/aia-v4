import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const banner = String(process.env.NEXT_PUBLIC_SERVICE_BANNER || "").toLowerCase() === "true";
  const message = process.env.NEXT_PUBLIC_SERVICE_BANNER_MESSAGE || null;
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.BUILD_ID ||
    process.env.NEXT_PUBLIC_APP_BUILD_ID ||
    "dev";

  // Optional runtime-controlled poll interval (ms). Defaults to 10 minutes.
  const rawPoll = Number(process.env.RUNTIME_POLL_MS || process.env.NEXT_PUBLIC_RUNTIME_POLL_MS || 600000);
  const pollMs = Number.isFinite(rawPoll) ? Math.min(3600000, Math.max(15000, rawPoll)) : 600000;

  return NextResponse.json(
    { banner, message, buildId, pollMs },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
