import type { OrganizerCategory } from './types';

/**
 * Static vocabulary the generator draws from. Kept out of generate.ts so the
 * generator reads as logic and this reads as content.
 */

export interface CategoryProfile {
  label: string;
  /** Median ticket price in cents; sigma controls the spread. */
  medianTicket: number;
  sigma: number;
  /** Events per quarter for a typical organizer in this category. */
  eventsPerQuarter: [min: number, max: number];
  /** Relative share of sampled charges. */
  volumeWeight: number;
  /** Likelihood this organizer sells at a physical box office with a reader. */
  cardPresentBias: number;
  /** Likelihood buyers are outside the US (touring / destination events). */
  internationalBias: number;
  tiers: string[];
  nameSuffixes: string[];
  venues: string[];
}

export const CATEGORY_PROFILES: Record<OrganizerCategory, CategoryProfile> = {
  fandom_convention: {
    label: 'Fandom convention',
    medianTicket: 7_900,
    sigma: 0.62,
    eventsPerQuarter: [1, 3],
    volumeWeight: 1.6,
    cardPresentBias: 0.24,
    internationalBias: 0.2,
    tiers: ['Single Day', 'Weekend Pass', 'VIP Weekend', 'Early Bird', 'Child'],
    nameSuffixes: ['Fan Expo', 'Fandom Fest', 'Fan Gathering', 'Super Expo'],
    venues: ['Convention Center', 'Exhibition Hall A', 'Grand Pavilion', 'The Armory'],
  },
  comic_convention: {
    label: 'Comic & anime convention',
    medianTicket: 6_500,
    sigma: 0.58,
    eventsPerQuarter: [1, 3],
    volumeWeight: 1.4,
    cardPresentBias: 0.28,
    internationalBias: 0.18,
    tiers: ['Single Day', 'Weekend Pass', 'Artist Alley', 'VIP Weekend', 'Student'],
    nameSuffixes: ['Comic Fest', 'Comics & Anime Expo', 'Panel Fest', 'Ink Expo'],
    venues: ['Convention Center', 'Exhibition Hall B', 'Union Depot', 'Civic Center'],
  },
  immersive_museum: {
    label: 'Immersive / pop-up museum',
    medianTicket: 4_200,
    sigma: 0.44,
    eventsPerQuarter: [1, 2],
    volumeWeight: 1.5,
    cardPresentBias: 0.16,
    internationalBias: 0.14,
    tiers: ['Timed Entry', 'Flex Entry', 'Family 4-Pack', 'Member', 'Late Night'],
    nameSuffixes: ['Immersive', 'Pop-Up Museum', 'Experience', 'House of Wonders'],
    venues: ['Pier 9 Warehouse', 'The Rotunda', 'Old Mill Yard', 'Gallery Level'],
  },
  music_festival: {
    label: 'Music festival',
    medianTicket: 12_800,
    sigma: 0.74,
    eventsPerQuarter: [1, 2],
    volumeWeight: 2.4,
    cardPresentBias: 0.07,
    internationalBias: 0.22,
    tiers: ['General Admission', '3-Day GA', 'VIP', 'Platinum VIP', 'Shuttle Add-On'],
    nameSuffixes: ['Music Festival', 'Sound Festival', 'Amp Fest', 'River Sessions'],
    venues: ['Riverfront Park', 'Main Stage Field', 'Amphitheatre', 'Harbor Pavilion'],
  },
  food_festival: {
    label: 'Food & drink festival',
    medianTicket: 8_800,
    sigma: 0.52,
    eventsPerQuarter: [1, 2],
    volumeWeight: 1.2,
    cardPresentBias: 0.3,
    internationalBias: 0.09,
    tiers: ['Tasting Pass', 'Grand Tasting', 'VIP Tasting', 'Designated Driver'],
    nameSuffixes: ['Food & Wine Festival', 'Taste Festival', 'Street Food Fest'],
    venues: ['Riverfront Park', 'Fairgrounds', 'Grand Pavilion', 'Market Square'],
  },
  haunted_attraction: {
    label: 'Haunted attraction',
    medianTicket: 3_900,
    sigma: 0.41,
    eventsPerQuarter: [2, 4],
    volumeWeight: 1.3,
    cardPresentBias: 0.34,
    internationalBias: 0.05,
    tiers: ['Timed Entry', 'Fast Pass', 'Double Feature', 'Group of 6'],
    nameSuffixes: ['Haunt', 'Haunted Trail', 'Fright Nights', 'Hollow'],
    venues: ['Old Mill Yard', 'Cornfield Lot', 'The Stockyards', 'Hangar 12'],
  },
  holiday_lights: {
    label: 'Holiday light show',
    medianTicket: 4_800,
    sigma: 0.38,
    eventsPerQuarter: [1, 2],
    volumeWeight: 1.4,
    cardPresentBias: 0.12,
    internationalBias: 0.04,
    tiers: ['Per Vehicle', 'Walk-Through', 'Premium Night', 'Season Pass'],
    nameSuffixes: ['Holiday Lights', 'Winter Lights', 'Light Trail', 'Glow Walk'],
    venues: ['Botanical Gardens', 'Fairgrounds', 'Lakeside Loop', 'Sculpture Garden'],
  },
  performing_arts: {
    label: 'Performing arts company',
    medianTicket: 6_900,
    sigma: 0.56,
    eventsPerQuarter: [3, 6],
    volumeWeight: 0.9,
    cardPresentBias: 0.19,
    internationalBias: 0.07,
    tiers: ['Balcony', 'Mezzanine', 'Orchestra', 'Front Row', 'Subscriber'],
    nameSuffixes: ['Ballet Theatre', 'Symphony', 'Playhouse', 'Opera Company'],
    venues: ['Opera House', 'Civic Theatre', 'The Rotunda', 'Concert Hall'],
  },
  minor_league_sports: {
    label: 'Minor-league sports',
    medianTicket: 2_600,
    sigma: 0.46,
    eventsPerQuarter: [8, 14],
    volumeWeight: 1.7,
    cardPresentBias: 0.38,
    internationalBias: 0.03,
    tiers: ['Bleachers', 'Reserved', 'Club Level', 'Season Ticket', 'Kids Zone'],
    nameSuffixes: ['Baseball', 'Hockey', 'Soccer Club', 'Basketball'],
    venues: ['Ballpark', 'The Ice House', 'Municipal Stadium', 'Field House'],
  },
  comedy_club: {
    label: 'Comedy club',
    medianTicket: 3_400,
    sigma: 0.42,
    eventsPerQuarter: [10, 18],
    volumeWeight: 0.8,
    cardPresentBias: 0.31,
    internationalBias: 0.06,
    tiers: ['General Seating', 'Front Table', 'Late Show', 'Two-Drink Package'],
    nameSuffixes: ['Comedy Club', 'Laugh House', 'Comedy Room', 'Improv House'],
    venues: ['Basement Stage', 'Main Room', 'The Loft', 'Back Bar Stage'],
  },
  photo_ops: {
    label: 'Celebrity photo ops',
    medianTicket: 11_500,
    sigma: 0.66,
    eventsPerQuarter: [2, 5],
    volumeWeight: 0.7,
    cardPresentBias: 0.44,
    internationalBias: 0.16,
    tiers: ['Photo Op', 'Autograph', 'Combo', 'Duo Photo', 'Professional Print'],
    nameSuffixes: ['Photo Ops', 'Signing & Photo Ops', 'Photo Experience'],
    venues: ['Exhibition Hall A', 'Convention Center', 'Ballroom C', 'Studio Bay'],
  },
  aquarium_zoo: {
    label: 'Aquarium / zoo',
    medianTicket: 3_200,
    sigma: 0.36,
    eventsPerQuarter: [1, 2],
    volumeWeight: 1.5,
    cardPresentBias: 0.46,
    internationalBias: 0.11,
    tiers: ['Timed Entry', 'Adult', 'Child', 'Family Pass', 'Behind the Scenes'],
    nameSuffixes: ['Aquarium', 'Zoo', 'Wildlife Park', 'Sea Center'],
    venues: ['Main Gate', 'North Entrance', 'Tide Pool Wing', 'Reef Hall'],
  },
  brand_activation: {
    label: 'Brand activation',
    medianTicket: 2_600,
    sigma: 0.8,
    eventsPerQuarter: [2, 4],
    volumeWeight: 0.6,
    cardPresentBias: 0.22,
    internationalBias: 0.12,
    tiers: ['RSVP', 'Merch Drop', 'Hospitality', 'Track Day'],
    nameSuffixes: ['Fan Zone', 'Brand House', 'Experience Lounge', 'Activation'],
    venues: ['Hangar 12', 'Rooftop Deck', 'Paddock Club', 'Pop-Up Lot'],
  },
  renaissance_faire: {
    label: 'Renaissance faire',
    medianTicket: 5_400,
    sigma: 0.48,
    eventsPerQuarter: [2, 5],
    volumeWeight: 1.1,
    cardPresentBias: 0.4,
    internationalBias: 0.05,
    tiers: ['Adult', 'Child', 'Season Pass', 'Feast Seating', 'Joust Reserved'],
    nameSuffixes: ['Renaissance Faire', 'Medieval Faire', 'Highland Games'],
    venues: ['Shire Grounds', 'Joust Field', 'Fairgrounds', 'Greenwood Meadow'],
  },
};

export interface HeroOrganizerSpec {
  name: string;
  category: OrganizerCategory;
  city: string;
  /** Multiplier on the category volume weight — heroes have richer histories. */
  volumeMultiplier: number;
  type: 'express' | 'custom';
}

/**
 * The 14 named organizers the scenarios lean on. Everything about them is fictional.
 * They get more events, longer histories and hand-placed edge cases.
 */
export const HERO_ORGANIZERS: HeroOrganizerSpec[] = [
  { name: 'Nebula Fan Expo', category: 'fandom_convention', city: 'Seattle', volumeMultiplier: 2.4, type: 'custom' },
  { name: 'Ink & Panel Comic Fest', category: 'comic_convention', city: 'Columbus', volumeMultiplier: 2.0, type: 'express' },
  { name: 'Museum of Impossible Things', category: 'immersive_museum', city: 'Chicago', volumeMultiplier: 2.2, type: 'custom' },
  { name: 'Riverlight Music Festival', category: 'music_festival', city: 'Nashville', volumeMultiplier: 3.1, type: 'custom' },
  { name: 'Hollow Creek Haunt', category: 'haunted_attraction', city: 'Louisville', volumeMultiplier: 1.9, type: 'express' },
  { name: 'Ironbridge Ballet Theatre', category: 'performing_arts', city: 'Pittsburgh', volumeMultiplier: 1.5, type: 'express' },
  { name: 'Harbor City Hounds Baseball', category: 'minor_league_sports', city: 'Baltimore', volumeMultiplier: 2.3, type: 'custom' },
  { name: 'Lumina Holiday Lights', category: 'holiday_lights', city: 'Denver', volumeMultiplier: 2.0, type: 'express' },
  { name: "Big Fork Food & Wine Festival", category: 'food_festival', city: 'Portland', volumeMultiplier: 1.7, type: 'express' },
  { name: 'Redline Comedy Club', category: 'comedy_club', city: 'Austin', volumeMultiplier: 1.2, type: 'express' },
  { name: 'Starfield Photo Ops', category: 'photo_ops', city: 'Orlando', volumeMultiplier: 1.4, type: 'custom' },
  { name: 'Cascade Aquarium', category: 'aquarium_zoo', city: 'Tacoma', volumeMultiplier: 2.1, type: 'custom' },
  { name: 'Voltline Energy Fan Zone', category: 'brand_activation', city: 'Charlotte', volumeMultiplier: 1.0, type: 'custom' },
  { name: 'Northgate Renaissance Faire', category: 'renaissance_faire', city: 'Kansas City', volumeMultiplier: 1.6, type: 'express' },
];

/** Place-name fragments for procedurally named organizers. */
export const PLACE_WORDS = [
  'Amberline', 'Bayside', 'Brightwater', 'Cedar Grove', 'Clearwater', 'Copperline',
  'Crown Point', 'Driftwood', 'Eastvale', 'Emberfield', 'Fairhaven', 'Foxglove',
  'Gaslamp', 'Glasswing', 'Goldleaf', 'Granite Bay', 'Harborview', 'Hawthorne',
  'Highwater', 'Ironwood', 'Juniper', 'Kestrel', 'Lakeshore', 'Lanternfield',
  'Larkspur', 'Maplewood', 'Meridian', 'Midtown', 'Moonrise', 'Northstar',
  'Oakfield', 'Orchard Park', 'Pinecrest', 'Quarry Hill', 'Redstone', 'Ridgeway',
  'Rosewood', 'Saltmarsh', 'Sandpiper', 'Silverlake', 'Skyline', 'Sparrow',
  'Stonebridge', 'Summit', 'Sunset Row', 'Thistle', 'Tidewater', 'Union Hill',
  'Westbrook', 'Whitecap', 'Wildwood', 'Willowbrook', 'Windrow', 'Zephyr',
];

/** Mascots for the minor-league organizers. */
export const MASCOTS = [
  'Otters', 'Falcons', 'Rhinos', 'Bison', 'Pelicans', 'Ravens', 'Coyotes',
  'Sturgeon', 'Badgers', 'Kingfishers', 'Mudcats', 'Wolverines', 'Hornets',
];

export const CARD_BRANDS: [string, number][] = [
  ['visa', 49],
  ['mastercard', 32],
  ['amex', 13],
  ['discover', 5],
  ['jcb', 1],
];

/** Non-US issuing countries, weighted toward the usual touring markets. */
export const NON_US_COUNTRIES: [string, number][] = [
  ['CA', 26],
  ['GB', 19],
  ['AU', 11],
  ['DE', 9],
  ['MX', 8],
  ['FR', 7],
  ['JP', 6],
  ['NL', 5],
  ['BR', 5],
  ['IE', 4],
];

/** Issuer decline reasons. Calibrated so expired_card + incorrect_number
 *  land near 0.5% of all attempts — the "outdated card details" bucket. */
export const DECLINE_REASONS: [string, number][] = [
  ['generic_decline', 34],
  ['insufficient_funds', 26],
  ['do_not_honor', 17],
  ['expired_card', 8],
  ['incorrect_number', 7],
  ['card_not_supported', 5],
  ['lost_card', 3],
];

export const DISPUTE_REASONS: [string, number][] = [
  ['fraudulent', 44],
  ['product_not_received', 26],
  ['unrecognized', 12],
  ['duplicate', 9],
  ['general', 6],
  ['subscription_canceled', 3],
];

export const FRAUD_TYPES: [string, number][] = [
  ['made_with_stolen_card', 48],
  ['unauthorized_use_of_card', 27],
  ['made_with_counterfeit_card', 15],
  ['misc', 10],
];

export const READER_DEVICE_TYPES: [string, number][] = [
  ['bbpos_wisepos_e', 46],
  ['stripe_s700', 34],
  ['verifone_P400', 12],
  ['bbpos_chipper2x', 8],
];

export const GATES = [
  'Gate A', 'Gate B', 'Gate C', 'North Gate', 'South Gate', 'Main Entrance',
  'Will Call', 'VIP Entrance',
];

export const SPONSOR_NAMES = [
  'Northwind Beverage Co.',
  'Halcyon Outdoor Gear',
  'Brightline Wireless',
  'Foundry Coffee Roasters',
  'Vantage Regional Bank',
];
