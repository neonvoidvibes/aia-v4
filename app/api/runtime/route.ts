import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';
  // Prefer a runtime-only flag for hosted environments; fall back to NEXT_PUBLIC_*
  const rawBanner = (process.env.RUNTIME_SERVICE_BANNER ?? process.env.NEXT_PUBLIC_SERVICE_BANNER ?? "").toString().trim().toLowerCase();
  const banner = rawBanner === "true" || rawBanner === "1" || rawBanner === "on";
  const message = process.env.RUNTIME_SERVICE_BANNER_MESSAGE ?? process.env.NEXT_PUBLIC_SERVICE_BANNER_MESSAGE ?? null;
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    process.env.BUILD_ID ||
    process.env.NEXT_PUBLIC_APP_BUILD_ID ||
    "dev";

  // Optional runtime-controlled poll interval (ms). Defaults to 10 minutes.
  const rawPoll = Number(process.env.RUNTIME_POLL_MS || process.env.NEXT_PUBLIC_RUNTIME_POLL_MS || 600000);
  const pollMs = Number.isFinite(rawPoll) ? Math.min(3600000, Math.max(15000, rawPoll)) : 600000;

  const payload: any = { banner, message, buildId, pollMs };
  if (debug) {
    payload._debug = {
      source: process.env.RUNTIME_SERVICE_BANNER != null ? 'RUNTIME_SERVICE_BANNER' : 'NEXT_PUBLIC_SERVICE_BANNER',
      rawBanner,
    };
  }
  return NextResponse.json(
    payload,
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
