// ────────────────────────────────────────────────────────────────
// Layered Rule Engine for Email Classification
// Priority: SenderRules → AutoDetect → Keywords → CustomBuckets
// ────────────────────────────────────────────────────────────────

export interface RuleThread {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  labelIds: string;
}

export interface RuleBucket {
  id: string;
  name: string;
  description: string | null;
  examples: string | null;
}

export interface RuleSenderRule {
  id: string;
  senderEmail: string;
  senderDomain: string | null;
  bucketId: string;
  matchCount: number;
}

export interface RuleResult {
  bucketName: string;
  bucketId: string;
  reason: string;
  confidence: number;
  source: "sender-rule" | "auto-detect" | "keyword" | "custom-match" | "label";
  senderRuleId?: string;
}

// ── Main entry point ──
export function applyAllRules(
  thread: RuleThread,
  buckets: RuleBucket[],
  senderRules: RuleSenderRule[],
  senderRuleMap: Map<string, RuleSenderRule>,
  domainRuleMap: Map<string, RuleSenderRule>,
): RuleResult | null {
  const bucketByName = new Map(buckets.map((b) => [b.name.toLowerCase(), b]));
  const bucketById = new Map(buckets.map((b) => [b.id, b]));

  // Layer 1: Sender rules (exact email, then domain)
  const sr = matchSenderRule(thread, senderRuleMap, domainRuleMap, bucketById);
  if (sr) return sr;

  // Layer 2: Automated email detection
  const auto = matchAutomatedEmail(thread, bucketByName);
  if (auto) return auto;

  // Layer 3: Gmail label rules
  const label = matchGmailLabels(thread, bucketByName);
  if (label) return label;

  // Layer 4: Keyword rules on subject
  const kw = matchKeywordRules(thread, bucketByName);
  if (kw) return kw;

  // Layer 5: Custom bucket matching
  const custom = matchCustomBuckets(thread, buckets);
  if (custom) return custom;

  return null;
}

// ── Helpers ──

function findBucket(
  bucketByName: Map<string, RuleBucket>,
  ...names: string[]
): RuleBucket | undefined {
  for (const n of names) {
    const b = bucketByName.get(n.toLowerCase());
    if (b) return b;
  }
  return undefined;
}

function result(
  bucket: RuleBucket,
  reason: string,
  confidence: number,
  source: RuleResult["source"],
  senderRuleId?: string,
): RuleResult {
  return {
    bucketName: bucket.name,
    bucketId: bucket.id,
    reason,
    confidence,
    source,
    senderRuleId,
  };
}

// ────────────────────────────────────────────────────────────────
// Layer 1: Sender Rules
// ────────────────────────────────────────────────────────────────

function matchSenderRule(
  thread: RuleThread,
  senderRuleMap: Map<string, RuleSenderRule>,
  domainRuleMap: Map<string, RuleSenderRule>,
  bucketById: Map<string, RuleBucket>,
): RuleResult | null {
  // Exact email match
  const emailRule = senderRuleMap.get(thread.senderEmail);
  if (emailRule) {
    const bucket = bucketById.get(emailRule.bucketId);
    if (bucket) {
      return result(bucket, `Sender rule: ${thread.senderEmail}`, 0.95, "sender-rule", emailRule.id);
    }
  }

  // Domain match
  const domain = thread.senderEmail.split("@")[1]?.toLowerCase() || "";
  const domainRule = domainRuleMap.get(domain);
  if (domainRule) {
    const bucket = bucketById.get(domainRule.bucketId);
    if (bucket) {
      return result(bucket, `Domain rule: ${domain}`, 0.9, "sender-rule", domainRule.id);
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Layer 2: Automated / Machine Email Detection
// ────────────────────────────────────────────────────────────────

const NOREPLY_PREFIXES = [
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "notifications", "notification", "updates", "update",
  "news", "newsletter", "digest", "marketing", "promotions", "promo",
  "mailer-daemon", "info", "hello", "team",
];

const BULK_SENDER_DOMAINS = new Set([
  "substack.com", "mailchimp.com", "convertkit.com", "beehiiv.com",
  "buttondown.email", "revue.email", "sendinblue.com", "mailerlite.com",
  "campaignmonitor.com", "constantcontact.com", "sendgrid.net",
  "amazonses.com", "mailgun.org", "postmarkapp.com", "mandrillapp.com",
  "hubspot.com", "intercom.io", "customer.io", "drip.com", "klaviyo.com",
  "activecampaign.com", "getresponse.com", "moosend.com",
]);

const NOTIFICATION_DOMAINS = new Set([
  "zoom.us", "calendly.com", "notion.so", "slack.com", "discord.com",
  "github.com", "gitlab.com", "bitbucket.org",
  "trello.com", "asana.com", "monday.com", "linear.app",
  "figma.com", "canva.com", "dropbox.com",
  "facebookmail.com", "twitter.com", "x.com", "linkedin.com",
  "instagram.com", "pinterest.com", "tiktok.com", "youtube.com",
  "medium.com", "reddit.com", "quora.com",
  "stripe.com", "paypal.com", "venmo.com", "cashapp.com",
  "uber.com", "lyft.com", "doordash.com", "grubhub.com",
  "amazon.com", "ebay.com", "walmart.com", "target.com",
  "netflix.com", "spotify.com", "apple.com",
  "steamcommunity.com", "ea.com", "epicgames.com",
]);

const RECEIPT_SUBJECT_KEYWORDS = [
  "receipt", "invoice", "payment", "order confirmation", "order shipped",
  "your order", "purchase confirmation", "refund", "charge",
  "transaction", "statement", "billing", "subscription renewed",
  "account statement", "wire transfer",
];

const CALENDAR_SUBJECT_KEYWORDS = [
  "calendar", "invite", "invitation", "meeting", "event", "rsvp",
  "accepted:", "declined:", "tentative:", "updated invitation",
];

function matchAutomatedEmail(
  thread: RuleThread,
  bucketByName: Map<string, RuleBucket>,
): RuleResult | null {
  const emailLocal = thread.senderEmail.split("@")[0]?.toLowerCase() || "";
  const domain = thread.senderEmail.split("@")[1]?.toLowerCase() || "";
  const subjectLower = thread.subject.toLowerCase();

  // Bulk sender domains → Newsletters
  if (BULK_SENDER_DOMAINS.has(domain)) {
    const bucket = findBucket(bucketByName, "Newsletters", "Newsletter");
    if (bucket) return result(bucket, `Bulk sender domain: ${domain}`, 0.92, "auto-detect");
  }

  // Notification domains → route by subject
  if (NOTIFICATION_DOMAINS.has(domain)) {
    // Receipt/finance from notification domains
    if (RECEIPT_SUBJECT_KEYWORDS.some((kw) => subjectLower.includes(kw))) {
      const bucket = findBucket(bucketByName, "Finance / Receipts", "Finance", "Receipts");
      if (bucket) return result(bucket, `Receipt from ${domain}`, 0.9, "auto-detect");
    }

    // Calendar/meeting from notification domains
    if (CALENDAR_SUBJECT_KEYWORDS.some((kw) => subjectLower.includes(kw))) {
      const bucket = findBucket(bucketByName, "Can Wait", "Meetings");
      if (bucket) return result(bucket, `Calendar/meeting from ${domain}`, 0.85, "auto-detect");
    }

    // Everything else from notification domains → Auto-Archive
    const bucket = findBucket(bucketByName, "Auto-Archive", "Archive");
    if (bucket) return result(bucket, `Notification from ${domain}`, 0.85, "auto-detect");
  }

  // noreply-style sender prefixes
  const isNoReply = NOREPLY_PREFIXES.some((p) => emailLocal === p || emailLocal.startsWith(p + "+"));
  if (isNoReply) {
    // Check if it's a receipt
    if (RECEIPT_SUBJECT_KEYWORDS.some((kw) => subjectLower.includes(kw))) {
      const bucket = findBucket(bucketByName, "Finance / Receipts", "Finance", "Receipts");
      if (bucket) return result(bucket, `Receipt from ${thread.senderEmail}`, 0.88, "auto-detect");
    }

    // noreply with newsletter-y subjects
    if (/newsletter|digest|weekly|monthly|roundup|update/i.test(subjectLower)) {
      const bucket = findBucket(bucketByName, "Newsletters", "Newsletter");
      if (bucket) return result(bucket, `Newsletter from ${thread.senderEmail}`, 0.85, "auto-detect");
    }

    // Generic noreply → Newsletters or Auto-Archive
    const bucket = findBucket(bucketByName, "Newsletters", "Auto-Archive", "Archive");
    if (bucket) return result(bucket, `Automated sender: ${emailLocal}@`, 0.8, "auto-detect");
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Layer 3: Gmail Label Rules
// ────────────────────────────────────────────────────────────────

function matchGmailLabels(
  thread: RuleThread,
  bucketByName: Map<string, RuleBucket>,
): RuleResult | null {
  let labels: string[] = [];
  try {
    labels = JSON.parse(thread.labelIds);
  } catch {
    return null;
  }

  if (labels.includes("CATEGORY_PROMOTIONS")) {
    const bucket = findBucket(bucketByName, "Newsletters", "Newsletter");
    if (bucket) return result(bucket, "Gmail promotions category", 0.85, "label");
  }

  if (labels.includes("CATEGORY_SOCIAL")) {
    const bucket = findBucket(bucketByName, "Auto-Archive", "Archive", "Personal");
    if (bucket) return result(bucket, "Gmail social category", 0.8, "label");
  }

  if (labels.includes("CATEGORY_UPDATES")) {
    const bucket = findBucket(bucketByName, "Can Wait");
    if (bucket) return result(bucket, "Gmail updates category", 0.75, "label");
  }

  if (labels.includes("CATEGORY_FORUMS")) {
    const bucket = findBucket(bucketByName, "Auto-Archive", "Archive");
    if (bucket) return result(bucket, "Gmail forums category", 0.8, "label");
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Layer 4: Keyword Rules on Subject
// ────────────────────────────────────────────────────────────────

const FINANCE_KEYWORDS = [
  "receipt", "invoice", "payment", "order confirmation", "order shipped",
  "transaction", "statement", "billing", "subscription renewed",
  "subscription confirmation", "your order", "purchase confirmation",
  "refund", "charge", "credit card", "bank alert", "wire transfer",
  "tax document", "w-2", "1099", "account statement",
];

const RECRUITING_KEYWORDS = [
  "recruiter", "hiring", "we're hiring", "job alert", "your application",
  "offer letter", "background check", "onboarding",
  "career opportunity", "open position", "talent acquisition",
  "interview scheduled", "interview invitation",
];

const ACTION_KEYWORDS = [
  "action required", "urgent", "asap", "deadline", "overdue",
  "follow up", "response needed", "please respond", "time sensitive",
  "expiring", "expires soon", "last chance", "final notice", "past due",
  "confirmation needed", "verify your", "confirm your", "reset your password",
  "security alert", "unusual sign-in", "suspicious activity",
];

function matchKeywordRules(
  thread: RuleThread,
  bucketByName: Map<string, RuleBucket>,
): RuleResult | null {
  const subjectLower = thread.subject.toLowerCase();

  // Finance keywords
  for (const kw of FINANCE_KEYWORDS) {
    if (subjectLower.includes(kw)) {
      const bucket = findBucket(bucketByName, "Finance / Receipts", "Finance", "Receipts");
      if (bucket) return result(bucket, `Subject contains "${kw}"`, 0.85, "keyword");
      break;
    }
  }

  // Recruiting keywords
  for (const kw of RECRUITING_KEYWORDS) {
    if (subjectLower.includes(kw)) {
      const bucket = findBucket(bucketByName, "Recruiting / Job", "Recruiting", "Jobs");
      if (bucket) return result(bucket, `Subject contains "${kw}"`, 0.82, "keyword");
      break;
    }
  }

  // Action keywords
  for (const kw of ACTION_KEYWORDS) {
    if (subjectLower.includes(kw)) {
      const bucket = findBucket(bucketByName, "Action Required", "Urgent", "Important");
      if (bucket) return result(bucket, `Subject contains "${kw}"`, 0.8, "keyword");
      break;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Layer 5: Custom Bucket Matching (examples/description keywords)
// ────────────────────────────────────────────────────────────────

function matchCustomBuckets(
  thread: RuleThread,
  buckets: RuleBucket[],
): RuleResult | null {
  const subjectLower = thread.subject.toLowerCase();
  const senderLower = (thread.sender + " " + thread.senderEmail).toLowerCase();
  const snippetLower = thread.snippet.toLowerCase();
  const searchText = subjectLower + " " + senderLower + " " + snippetLower;

  let bestMatch: { bucket: RuleBucket; keyword: string; hits: number } | null = null;

  for (const bucket of buckets) {
    if (!bucket.examples && !bucket.description) continue;

    // Extract keywords from examples (comma-separated) and description
    const rawKeywords: string[] = [];
    if (bucket.examples) {
      rawKeywords.push(
        ...bucket.examples.split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
    }
    if (bucket.description) {
      // Use words > 4 chars from description as weak signals
      rawKeywords.push(
        ...bucket.description
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 4 && !/^(about|these|those|which|their|email|thread|bucket)$/.test(w))
      );
    }

    let hits = 0;
    let matchedKw = "";
    for (const kw of rawKeywords) {
      if (kw.length < 3) continue;
      if (searchText.includes(kw)) {
        hits++;
        if (!matchedKw) matchedKw = kw;
      }
    }

    if (hits > 0 && (!bestMatch || hits > bestMatch.hits)) {
      bestMatch = { bucket, keyword: matchedKw, hits };
    }
  }

  if (bestMatch && bestMatch.hits >= 1) {
    return result(
      bestMatch.bucket,
      `Custom match: "${bestMatch.keyword}"${bestMatch.hits > 1 ? ` (+${bestMatch.hits - 1} more)` : ""}`,
      0.7,
      "custom-match",
    );
  }

  return null;
}

// ── Legacy export for fallback path (no-LLM mode) ──
export function applyRules(thread: { subject: string; senderEmail: string; labelIds: string }): { bucketName: string; reason: string } | null {
  let labels: string[] = [];
  try { labels = JSON.parse(thread.labelIds); } catch { /* */ }

  if (labels.includes("CATEGORY_PROMOTIONS")) return { bucketName: "Newsletters", reason: "Gmail promotions category" };
  if (labels.includes("CATEGORY_SOCIAL")) return { bucketName: "Personal", reason: "Gmail social category" };

  const domain = thread.senderEmail.split("@")[1]?.toLowerCase() || "";
  if (BULK_SENDER_DOMAINS.has(domain)) return { bucketName: "Newsletters", reason: `Bulk sender: ${domain}` };
  if (NOTIFICATION_DOMAINS.has(domain)) return { bucketName: "Auto-Archive", reason: `Notification: ${domain}` };

  const local = thread.senderEmail.split("@")[0]?.toLowerCase() || "";
  if (NOREPLY_PREFIXES.some((p) => local === p || local.startsWith(p + "+"))) {
    return { bucketName: "Newsletters", reason: `Automated sender: ${local}@` };
  }

  const sub = thread.subject.toLowerCase();
  for (const kw of FINANCE_KEYWORDS) { if (sub.includes(kw)) return { bucketName: "Finance / Receipts", reason: `Subject: "${kw}"` }; }
  for (const kw of RECRUITING_KEYWORDS) { if (sub.includes(kw)) return { bucketName: "Recruiting / Job", reason: `Subject: "${kw}"` }; }
  for (const kw of ACTION_KEYWORDS) { if (sub.includes(kw)) return { bucketName: "Action Required", reason: `Subject: "${kw}"` }; }

  return null;
}
