import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma";

const DEFAULT_BUCKETS = [
  { name: "Action Required", sortOrder: 0 },
  { name: "Important", sortOrder: 1 },
  { name: "Can Wait", sortOrder: 2 },
  { name: "Finance / Receipts", sortOrder: 3 },
  { name: "Newsletters", sortOrder: 4 },
  { name: "Recruiting / Job", sortOrder: 5 },
  { name: "Personal", sortOrder: 6 },
  { name: "Auto-Archive", sortOrder: 7 },
];

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account) return false;

      const dbUser = await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          lastActiveAt: new Date(),
        },
        create: {
          email: user.email,
          name: user.name,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          lastActiveAt: new Date(),
        },
      });

      // Seed default buckets for new users
      const bucketCount = await prisma.bucket.count({
        where: { userId: dbUser.id },
      });
      if (bucketCount === 0) {
        await prisma.bucket.createMany({
          data: DEFAULT_BUCKETS.map((b) => ({
            ...b,
            isDefault: true,
            userId: dbUser.id,
          })),
        });
      }

      return true;
    },

    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }

      // Refresh if expired
      if (
        token.expiresAt &&
        typeof token.expiresAt === "number" &&
        Date.now() / 1000 > token.expiresAt
      ) {
        try {
          const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              grant_type: "refresh_token",
              refresh_token: token.refreshToken as string,
            }),
          });
          const data = await response.json();

          if (data.access_token) {
            token.accessToken = data.access_token;
            token.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

            // Update DB too
            if (token.email) {
              await prisma.user.update({
                where: { email: token.email },
                data: { accessToken: data.access_token },
              });
            }
          }
        } catch (error) {
          console.error("Error refreshing access token", error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      (session as unknown as Record<string, unknown>).accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
