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
  { name: "Vehicles", slug: "vehicles", iconName: "Car" },
  { name: "Property", slug: "property", iconName: "Home" },
  { name: "Furniture", slug: "furniture", iconName: "Sofa" },
  { name: "Home Appliances", slug: "home-appliances", iconName: "WashingMachine" },
  { name: "Beauty", slug: "beauty", iconName: "Sparkles" },
  { name: "Agriculture", slug: "agriculture", iconName: "Wheat" },
  { name: "Jobs", slug: "jobs", iconName: "Briefcase" },
  { name: "Services", slug: "services", iconName: "Wrench" },
  { name: "Sports", slug: "sports", iconName: "Dumbbell" },
  { name: "Books", slug: "books", iconName: "BookOpen" },
  { name: "Kids", slug: "kids", iconName: "Baby" },
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
