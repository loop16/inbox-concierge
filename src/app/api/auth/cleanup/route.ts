import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.thread.deleteMany({
    where: { userId: auth.user.id },
  });

  return NextResponse.json({ deleted: result.count });
}
