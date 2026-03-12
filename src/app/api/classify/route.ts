import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  applyAllRules,
  type RuleThread,
  type RuleBucket,
  type RuleSenderRule,
} from "@/lib/classify-rules";
import { getLLMClient, getLLMModel } from "@/lib/llm-client";
import {
  classifyWithLLM,
  type ThreadSummary,
  type BucketDef,
  type DimensionalClassification,
} from "@/lib/classify-llm";
import { rateLimit } from "@/lib/rate-limit";

// Allow up to 300 seconds for classification on Vercel
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await getAuthSession();
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limit: 5 classify requests per hour
  const rl = rateLimit(`classify:${auth.user.id}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Update lastActiveAt
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { lastActiveAt: new Date() },
  });

  const reclassify =
    request.nextUrl.searchParams.get("reclassify") === "true";

  const encoder = new TextEncoder();
  const startTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        send({ phase: "loading", message: "Loading threads..." });

        // ── Load data (all at once) ──
        const [buckets, senderRules] = await Promise.all([
          prisma.bucket.findMany({ where: { userId: auth.user.id } }),
          prisma.senderRule.findMany({ where: { userId: auth.user.id } }),
        ]);

        // Case-insensitive bucket name → id mapping
        const bucketMap = new Map(buckets.map((b) => [b.name, b.id]));
        const bucketMapLower = new Map(buckets.map((b) => [b.name.toLowerCase(), b.id]));
        const resolveBucketId = (name: string): string | undefined => {
          return bucketMap.get(name) ?? bucketMapLower.get(name.toLowerCase());
        };

        // ── Reclassify: reset non-manual threads first ──
        if (reclassify) {
          await prisma.thread.updateMany({
            where: { userId: auth.user.id, manualOverride: false },
            data: { bucketId: null, confidence: null, reason: null },
          });
        }

        // ── Load threads (always unclassified after reset) ──
        const threads = await prisma.thread.findMany({
          where: {
            userId: auth.user.id,
            bucketId: null,
          },
        });

        if (threads.length === 0) {
          send({
            phase: "complete", classified: 0, total: 0,
            skippedManualOverrides: 0, senderRules: 0,
            autoDetect: 0, keywords: 0, customMatch: 0, labels: 0,
            llmBased: 0, failed: 0, timeMs: Date.now() - startTime,
            aiAvailable: true,
          });
          controller.close();
          return;
        }

        send({ phase: "started", total: threads.length, message: `Processing ${threads.length} threads...` });

        // ── Pre-build lookup maps (once) ──
        const senderRuleMap = new Map<string, RuleSenderRule>(
          senderRules.map((r) => [r.senderEmail, r])
        );
        const domainRuleMap = new Map<string, RuleSenderRule>();
        for (const r of senderRules) {
          if (r.senderDomain && !domainRuleMap.has(r.senderDomain)) {
            domainRuleMap.set(r.senderDomain, r);
          }
        }

        const ruleBuckets: RuleBucket[] = buckets.map((b) => ({
          id: b.id, name: b.name, description: b.description, examples: b.examples,
        }));

        // ── Stats ──
        let skippedManualOverrides = 0;
        let senderRuleCount = 0;
        let rulesSuggested = 0;
        let llmBased = 0;
        let failed = 0;
        let processed = 0;
        let aiAvailable = true;
        let aiError: string | null = null;

        const forAI: { thread: typeof threads[0]; ruleSuggestion: string | null; ruleReason: string | null }[] = [];
        const senderRuleUpdates: { id: string; bucketId: string; confidence: number; reason: string }[] = [];
        const ruleMatchIncrements = new Map<string, number>();

        // ── Phase 1: Sender rules are permanent, everything else gets rule hints for AI ──
        for (const thread of threads) {
          if (thread.manualOverride) {
            skippedManualOverrides++;
            processed++;
            continue;
          }

          // Sender rules — permanent, not overridden by AI
          const emailRule = senderRuleMap.get(thread.senderEmail);
          const domain = thread.senderEmail.split("@")[1]?.toLowerCase() || "";
          const domainRule = !emailRule ? domainRuleMap.get(domain) : undefined;
          const rule = emailRule || domainRule;

          if (rule) {
            const bucket = buckets.find((b) => b.id === rule.bucketId);
            if (bucket) {
              senderRuleUpdates.push({
                id: thread.id,
                bucketId: rule.bucketId,
                confidence: 0.95,
                reason: `Sender rule: ${emailRule ? thread.senderEmail : domain}`,
              });
              ruleMatchIncrements.set(rule.id, (ruleMatchIncrements.get(rule.id) || 0) + 1);
              senderRuleCount++;
              processed++;
              continue;
            }
          }

          // Run auto-rules to get a suggestion (hint for AI)
          const ruleThread: RuleThread = {
            id: thread.id, subject: thread.subject, sender: thread.sender,
            senderEmail: thread.senderEmail, snippet: thread.snippet, labelIds: thread.labelIds,
          };
          const match = applyAllRules(ruleThread, ruleBuckets, senderRules, senderRuleMap, domainRuleMap);
          if (match) {
            rulesSuggested++;
          }
          forAI.push({ thread, ruleSuggestion: match ? match.bucketName : null, ruleReason: match ? match.reason : null });
        }

        send({
          phase: "rules",
          processed,
          total: threads.length,
          rulesCaught: senderRuleCount,
          senderRules: senderRuleCount,
          rulesSuggested,
          autoDetect: 0, keywords: 0, customMatch: 0, labels: 0,
          skipped: skippedManualOverrides,
          needsLLM: forAI.length,
        });

        // ── Flush sender rule writes ──
        if (senderRuleUpdates.length > 0) {
          await prisma.$transaction(
            senderRuleUpdates.map((u) =>
              prisma.thread.update({
                where: { id: u.id },
                data: {
                  bucket: { connect: { id: u.bucketId } },
                  confidence: u.confidence,
                  reason: u.reason,
                },
              })
            )
          );
        }

        if (ruleMatchIncrements.size > 0) {
          await prisma.$transaction(
            Array.from(ruleMatchIncrements.entries()).map(([ruleId, inc]) =>
              prisma.senderRule.update({
                where: { id: ruleId },
                data: {
                  matchCount: (senderRules.find((r) => r.id === ruleId)?.matchCount || 0) + inc,
                },
              })
            )
          );
        }

        // ── Phase 2: AI classification with rule hints ──
        const client = getLLMClient();
        const model = getLLMModel();
        // Build threads for AI, including rule suggestions as hints
        const needsLLM = forAI.map((item) => item.thread);
        const ruleHints = new Map(forAI.filter((item) => item.ruleSuggestion).map((item) => [item.thread.id, item.ruleSuggestion!]));
        const ruleReasons = new Map(forAI.filter((item) => item.ruleReason).map((item) => [item.thread.id, item.ruleReason!]));

        if (client && needsLLM.length > 0) {
          const bucketDefs: BucketDef[] = buckets.map((b) => ({
            name: b.name,
            description: b.description,
            examples: b.examples,
            isDefault: b.isDefault,
          }));

          send({
            phase: "llm",
            processed,
            total: threads.length,
            batch: 0,
            totalBatches: 1,
            message: `AI: classifying ${needsLLM.length} threads...`,
          });

          let llmAborted = false;

          // Send all threads in one call
          const summaries: ThreadSummary[] = needsLLM.map((t) => ({
            id: t.id,
            subject: t.subject,
            sender: t.sender,
            senderEmail: t.senderEmail,
            snippet: t.snippet,
            hasUnsubscribe: t.hasUnsubscribe,
          }));

          let classifications: DimensionalClassification[] = [];
          try {
            classifications = await classifyWithLLM(client, model, summaries, bucketDefs, ruleHints, ruleReasons);
          } catch (e) {
            const msg = (e as Error).message || "";

            if (msg.includes("insufficient_quota") || msg.includes("billing")) {
              aiError = "Credits exhausted";
              llmAborted = true;
            } else if (msg.includes("invalid_api_key") || msg.includes("401")) {
              aiError = "Invalid API key";
              llmAborted = true;
            } else {
              // Transient error — retry once
              console.warn(`LLM failed, retrying:`, msg);
              try {
                classifications = await classifyWithLLM(client, model, summaries, bucketDefs, ruleHints, ruleReasons);
              } catch {
                failed += needsLLM.length;
              }
            }
          }

          type LLMUpdate = { id: string; bucketId: string; confidence: number; reason: string; aiCategory: string; aiActionability: string; aiUrgency: string; aiRisk: string; aiSenderType: string };
          let updates: LLMUpdate[] = [];

          if (!llmAborted && classifications.length > 0) {
            updates = classifications
              .filter((c) => resolveBucketId(c.bucket))
              .map((c) => ({
                id: c.threadId,
                bucketId: resolveBucketId(c.bucket)!,
                confidence: c.confidence,
                reason: c.reason,
                aiCategory: c.category,
                aiActionability: c.actionability,
                aiUrgency: c.urgency,
                aiRisk: c.risk,
                aiSenderType: c.senderType,
              }));

            const unmatched = classifications.filter((c) => !resolveBucketId(c.bucket));
            if (unmatched.length > 0) {
              console.warn(`[CLASSIFY] Unmatched bucket names:`, unmatched.map((c) => c.bucket));
            }

            llmBased = updates.length;
            failed += unmatched.length;

            if (updates.length > 0) {
              await prisma.$transaction(
                updates.map((u) =>
                  prisma.thread.update({
                    where: { id: u.id },
                    data: {
                      bucket: { connect: { id: u.bucketId } },
                      confidence: u.confidence,
                      reason: u.reason,
                      aiCategory: u.aiCategory,
                      aiActionability: u.aiActionability,
                      aiUrgency: u.aiUrgency,
                      aiRisk: u.aiRisk,
                      aiSenderType: u.aiSenderType,
                    },
                  })
                )
              );
            }
          }

          processed += needsLLM.length;

          send({
            phase: "llm-progress",
            processed,
            total: threads.length,
            batchesCompleted: 1,
            totalBatches: 1,
            llmBased,
            failed,
          });

          if (llmAborted) {
            aiAvailable = false;
            send({
              phase: "fallback",
              needsLLM: needsLLM.length,
              message: `AI unavailable: ${aiError}. Unclassified threads remain.`,
            });
          }
        } else if (!client && needsLLM.length > 0) {
          // No AI — fall back to rules for remaining threads
          aiAvailable = false;
          aiError = "No API key configured";

          let rulesFallback = 0;
          for (const thread of needsLLM) {
            const ruleThread: RuleThread = {
              id: thread.id, subject: thread.subject, sender: thread.sender,
              senderEmail: thread.senderEmail, snippet: thread.snippet, labelIds: thread.labelIds,
            };
            const match = applyAllRules(ruleThread, ruleBuckets, senderRules, senderRuleMap, domainRuleMap);
            if (match) {
              await prisma.thread.update({
                where: { id: thread.id },
                data: { bucket: { connect: { id: match.bucketId } }, confidence: match.confidence, reason: match.reason },
              });
              rulesFallback++;
            } else {
              failed++;
            }
          }
          llmBased = 0;
          processed += needsLLM.length;
          send({ phase: "fallback", needsLLM: needsLLM.length, rulesFallback, message: `No AI provider — ${rulesFallback} classified by rules, ${failed} unclassified` });
        }

        const timeMs = Date.now() - startTime;
        const totalClassified = senderRuleCount + llmBased;

        send({
          phase: "complete",
          classified: totalClassified,
          total: threads.length,
          skippedManualOverrides,
          senderRules: senderRuleCount,
          autoDetect: 0, keywords: 0, customMatch: 0, labels: 0,
          llmBased,
          failed,
          timeMs,
          aiAvailable,
          aiError,
        });
      } catch (err) {
        send({ phase: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
