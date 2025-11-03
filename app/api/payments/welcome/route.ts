import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Log request metadata
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.nextUrl.pathname} - Welcome endpoint accessed`);

  return NextResponse.json({
    message: "Welcome to the Payments API!",
    timestamp: new Date().toISOString(),
    method: request.method,
    path: request.nextUrl.pathname,
  });
}
