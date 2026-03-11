import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { testImapConnection } from "@/lib/imap-service";

export async function POST(request: NextRequest) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { host, port, email, password, tls } = body;

  if (!host || !email || !password) {
    return NextResponse.json(
      { success: false, error: "Host, email, and password are required" },
      { status: 400 }
    );
  }

  const result = await testImapConnection({
    host,
    port: port || 993,
    secure: tls !== false,
    email,
    password,
  });

  return NextResponse.json(result);
}
