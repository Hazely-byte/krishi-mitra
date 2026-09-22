'use strict';

/**
 * Krishi Mitra — Geographic Distance Utility (Haversine Formula)
 * Calculates great-circle distance between two GPS points on Earth in kilometers.
 * Maintains canonical dictionary of Mandi & District coordinates for
 * Chhattisgarh and neighboring border districts.
 */

const DEFAULT_COORDS = { lat: 21.2514, lng: 81.6296 }; // Raipur, CG

const MANDI_COORDS = {
  // Raipur District
  'Neora APMC': { lat: 21.5540, lng: 81.7610 },
  'Kharora APMC': { lat: 21.4394, lng: 81.9328 },
  'Raipur APMC': { lat: 21.2612, lng: 81.6508 },
  'Tilda Neora APMC': { lat: 21.5540, lng: 81.7610 },
  'Abhanpur APMC': { lat: 21.0543, lng: 81.7485 },
  'Arang APMC': { lat: 21.1963, lng: 81.9688 },

  // Durg & Bhilai
  'Durg APMC': { lat: 21.2062, lng: 81.2828 },
  'Dhamdha APMC': { lat: 21.4429, lng: 81.3128 },
  'Patan APMC': { lat: 21.0402, lng: 81.5366 },

  // Bilaspur
  'Bilaspur APMC': { lat: 22.0797, lng: 82.1409 },
  'Kota APMC': { lat: 22.2965, lng: 82.0286 },

  // Rajnandgaon & Khairagarh
  'Rajnandgaon APMC': { lat: 21.0974, lng: 81.0388 },
  'Dongargarh APMC': { lat: 21.1895, lng: 80.7604 },
  'Kheragarh APMC': { lat: 21.4172, lng: 80.9754 },

  // Dhamtari & Mahasamund
  'Dhamtari APMC': { lat: 20.7071, lng: 81.5498 },
  'Kurud APMC': { lat: 20.8252, lng: 81.7144 },
  'Mahasamund APMC': { lat: 21.1085, lng: 82.0968 },
  'Saraipali APMC': { lat: 21.3283, lng: 83.0039 },
  'Bagbahara APMC': { lat: 21.0487, lng: 82.3831 },

  // Baloda Bazar, Bemetara, Balod
  'Baloda Bazar APMC': { lat: 21.6617, lng: 82.1607 },
  'Bhatapara APMC': { lat: 21.7346, lng: 81.9392 },
  'Bemetara APMC': { lat: 21.7011, lng: 81.5334 },
  'Balod APMC': { lat: 20.7297, lng: 81.2057 },
  'Dondi APMC': { lat: 20.5847, lng: 81.0474 },
  'Gurur APMC': { lat: 20.8142, lng: 81.3812 },

  // Kawardha (Kabirdham)
  'Kawardha APMC': { lat: 22.0142, lng: 81.2486 },

  // Korba, Raigarh, Janjgir-Champa
  'Korba APMC': { lat: 22.3595, lng: 82.7501 },
  'Raigarh APMC': { lat: 21.8974, lng: 83.3950 },
  'Janjgir APMC': { lat: 22.0069, lng: 82.5714 },
  'Champa APMC': { lat: 22.0392, lng: 82.6586 },

  // Kanker & Bastar (South CG)
  'Kanker APMC': { lat: 20.2719, lng: 81.4925 },
  'Charama APMC': { lat: 20.4851, lng: 81.3789 },
  'Narharpur APMC': { lat: 20.4072, lng: 81.6575 },
  'Lakhanpuri APMC': { lat: 20.3540, lng: 81.4280 },
  'Bhanupratappur APMC': { lat: 20.3060, lng: 81.0720 },
  'Sambalpur APMC': { lat: 20.2719, lng: 81.4925 },
  'Korar APMC': { lat: 20.4140, lng: 81.4210 },
  'Jagdalpur APMC': { lat: 19.0740, lng: 82.0094 },
  'Bededonger APMC': { lat: 19.7820, lng: 81.6210 },
  'Keshkal APMC': { lat: 20.0841, lng: 81.5912 },
  'Kondagaon APMC': { lat: 19.5960, lng: 81.6705 },

  // North CG
  'Ambikapur APMC': { lat: 23.1189, lng: 83.1979 },
  'Baikunthpur APMC': { lat: 23.2714, lng: 82.5562 },
  'Manendragarh APMC': { lat: 23.2081, lng: 82.2039 },
  'Surajpur APMC': { lat: 23.2206, lng: 82.8687 },
  'Baramkela APMC': { lat: 21.5641, lng: 83.2721 },

  // District-level Fallback Coordinates
  'Raipur': { lat: 21.2514, lng: 81.6296 },
  'Durg': { lat: 21.1904, lng: 81.2849 },
  'Bilaspur': { lat: 22.0797, lng: 82.1409 },
  'Rajnandgaon': { lat: 21.0974, lng: 81.0388 },
  'Dhamtari': { lat: 20.7071, lng: 81.5498 },
  'Mahasamund': { lat: 21.1085, lng: 82.0968 },
  'Baloda Bazar': { lat: 21.6617, lng: 82.1607 },
  'Bemetara': { lat: 21.7011, lng: 81.5334 },
  'Balod': { lat: 20.7297, lng: 81.2057 },
  'Kawardha': { lat: 22.0142, lng: 81.2486 },
  'Kabirdham': { lat: 22.0142, lng: 81.2486 },
  'Korba': { lat: 22.3595, lng: 82.7501 },
  'Raigarh': { lat: 21.8974, lng: 83.3950 },
  'Janjgir-Champa': { lat: 22.0069, lng: 82.5714 },
  'Janjgir': { lat: 22.0069, lng: 82.5714 },
  'Kanker': { lat: 20.2719, lng: 81.4925 },
  'Bastar': { lat: 19.0734, lng: 82.0308 },
  'Kondagaon': { lat: 19.5960, lng: 81.6705 },
  'Khairagarh': { lat: 21.4172, lng: 80.9754 },
  'Khairagarh Chhuikhadan Gandai': { lat: 21.4172, lng: 80.9754 },
  'Surguja': { lat: 23.1189, lng: 83.1979 },
  'Koriya': { lat: 23.2714, lng: 82.5562 },
  'Surajpur': { lat: 23.2206, lng: 82.8687 },
  'Sarangarh Bilaigarh': { lat: 21.5937, lng: 83.0768 },
  'Manendragarh Chirmiri Bhartpur': { lat: 23.2081, lng: 82.2039 },

  // Bordering States Hubs (within or near 300km)
  'Nuapada': { lat: 20.8415, lng: 82.5317 },
  'Bargarh': { lat: 21.3323, lng: 83.6217 },
  'Sambalpur': { lat: 21.4669, lng: 83.9812 },
  'Jharsuguda': { lat: 21.8554, lng: 84.0062 },
  'Balaghat': { lat: 21.8129, lng: 80.1838 },
  'Gondia': { lat: 21.4588, lng: 80.1961 },
  'Bhandara': { lat: 21.1711, lng: 79.6548 },
  'Nagpur': { lat: 21.1458, lng: 79.0882 },
  'Mandla': { lat: 22.5982, lng: 80.3707 },
  'Jabalpur': { lat: 23.1815, lng: 79.9864 },
  'Seoni': { lat: 22.0869, lng: 79.5435 },
  'Shahdol': { lat: 23.2954, lng: 81.3562 },
  'Anuppur': { lat: 23.1042, lng: 81.6917 }
};

/**
 * Calculate distance in km between two lat/lng pairs via Haversine formula
 */
function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Round to 1 decimal place
}

/**
 * Lookup coordinates for a mandi / market and district.
 * Checks exact market name first, then clean APMC name, then district.
 */
function getMandiCoordinates(market, district) {
  if (market) {
    const mTrim = market.trim();
    if (MANDI_COORDS[mTrim]) return MANDI_COORDS[mTrim];

    // Try stripping/adding 'APMC'
    if (!mTrim.includes('APMC') && MANDI_COORDS[`${mTrim} APMC`]) {
      return MANDI_COORDS[`${mTrim} APMC`];
    }
    const cleanName = mTrim.replace(/\s+APMC$/i, '').trim();
    if (MANDI_COORDS[cleanName]) return MANDI_COORDS[cleanName];
  }

  if (district) {
    const dTrim = district.trim();
    if (MANDI_COORDS[dTrim]) return MANDI_COORDS[dTrim];

    // Check case-insensitive
    const lowerD = dTrim.toLowerCase();
    for (const [k, v] of Object.entries(MANDI_COORDS)) {
      if (k.toLowerCase() === lowerD) return v;
    }
  }

  return null;
}

module.exports = {
  DEFAULT_COORDS,
  MANDI_COORDS,
  calculateHaversineDistanceKm,
  getMandiCoordinates
};
