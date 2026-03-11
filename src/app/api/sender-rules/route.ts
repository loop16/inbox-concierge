import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await prisma.senderRule.findMany({
    where: { userId: auth.user.id },
    include: { bucket: { select: { id: true, name: true } } },
    orderBy: { matchCount: "desc" },
  });

  return NextResponse.json(rules);
}

export async function DELETE() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.senderRule.deleteMany({
    where: { userId: auth.user.id },
  });

  return NextResponse.json({ deleted: true });
}
