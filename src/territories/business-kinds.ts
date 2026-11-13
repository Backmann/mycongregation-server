/**
 * Which places of the map count as businesses (13 November 2026), and the
 * group each belongs to on the list. The kinds are the map's own words
 * (Protomaps' «kind», from OpenStreetMap's shop/amenity/craft/office tags).
 * Kept here, not in the map job, so a kind added here needs no new map run.
 *
 * Left out on purpose: schools, kindergartens, places of worship, memorials,
 * bus stops, parking, parks, artwork — places, not businesses.
 */
export type BusinessGroup = 'shop' | 'food' | 'service' | 'health' | 'lodging';

const GROUPS: Record<BusinessGroup, readonly string[]> = {
  shop: [
    'shop',
    'supermarket',
    'convenience',
    'kiosk',
    'bakery',
    'butcher',
    'greengrocer',
    'deli',
    'confectionery',
    'beverages',
    'alcohol',
    'wine',
    'tea',
    'coffee',
    'seafood',
    'tobacco',
    'e-cigarette',
    'clothes',
    'shoes',
    'bag',
    'boutique',
    'fashion',
    'fabric',
    'jewelry',
    'watches',
    'cosmetics',
    'perfumery',
    'chemist',
    'drugstore',
    'department_store',
    'mall',
    'variety_store',
    'second_hand',
    'charity',
    'gift',
    'books',
    'stationery',
    'newsagent',
    'toys',
    'sports',
    'outdoor',
    'bicycle',
    'car',
    'car_parts',
    'motorcycle',
    'tyres',
    'mobile_phone',
    'electronics',
    'computer',
    'hifi',
    'photo',
    'music',
    'furniture',
    'interior_decoration',
    'kitchen',
    'houseware',
    'hardware',
    'doityourself',
    'garden_centre',
    'florist',
    'pet',
    'craft',
    'frame',
    'art',
    'antiques',
    'ticket',
    'lottery',
    'pawnbroker',
    'wholesale',
    'trade',
    'nutrition_supplements',
    'medical_supply',
    'hearing_aids',
    'optician',
    'erotic',
  ],
  food: [
    'restaurant',
    'cafe',
    'fast_food',
    'pub',
    'bar',
    'biergarten',
    'ice_cream',
    'food_court',
    'nightclub',
  ],
  service: [
    'hairdresser',
    'beauty',
    'massage',
    'tattoo',
    'tailor',
    'laundry',
    'dry_cleaning',
    'copyshop',
    'travel_agency',
    'bank',
    'bureau_de_change',
    'money_lender',
    'post_office',
    'car_repair',
    'car_wash',
    'car_rental',
    'fuel',
    'driving_school',
    'fitness_centre',
    'estate_agent',
    'insurance',
    'lawyer',
    'notary',
    'accountant',
    'tax_advisor',
    'employment_agency',
    'funeral_directors',
    'veterinary',
    'photographer',
    'locksmith',
    'shoemaker',
    'office',
    'company',
  ],
  health: [
    'pharmacy',
    'doctors',
    'dentist',
    'clinic',
    'physiotherapist',
    'alternative',
    'psychotherapist',
    'podiatrist',
    'healthcare',
  ],
  lodging: ['hotel', 'guest_house', 'hostel', 'motel', 'apartment'],
};

const GROUP_OF = new Map<string, BusinessGroup>(
  (Object.entries(GROUPS) as [BusinessGroup, readonly string[]][]).flatMap(
    ([g, kinds]) => kinds.map((k) => [k, g] as [string, BusinessGroup]),
  ),
);

/** The group of a business kind; null for a place that is not a business. */
export function businessGroup(kind: string): BusinessGroup | null {
  return GROUP_OF.get(kind) ?? null;
}

/** Every kind counted as a business, for a query. */
export const BUSINESS_KINDS: readonly string[] = [...GROUP_OF.keys()];

/** The kind a business added by hand may have: a known one, or «other». */
export function handKind(kind: string): string {
  return GROUP_OF.has(kind) ? kind : 'other';
}
