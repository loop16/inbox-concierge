import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./prisma";

export async function getAuthSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const accessToken = (session as unknown as Record<string, unknown>).accessToken as string | undefined;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) return null;

  return { session, user, accessToken: accessToken || user.accessToken };
}
