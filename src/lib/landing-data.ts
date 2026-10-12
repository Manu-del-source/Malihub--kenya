import type { ListingCardData } from "@/components/marketplace/listing-card";

/**
 * Landing-page content that is safe to show without implying live marketplace
 * counts, real customer testimonials, or sample products are actual listings.
 * Featured listings remain empty until they are populated from live data.
 */

export const FEATURED_LISTINGS: ListingCardData[] = [];

export const CATEGORY_LISTING_COUNTS: Record<string, number> = {};

export const POPULAR_SEARCHES = [
  "iPhone 13",
  "Wireless headphones",
  "Bluetooth speakers",
  "Office chairs",
  "Running shoes",
  "Office desk",
];

export const TRENDING_SEARCHES = [
  "Gaming laptops",
  "Maize harvester",
  "Smart watches",
  "Second-hand fridge",
  "Sneakers",
];

export const RECENT_SEARCHES_SAMPLE = [
  "Wireless keyboard",
  "Samsung A54",
  "Baby cot",
];

export const STATS: { label: string; value: number; suffix: string }[] = [];

export const WHY_MALIHUB_FEATURES = [
  {
    title: "Browse by category",
    description: "Explore the categories available on MaliHub and open listings for more details.",
    icon: "Search",
    size: "lg",
  },
  {
    title: "Compare listing details",
    description: "Review the listed price, item condition, photos, and location before contacting a seller.",
    icon: "ClipboardList",
    size: "sm",
  },
  {
    title: "Create a listing",
    description: "Sellers can add product details and photos so potential buyers can learn about an item.",
    icon: "Camera",
    size: "sm",
  },
  {
    title: "Save items",
    description: "Use the available wishlist controls to keep track of listings you want to revisit.",
    icon: "Heart",
    size: "sm",
  },
  {
    title: "Explore local listings",
    description: "Use location information on listings to assess whether an item is relevant to you.",
    icon: "MapPinned",
    size: "lg",
  },
  {
    title: "Mobile-friendly browsing",
    description: "Browse the marketplace from a phone, tablet, or computer.",
    icon: "Smartphone",
    size: "sm",
  },
] as const;

export const TESTIMONIALS: { name: string; role: string; quote: string; rating: number; initials: string }[] = [];

export const FAQS = [
  {
    question: "How do I buy an item?",
    answer: "Open a listing to review its details, price, condition, and seller information. Follow the contact or purchase options actually shown on that listing. Confirm important details with the seller before paying.",
  },
  {
    question: "How do I sell on MaliHub?",
    answer: "Create an account, open the seller flow, and provide accurate information and photos for your item. Keep your listing and contact details up to date.",
  },
  {
    question: "Are all sellers verified?",
    answer: "Do not assume a seller has been independently verified. Treat any verification badge as meaningful only where the platform explicitly displays it, and review the listing and seller details carefully.",
  },
  {
    question: "How are payments handled?",
    answer: "Use only payment options that are explicitly available during your transaction. Do not rely on screenshots or messages as proof of payment; confirm payment through the relevant provider or your own account.",
  },
  {
    question: "How can I stay safe?",
    answer: "Check an item's condition and ownership, communicate through available platform tools where possible, and avoid sending money before you are satisfied with the seller and transaction. For in-person exchanges, choose a public place.",
  },
];
