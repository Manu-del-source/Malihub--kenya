/** All 47 Kenyan counties, used for the county filter and listing forms. */
export const KENYA_COUNTIES = [
  "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta",
  "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru",
  "Tharaka-Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua",
  "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
  "Samburu", "Trans Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi",
  "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho",
  "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya",
  "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
] as const;

export type KenyaCounty = (typeof KENYA_COUNTIES)[number];

/** Canonical category list — seeded into the Category table by
 * prisma/seed.ts. Category pages/filters/listing-creation all key off
 * these slugs, so changing this list requires re-running the seed. */
export const DEFAULT_CATEGORIES = [
  { name: "Electronics", slug: "electronics", iconName: "Tv" },
  { name: "Phones", slug: "phones", iconName: "Smartphone" },
  { name: "Fashion", slug: "fashion", iconName: "Shirt" },
  { name: "Shoes & Footwear", slug: "shoes-footwear", iconName: "Footprints" },
  { name: "Furniture", slug: "furniture", iconName: "Sofa" },
  { name: "Home Appliances", slug: "home-appliances", iconName: "WashingMachine" },
  { name: "Computers & Accessories", slug: "computers-accessories", iconName: "Laptop" },
  { name: "Home & Kitchen", slug: "home-kitchen", iconName: "CookingPot" },
  { name: "Bags, Watches & Jewellery", slug: "bags-watches-jewellery", iconName: "Watch" },
  { name: "Grocery & Household", slug: "grocery-household", iconName: "ShoppingBasket" },
  { name: "Automotive & Motorcycles", slug: "automotive-motorcycles", iconName: "Car" },
  { name: "Beauty", slug: "beauty", iconName: "Sparkles" },
  { name: "Agriculture", slug: "agriculture", iconName: "Wheat" },
  { name: "Jobs", slug: "jobs", iconName: "Briefcase" },
  { name: "Services", slug: "services", iconName: "Wrench" },
  { name: "Sports", slug: "sports", iconName: "Dumbbell" },
  { name: "Books", slug: "books", iconName: "BookOpen" },
  { name: "Baby, Kids & Toys", slug: "kids", iconName: "Baby" },
  { name: "Pets", slug: "pets", iconName: "PawPrint" },
  { name: "Other", slug: "other", iconName: "Package" },
] as const;

export const PRODUCT_CONDITIONS = [
  { value: "NEW", label: "Brand New" },
  { value: "LIKE_NEW", label: "Like New" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
] as const;

export const PAGE_SIZE = 24;
export const MAX_LISTING_IMAGES = 8;

/** New seller uploads are limited to five images; existing listings may retain up to eight. */
export const MAX_SELLER_UPLOAD_IMAGES = 5;


/** Initial child taxonomy. Existing category rows and product assignments are
 * preserved; the seed only upserts these stable parent/child relationships. */
export const DEFAULT_CATEGORY_CHILDREN = [
  { name: "Smartphones", slug: "smartphones", parentSlug: "phones" },
  { name: "Tablets", slug: "tablets", parentSlug: "phones" },
  { name: "Phone Accessories", slug: "phone-accessories", parentSlug: "phones" },
  { name: "Audio & Headphones", slug: "audio-headphones", parentSlug: "electronics" },
  { name: "Televisions", slug: "televisions", parentSlug: "electronics" },
  { name: "Cameras", slug: "cameras", parentSlug: "electronics" },
  { name: "Men's Clothing", slug: "mens-clothing", parentSlug: "fashion" },
  { name: "Women's Clothing", slug: "womens-clothing", parentSlug: "fashion" },
  { name: "Men's Shoes", slug: "mens-shoes", parentSlug: "shoes-footwear" },
  { name: "Women's Shoes", slug: "womens-shoes", parentSlug: "shoes-footwear" },
  { name: "Kids' Shoes", slug: "kids-shoes", parentSlug: "shoes-footwear" },
  { name: "Living Room Furniture", slug: "living-room-furniture", parentSlug: "furniture" },
  { name: "Bedroom Furniture", slug: "bedroom-furniture", parentSlug: "furniture" },
  { name: "Office Furniture", slug: "office-furniture", parentSlug: "furniture" },
  { name: "Kitchen Appliances", slug: "kitchen-appliances", parentSlug: "home-appliances" },
  { name: "Laundry Appliances", slug: "laundry-appliances", parentSlug: "home-appliances" },
  { name: "Laptops & Notebooks", slug: "laptops-notebooks", parentSlug: "computers-accessories" },
  { name: "Desktop Computers", slug: "desktop-computers", parentSlug: "computers-accessories" },
  { name: "Computer Accessories", slug: "computer-accessories", parentSlug: "computers-accessories" },
  { name: "Cookware & Dining", slug: "cookware-dining", parentSlug: "home-kitchen" },
  { name: "Home Decor", slug: "home-decor", parentSlug: "home-kitchen" },
  { name: "Bags & Backpacks", slug: "bags-backpacks", parentSlug: "bags-watches-jewellery" },
  { name: "Watches", slug: "watches", parentSlug: "bags-watches-jewellery" },
  { name: "Jewellery", slug: "jewellery", parentSlug: "bags-watches-jewellery" },
  { name: "Baby Care", slug: "baby-care", parentSlug: "kids" },
  { name: "Toys & Games", slug: "toys-games", parentSlug: "baby-kids-toys" },
  { name: "Kids' Clothing", slug: "kids-clothing", parentSlug: "baby-kids-toys" },
  { name: "Food & Pantry", slug: "food-pantry", parentSlug: "grocery-household" },
  { name: "Household Supplies", slug: "household-supplies", parentSlug: "grocery-household" },
  { name: "Car Accessories", slug: "car-accessories", parentSlug: "automotive-motorcycles" },
  { name: "Motorcycle Accessories", slug: "motorcycle-accessories", parentSlug: "automotive-motorcycles" },
] as const;
