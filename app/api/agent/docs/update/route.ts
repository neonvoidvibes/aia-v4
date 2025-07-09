import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseUser, getBackendUrl, formatErrorResponse } from "@/app/api/proxyUtils";

export async function POST(request: NextRequest) {
  const userSession = await getSupabaseUser(request);
  if (!userSession) {
    return formatErrorResponse("Unauthorized: User not authenticated.", 401);
  }

  const backendUrl = await getBackendUrl();
  if (!backendUrl) {
    return formatErrorResponse("Service unavailable: No active backend found.", 503);
  }

  try {
    const requestBody = await request.json();
    const targetUrl = `${backendUrl}${request.nextUrl.pathname}`;

    const backendResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userSession.token}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(data, { status: backendResponse.status });
    }

    return NextResponse.json(data, { status: 200 });

  } catch (error) {
    console.error("[API Docs Update Proxy] Error:", error);
    let errorMessage = "An internal server error occurred.";
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return formatErrorResponse(errorMessage, 500);
  }
}
