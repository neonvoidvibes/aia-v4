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

  return NextResponse.json(
    { banner, message, buildId },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

