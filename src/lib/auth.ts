import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma";

const DEFAULT_BUCKETS = [
  { name: "Action Required", sortOrder: 0, description: "Emails requiring a response or action — deadlines, RSVPs, approvals, requests, tasks, sign-ups, verifications", examples: "meeting invites, form submissions, account confirmations, follow-up requests" },
  { name: "Important", sortOrder: 1, description: "High-priority emails from real people — direct messages, time-sensitive updates, significant personal or professional communications", examples: "emails from colleagues, bosses, clients, family, friends, important announcements" },
  { name: "Can Wait", sortOrder: 2, description: "Low-priority but somewhat useful emails — informational updates, notifications that don't need immediate attention", examples: "app notifications, service updates, shipping updates, social media digests" },
  { name: "Finance / Receipts", sortOrder: 3, description: "Financial emails — receipts, invoices, bank statements, payment confirmations, billing, subscriptions, tax documents", examples: "purchase receipts, credit card alerts, PayPal, Venmo, bank notifications, billing statements" },
  { name: "Newsletters", sortOrder: 4, description: "Newsletters, mailing lists, marketing emails, promotional content, blog digests, and subscribed content", examples: "Substack, Morning Brew, marketing emails, promotional offers, weekly digests" },
  { name: "Recruiting / Job", sortOrder: 5, description: "Job-related emails — recruiters, job applications, interview scheduling, LinkedIn messages, career opportunities", examples: "recruiter outreach, application confirmations, interview invites, LinkedIn, job boards" },
  { name: "Personal", sortOrder: 6, description: "Personal and social emails — friends, family, community, events, hobbies, travel plans, non-work conversations", examples: "personal messages, event invitations, travel bookings, social plans, community groups" },
  { name: "Auto-Archive", sortOrder: 7, description: "Automated junk — no-reply emails with no useful info, pure spam, unsubscribe-worthy content, bulk automated messages with no action needed", examples: "noreply@, automated notifications, spam, marketing from unknown senders, terms of service updates" },
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

      try {
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
      } catch (error) {
        console.error("[AUTH] signIn callback failed:", error);
        return false;
      }
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
