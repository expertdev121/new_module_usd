import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountingInputError } from "./settings";

/** Maps validation / ownership errors to 400 and everything else to a generic 500. */
export function accountingErrorResponse(route: string, err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "invalid_input", message: err.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  if (err instanceof AccountingInputError) {
    return NextResponse.json({ error: "invalid_input", message: err.message }, { status: 400 });
  }
  console.error(`[${route}]`, err instanceof Error ? err.message : String(err));
  return NextResponse.json({ error: "server_error", message: "Something went wrong" }, { status: 500 });
}
