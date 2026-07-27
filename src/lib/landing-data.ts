import type { ListingCardData } from "@/components/marketplace/listing-card";

/**
 * Everything in this file is marketing-placeholder content for the landing
 * page only. Phase 5 replaces `FEATURED_LISTINGS` with a real
 * `prisma.product.findMany(...)` call — the shape (`ListingCardData`) is
 * already the shape that query will be mapped into, so the component tree
 * doesn't change, only the data source.
 */

export const FEATURED_LISTINGS: ListingCardData[] = [
  {
    id: "f1",
    slug: "toyota-probox-2015-nairobi",
    title: "Toyota Probox 2015, well maintained, low mileage",
    priceCents: 89000000,
    isNegotiable: true,
    imageUrl:
      "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&q=80",
    county: "Nairobi",
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    isVerifiedSeller: true,
    sellerName: "Kilimani Motors",
    favoriteCount: 34,
    condition: "GOOD",
  },
  {
    id: "f2",
    slug: "iphone-13-pro-128gb-mombasa",
    title: "iPhone 13 Pro, 128GB, Sierra Blue",
    priceCents: 8500000,
    isNegotiable: false,
    imageUrl:
      "https://images.unsplash.com/photo-1632661674596-df8be070a5c5?w=800&q=80",
    county: "Mombasa",
    postedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    isVerifiedSeller: true,
    sellerName: "Coast Gadgets",
    favoriteCount: 61,
    condition: "LIKE_NEW",
  },
  {
    id: "f3",
    slug: "3-bedroom-apartment-kilimani",
    title: "3-Bedroom Apartment, Kilimani, gated compound",
    priceCents: 12000000,
    isNegotiable: true,
    imageUrl:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80",
    county: "Nairobi",
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    isVerifiedSeller: true,
    sellerName: "Zawadi Properties",
    favoriteCount: 22,
    condition: "GOOD",
  },
  {
    id: "f4",
    slug: "leather-sofa-set-6-seater-nakuru",
    title: "6-Seater Leather Sofa Set, brand new",
    priceCents: 4500000,
    isNegotiable: true,
    imageUrl:
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=80",
    county: "Nakuru",
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    isVerifiedSeller: false,
    sellerName: "Nakuru Home Furnishings",
    favoriteCount: 15,
    condition: "NEW",
  },
  {
    id: "f5",
    slug: "macbook-air-m2-eldoret",
    title: "MacBook Air M2, 256GB, barely used",
    priceCents: 9800000,
    isNegotiable: false,
    imageUrl:
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&q=80",
    county: "Uasin Gishu",
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    isVerifiedSeller: true,
    sellerName: "TechHub Eldoret",
    favoriteCount: 47,
    condition: "LIKE_NEW",
  },
  {
    id: "f6",
    slug: "nike-air-max-sneakers-kisumu",
    title: "Nike Air Max, size 42, new in box",
    priceCents: 650000,
    isNegotiable: true,
    imageUrl:
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80",
    county: "Kisumu",
    postedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    isVerifiedSeller: false,
    sellerName: "Lakeside Sneaker Store",
    favoriteCount: 19,
    condition: "NEW",
  },
];

export const CATEGORY_LISTING_COUNTS: Record<string, number> = {
  vehicles: 18400,
  property: 9200,
  "phones-tablets": 41200,
  electronics: 27600,
  "home-furniture": 15300,
  fashion: 33800,
  "health-beauty": 8900,
  agriculture: 6100,
  jobs: 4700,
  services: 11500,
};

export const POPULAR_SEARCHES = [
  "iPhone 13",
  "Toyota Probox",
  "3-bedroom apartment",
  "Office chairs",
  "Land in Kajiado",
  "Motorbike",
];

export const TRENDING_SEARCHES = [
  "Gaming laptops",
  "Maize harvester",
  "Studio apartment Nairobi",
  "Second-hand fridge",
  "Toyota Vitz",
];

export const RECENT_SEARCHES_SAMPLE = [
  "Plots in Ruiru",
  "Samsung A54",
  "Baby cot",
];

export const STATS = [
  { label: "Active buyers", value: 128400, suffix: "+" },
  { label: "Active sellers", value: 21700, suffix: "+" },
  { label: "Live listings", value: 342000, suffix: "+" },
  { label: "Counties covered", value: 47, suffix: "" },
];

export const WHY_MALIHUB_FEATURES = [
  {
    title: "Secure M-Pesa payments",
    description:
      "Checkout with STK Push and get paid instantly — no cash handoffs, no waiting on bank transfers.",
    icon: "ShieldCheck",
    size: "lg",
  },
  {
    title: "Verified sellers",
    description: "ID-verified badges so you know exactly who you're buying from.",
    icon: "BadgeCheck",
    size: "sm",
  },
  {
    title: "AI-powered recommendations",
    description: "Listings get smarter the more you browse — matched to what you actually want.",
    icon: "Sparkles",
    size: "sm",
  },
  {
    title: "Search that finds it fast",
    description:
      "Full-text search across titles, brands, and descriptions returns results instantly, not eventually.",
    icon: "Zap",
    size: "sm",
  },
  {
    title: "Nationwide, all 47 counties",
    description:
      "From Mombasa to Turkana — MaliHub connects buyers and sellers everywhere in Kenya.",
    icon: "MapPinned",
    size: "lg",
  },
  {
    title: "Built for mobile",
    description: "Fast on any connection, designed first for the phone in your hand.",
    icon: "Smartphone",
    size: "sm",
  },
] as const;

export const TESTIMONIALS = [
  {
    name: "Wanjiru Kamau",
    role: "Sold 3 vehicles on MaliHub",
    quote:
      "I listed my Probox on a Friday evening and had a serious buyer by Sunday morning. The M-Pesa checkout meant I never had to worry about fake alerts.",
    rating: 5,
    initials: "WK",
  },
  {
    name: "Brian Otieno",
    role: "Electronics seller, Kisumu",
    quote:
      "The verified badge alone changed how fast my listings moved. Buyers message first, not the other way around.",
    rating: 5,
    initials: "BO",
  },
  {
    name: "Amina Hassan",
    role: "Buyer, Mombasa",
    quote:
      "Filtering by county saved me so much time — I only see what's actually near me, and the search just gets what I mean.",
    rating: 4,
    initials: "AH",
  },
  {
    name: "Peter Mwangi",
    role: "Furniture seller, Nakuru",
    quote: "Set up my shop in an afternoon. Payouts land the same day a sale closes.",
    rating: 5,
    initials: "PM",
  },
];

export const FAQS = [
  {
    question: "Is MaliHub Kenya free to use?",
    answer:
      "Browsing and buying is always free. Selling is free for your first few listings each month, with optional paid boosts to get more visibility.",
  },
  {
    question: "How do M-Pesa payments work on MaliHub?",
    answer:
      "When you check out, you'll get an STK Push prompt straight to your phone. Enter your M-Pesa PIN to confirm — funds are held securely until you confirm delivery.",
  },
  {
    question: "How does seller verification work?",
    answer:
      "Sellers submit a national ID and KRA PIN for review. Once approved, a verified badge appears on all of their listings so buyers can shop with confidence.",
  },
  {
    question: "Which counties does MaliHub cover?",
    answer:
      "All 47 counties, from Mombasa to Turkana. You can filter every search by county and sub-county to see what's actually near you.",
  },
  {
    question: "Can I negotiate prices with sellers?",
    answer:
      "Yes — any listing marked 'negotiable' opens a chat with the seller directly, so you can agree on a price before paying.",
  },
];
