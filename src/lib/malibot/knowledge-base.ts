type Article = {
  title: string;
  keywords: string[];
  content: string;
};

const ARTICLES: Article[] = [
  {
    title: "Buying on MaliHub",
    keywords: ["buy", "buyer", "purchase", "product", "listing", "cart", "checkout", "order"],
    content: "MaliHub is a Kenyan online marketplace where buyers browse product listings, add items to their cart and place orders. Orders are split by seller, so a cart containing products from different sellers can create separate orders. Buyers should use My Orders / Order Updates in their signed-in account to review their orders.",
  },
  {
    title: "Buyer order tracking",
    keywords: ["track", "tracking", "courier", "shipment", "dispatch", "shipped", "delivery", "tracking number", "tracking link"],
    content: "When a seller dispatches an order, the seller records the courier or carrier name and a real tracking number; a courier tracking URL may also be supplied. These shipment details are shown on the buyer's order detail page beside the order status. The tracking URL, when present, opens the courier's own tracking page. It is not live GPS tracking provided by MaliHub. If an order is marked shipped but courier details are missing, the buyer should contact MaliHub support with the order number.",
  },
  {
    title: "Seller Centre and order fulfilment",
    keywords: ["seller", "sell", "seller centre", "seller center", "seller dashboard", "seller tab", "shop dashboard", "open shop", "access seller centre", "find seller centre", "apply seller", "become seller", "fulfil", "fulfill", "fulfillment", "dispatch", "pack", "ship", "shipping"],
    content: "Seller Centre navigation: if you already have a seller profile and are signed in, open the dashboard navigation and choose Dashboard to open your seller dashboard at /seller. On a mobile screen, use the bottom navigation tab labelled Seller. The seller dashboard and its Orders, Products, Supplier catalog and Sales sections are available according to your seller profile and approval status. If you have not applied yet, open the public Sell on MaliHub page at /seller-center, choose Start your seller journey to create an account, or I already have an account to sign in; both continue to the seller application at /seller/onboarding. If you are already signed in as a buyer, you can open /seller/onboarding to submit a seller application. MaliHub reviews applications before product publishing is enabled. The public /seller-center page is an introduction and application entry point; the authenticated seller workspace is /seller. For an order awaiting fulfilment, the seller prepares the goods and dispatches them using a courier or delivery provider they have arranged. When handing the parcel to the courier, the seller records the carrier name and tracking number, and may add the courier's HTTPS tracking URL. A dispatch update records the seller's confirmation of physical handover; it is not proof of delivery. Sellers can update delivery progress and provide delivery confirmation evidence through the fulfilment workflow. Admin users can monitor fulfilment and overdue dispatches.",
  },
  {
    title: "Payments and payment problems",
    keywords: ["pay", "payment", "paid", "mpesa", "m-pesa", "paystack", "receipt", "transaction", "failed", "pending", "refund"],
    content: "A payment receipt or transaction reference by itself does not prove that an order has been delivered. MaliBot must not infer payment success from a buyer's message. For a payment that appears pending, failed, duplicated or missing, the buyer should share the order number and payment confirmation with official MaliHub support. Never share an M-Pesa PIN, OTP, password, full card number or other secret credential. Do not promise a refund or payout unless an authorized system record confirms it.",
  },
  {
    title: "Delivery, returns and disputes",
    keywords: ["delivery", "deliver", "return", "refund", "dispute", "wrong item", "damaged", "missing", "late", "inspection"],
    content: "Delivery timing and delivery charges can vary; MaliBot must not invent a delivery fee, delivery date or courier guarantee. If an order is late, missing, damaged or incorrect, the buyer should contact MaliHub support and provide the order number and relevant evidence. Do not claim that MaliHub guarantees escrow or automatic payout release. Do not state that a return, refund or dispute has been approved unless an authorized record confirms it.",
  },
  {
    title: "Account access and security",
    keywords: ["account", "login", "sign in", "password", "reset", "otp", "verification", "profile"],
    content: "For account access and profile issues, use the Account area and the password-reset flow available from sign-in. MaliHub support can investigate account-specific problems. MaliBot and support should never ask for a password, M-Pesa PIN, OTP, full card details or secret authentication credentials.",
  },
  {
    title: "MaliHub support and privacy",
    keywords: ["support", "help", "contact", "human", "agent", "complaint", "admin"],
    content: "For an issue requiring account investigation, contact official MaliHub support using the Human support option in MaliBot or the support contact shown in the app. Do not share private buyer or seller information in public messages. MaliBot must not disclose another user's orders, addresses, payments, seller records or account information.",
  },
  {
    title: "What MaliBot can and cannot do",
    keywords: ["can you", "capability", "feature", "available", "status", "live", "database", "admin", "seller dashboard"],
    content: "MaliBot can explain general MaliHub workflows and, when an authenticated buyer supplies their own order number, report a limited read-only summary of that buyer's order and shipment status. It cannot change an order, dispatch goods, approve a refund, change a payment, release a payout or access seller/admin records. If a fact is not in the verified knowledge provided, say it is not confirmed and direct the user to official support.",
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please",
  "the", "this", "to", "what", "when", "where", "which", "with", "you", "your",
]);

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, " ").split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function retrieveMaliHubKnowledge(question: string, maxArticles = 4): Array<{ title: string; content: string }> {
  const queryTokens = new Set(tokens(question));
  if (queryTokens.size === 0) return [];

  return ARTICLES.map((article) => {
    const keywordTokens = new Set(article.keywords.flatMap(tokens));
    const contentTokens = new Set(tokens(article.content));
    let score = 0;
    for (const token of queryTokens) {
      if (keywordTokens.has(token)) score += 4;
      else if (contentTokens.has(token)) score += 1;
    }
    return { article, score };
  })
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArticles)
    .map(({ article }) => ({ title: article.title, content: article.content }));
}
