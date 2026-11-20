/**
 * Demo catalogue for a fresh or empty MaliHub deployment.
 *
 * Run with: npm run prisma:seed:demo
 *
 * Creates verified ACTIVE demo sellers and realistic Kenyan marketplace
 * listings so the public catalogue is not empty before real sellers onboard.
 * Every row is upserted by a stable seed key, so the script is idempotent:
 * re-running updates the same demo rows instead of duplicating them. It
 * never touches real users, sellers, or listings whose keys do not match
 * the demo keys below. Deleting demo listings is left to the admin UI.
 *
 * Images: listing cards render the first image unconditionally, and a
 * listing with no image row yields an empty imageUrl that next/image
 * rejects. Demo listings therefore point at the checked-in local asset
 * public/images/seed-placeholder.svg — no remote image URL is fabricated,
 * so nothing 404s and no external host needs allowlisting. Sellers can
 * upload real Cloudinary photos later; the placeholder is only the seed.
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

const prisma = new PrismaClient();

const SEED_IMAGE_URL = "/images/seed-placeholder.svg";

const SEED_SELLERS = [
  {
    email: "seed-tech@malihubke.online",
    fullName: "Brian Otieno",
    businessName: "Nairobi Tech Deals",
    slug: "nairobi-tech-deals",
    county: "Nairobi",
    subCounty: "Westlands",
  },
  {
    email: "seed-furniture@malihubke.online",
    fullName: "Amina Hassan",
    businessName: "Mombasa Home Craft",
    slug: "mombasa-home-craft",
    county: "Mombasa",
    subCounty: "Nyali",
  },
  {
    email: "seed-fashion@malihubke.online",
    fullName: "Wanjiru Kamau",
    businessName: "Wanjiru Fashion Store",
    slug: "wanjiru-fashion-store",
    county: "Nakuru",
    subCounty: "Nakuru Town",
  },
] as const;

type SeedListing = {
  slug: string;
  sellerSlug: (typeof SEED_SELLERS)[number]["slug"];
  categorySlug: string;
  title: string;
  description: string;
  priceKes: number;
  condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
  brand?: string;
  size?: string;
  quantity: number;
  county: string;
  subCounty: string;
  isNegotiable?: boolean;
  isFeatured?: boolean;
};

const SEED_LISTINGS: SeedListing[] = [
  {
    slug: "seed-samsung-galaxy-a55",
    sellerSlug: "nairobi-tech-deals",
    categorySlug: "phones",
    title: "Samsung Galaxy A55 5G, 256GB, 8GB RAM",
    description:
      "Brand new, sealed with one year Samsung Kenya warranty. 6.6 inch Super AMOLED display, 50MP OIS camera, 5000mAh battery. Free cover and screen protector. Pickup in Nairobi CBD or countrywide delivery via parcel.",
    priceKes: 46999,
    condition: "NEW",
    brand: "Samsung",
    quantity: 5,
    county: "Nairobi",
    subCounty: "Starehe",
    isFeatured: true,
  },
  {
    slug: "seed Tecno Camon 30",
    sellerSlug: "nairobi-tech-deals",
    categorySlug: "phones",
    title: "Tecno Camon 30, 256GB, 50MP selfie camera",
    description:
      "Brand new with 13 months Carlcare warranty. Great camera for content creators, 70W fast charging, 5000mAh battery. Dual SIM, 4G network. Free delivery within Nairobi, pay on delivery accepted.",
    priceKes: 31999,
    condition: "NEW",
    brand: "Tecno",
    quantity: 8,
    county: "Nairobi",
    subCounty: "Westlands",
  },
  {
    slug: "seed-hp-elitebook-840",
    sellerSlug: "nairobi-tech-deals",
    categorySlug: "electronics",
    title: "HP EliteBook 840 G8, Core i5, 16GB RAM, 512 SSD",
    description:
      "Ex-UK refurbished laptop imported from the UK, Grade A condition. Intel Core i5 11th gen processor, 14 inch Full HD display, backlit keyboard, fingerprint reader. 90 day warranty and a free laptop bag included.",
    priceKes: 58999,
    condition: "LIKE_NEW",
    brand: "HP",
    quantity: 3,
    county: "Nairobi",
    subCounty: "Starehe",
    isNegotiable: true,
  },
  {
    slug: "seed-hisense-55-smart-tv",
    sellerSlug: "nairobi-tech-deals",
    categorySlug: "electronics",
    title: 'Hisense 55 inch 4K UHD Smart TV',
    description:
      "Brand new Hisense 55 inch 4K UHD Smart TV with Dolby Vision, HDR, voice remote, Netflix and YouTube built in. Two year Hisense warranty. Free wall bracket and delivery within Nairobi.",
    priceKes: 61999,
    condition: "NEW",
    brand: "Hisense",
    quantity: 4,
    county: "Nairobi",
    subCounty: "Roysambu",
    isFeatured: true,
  },
  {
    slug: "seed-mahogany-3-seater-sofa",
    sellerSlug: "mombasa-home-craft",
    categorySlug: "furniture",
    title: "3 Seater Mahogany Fabric Sofa",
    description:
      "Handcrafted three seater sofa made from solid mahogany frame with high density foam cushions and washable covers. Available in grey, navy and maroon. Made to order in Mombasa, delivery across the coast and upcountry on request.",
    priceKes: 84999,
    condition: "NEW",
    quantity: 2,
    county: "Mombasa",
    subCounty: "Nyali",
  },
  {
    slug: "seed-6x6-mattress",
    sellerSlug: "mombasa-home-craft",
    categorySlug: "furniture",
    title: "6 by 6 High Density Mattress",
    description:
      "Firm high density foam mattress, 6 by 6 feet, 8 inches thick. Orthopedic support, breathable cotton cover. Perfect for a master bedroom. Free delivery within Mombasa town.",
    priceKes: 32999,
    condition: "NEW",
    quantity: 6,
    county: "Mombasa",
    subCounty: "Kisauni",
  },
  {
    slug: "seed-von-2-door-fridge",
    sellerSlug: "mombasa-home-craft",
    categorySlug: "home-appliances",
    title: "Von 260L Double Door Refrigerator",
    description:
      "Brand new Von double door fridge, 260 litres, frost free, multi air flow cooling, low noise compressor. One year warranty. Delivery within Mombasa and Kwale at a small fee.",
    priceKes: 57999,
    condition: "NEW",
    brand: "Von",
    quantity: 3,
    county: "Mombasa",
    subCounty: "Nyali",
  },
  {
    slug: "seed-kitenge-dress",
    sellerSlug: "wanjiru-fashion-store",
    categorySlug: "fashion",
    title: "Ladies Kitenge Maxi Dress",
    description:
      "Beautiful African print maxi dress in soft cotton kitenge. Flowy fit, side pockets, available in sizes S, M, L, XL. Vibrant colours that do not fade. Also available in matching mother and daughter sets.",
    priceKes: 2499,
    condition: "NEW",
    size: "M",
    quantity: 20,
    county: "Nakuru",
    subCounty: "Nakuru Town",
    isNegotiable: true,
  },
  {
    slug: "seed-mens-slim-fit-suit",
    sellerSlug: "wanjiru-fashion-store",
    categorySlug: "fashion",
    title: "Mens Slim Fit 3 Piece Suit, Navy",
    description:
      "Modern slim fit three piece suit with jacket, waistcoat and trousers. Premium stretch fabric, half canvas lining. Ideal for weddings and office wear. Sizes 46 to 56 available, tailoring service offered in Nakuru town.",
    priceKes: 12999,
    condition: "NEW",
    size: "50",
    quantity: 4,
    county: "Nakuru",
    subCounty: "Nakuru Town",
    isFeatured: true,
  },
  {
    slug: "seed-running-trainers",
    sellerSlug: "wanjiru-fashion-store",
    categorySlug: "shoes-footwear",
    title: "Unisex Running Trainers, Lightweight",
    description:
      "Comfortable lightweight running trainers with cushioned sole and breathable mesh upper. Suitable for gym, walking and daily wear. Sizes UK 6 to 11. Genuine quality, not a copy.",
    priceKes: 4500,
    condition: "NEW",
    size: "UK 9",
    quantity: 15,
    county: "Nakuru",
    subCounty: "Nakuru Town",
  },
  {
    slug: "seed-microwave-20l",
    sellerSlug: "nairobi-tech-deals",
    categorySlug: "home-appliances",
    title: "20L Digital Microwave Oven",
    description:
      "20 litre digital microwave with 700W power, 5 power levels, timer and defrost function. Clean condition, works perfectly, selling because of relocation. Viewing in Kahawa West.",
    priceKes: 8500,
    condition: "GOOD",
    quantity: 1,
    county: "Nairobi",
    subCounty: "Roysambu",
    isNegotiable: true,
  },
  {
    slug: "seed-wooden-dining-table",
    sellerSlug: "mombasa-home-craft",
    categorySlug: "furniture",
    title: "6 Seater Solid Wood Dining Table with Chairs",
    description:
      "Solid mnunga wood dining table with six matching chairs, polished finish. Very sturdy and heavy, built to last. Selling as part of a household clear out. Buyer to arrange transport.",
    priceKes: 45000,
    condition: "GOOD",
    quantity: 1,
    county: "Mombasa",
    subCounty: "Nyali",
  },
];

async function main() {
  console.log(`Seeding ${DEFAULT_CATEGORIES.length} categories…`);
  const categoryBySlug = new Map<string, string>();
  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        iconName: category.iconName,
        sortOrder: index,
      },
      create: {
        name: category.name,
        slug: category.slug,
        iconName: category.iconName,
        sortOrder: index,
      },
    });
    categoryBySlug.set(category.slug, row.id);
  }

  console.log(`Upserting ${SEED_SELLERS.length} verified demo sellers…`);
  const sellerBySlug = new Map<
    string,
    { sellerId: string; userId: string }
  >();
  for (const seed of SEED_SELLERS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: {
        role: "SELLER",
        isActive: true,
        isBanned: false,
        emailVerified: true,
      },
      create: {
        id: randomUUID(),
        email: seed.email,
        role: "SELLER",
        emailVerified: true,
        isActive: true,
        isBanned: false,
        profile: {
          create: {
            fullName: seed.fullName,
            county: seed.county,
            subCounty: seed.subCounty,
            onboarded: true,
          },
        },
      },
    });
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        fullName: seed.fullName,
        county: seed.county,
        subCounty: seed.subCounty,
        onboarded: true,
      },
      create: {
        userId: user.id,
        fullName: seed.fullName,
        county: seed.county,
        subCounty: seed.subCounty,
        onboarded: true,
      },
    });
    const seller = await prisma.seller.upsert({
      where: { slug: seed.slug },
      update: {
        userId: user.id,
        businessName: seed.businessName,
        county: seed.county,
        subCounty: seed.subCounty,
        verificationStatus: "VERIFIED",
        description: `${seed.businessName}, a verified MaliHub demo seller based in ${seed.subCounty}, ${seed.county}.`,
      },
      create: {
        userId: user.id,
        businessName: seed.businessName,
        slug: seed.slug,
        county: seed.county,
        subCounty: seed.subCounty,
        verificationStatus: "VERIFIED",
        description: `${seed.businessName}, a verified MaliHub demo seller based in ${seed.subCounty}, ${seed.county}.`,
      },
    });
    sellerBySlug.set(seed.slug, { sellerId: seller.id, userId: user.id });
  }

  console.log(`Upserting ${SEED_LISTINGS.length} demo listings…`);
  for (const listing of SEED_LISTINGS) {
    const categoryId = categoryBySlug.get(listing.categorySlug);
    if (!categoryId) {
      throw new Error(`Category not seeded: ${listing.categorySlug}`);
    }
    const seller = sellerBySlug.get(listing.sellerSlug);
    if (!seller) {
      throw new Error(`Seller not seeded: ${listing.sellerSlug}`);
    }
    const product = await prisma.product.upsert({
      where: { slug: listing.slug },
      update: {
        sellerId: seller.sellerId,
        ownerId: seller.userId,
        categoryId,
        title: listing.title,
        description: listing.description,
        priceCents: listing.priceKes * 100,
        isNegotiable: listing.isNegotiable ?? false,
        condition: listing.condition,
        brand: listing.brand ?? null,
        size: listing.size ?? null,
        quantity: listing.quantity,
        county: listing.county,
        subCounty: listing.subCounty,
        status: "ACTIVE",
        isFeatured: listing.isFeatured ?? false,
        publishedAt: new Date(),
      },
      create: {
        sellerId: seller.sellerId,
        ownerId: seller.userId,
        categoryId,
        title: listing.title,
        slug: listing.slug,
        description: listing.description,
        priceCents: listing.priceKes * 100,
        isNegotiable: listing.isNegotiable ?? false,
        condition: listing.condition,
        brand: listing.brand ?? null,
        size: listing.size ?? null,
        quantity: listing.quantity,
        county: listing.county,
        subCounty: listing.subCounty,
        status: "ACTIVE",
        isFeatured: listing.isFeatured ?? false,
        publishedAt: new Date(),
      },
    });
    await prisma.productImage.deleteMany({
      where: { productId: product.id },
    });
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: SEED_IMAGE_URL,
        cloudinaryId: `seed-placeholder:${product.id}`,
        sortOrder: 0,
        isPrimary: true,
      },
    });
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
