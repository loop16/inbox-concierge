import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bucketId = request.nextUrl.searchParams.get("bucketId");
  const provider = request.nextUrl.searchParams.get("provider");

  const threads = await prisma.thread.findMany({
    where: {
      userId: auth.user.id,
      ...(bucketId ? { bucketId } : {}),
      ...(provider ? { provider } : {}),
    },
    include: {
      bucket: { select: { id: true, name: true, sortOrder: true } },
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(threads);
}
