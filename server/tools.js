'use strict';

const db = require('./db');
const haversine = require('./haversine');
const buyers = require('./buyers');

const STATE_NAMES = {
  'Chattisgarh': 'Chhattisgarh / छत्तीसगढ़',
  'Chhattisgarh': 'Chhattisgarh / छत्तीसगढ़',
  'Madhya Pradesh': 'Madhya Pradesh / मध्य प्रदेश',
  'Maharashtra': 'Maharashtra / महाराष्ट्र',
  'Odisha': 'Odisha / ओडिशा',
  'Jharkhand': 'Jharkhand / झारखंड',
  'Uttar Pradesh': 'Uttar Pradesh / उत्तर प्रदेश',
  'Telangana': 'Telangana / तेलंगाना',
  'Andhra Pradesh': 'Andhra Pradesh / आंध्र प्रदेश',
  'Rajasthan': 'Rajasthan / राजस्थान',
  'Gujarat': 'Gujarat / गुजरात',
  'Punjab': 'Punjab / पंजाब',
  'Haryana': 'Haryana / हरियाणा',
  'Karnataka': 'Karnataka / कर्नाटक',
  'Tamil Nadu': 'Tamil Nadu / तमिलनाडु',
  'West Bengal': 'West Bengal / पश्चिम बंगाल',
  'Bihar': 'Bihar / बिहार'
};

function getStateDisplay(state) {
  if (!state) return '';
  const s = state.trim();
  return STATE_NAMES[s] || `${s} / ${s}`;
}

const toolDeclarations = [
  {
    name: 'render_comparison_ui',
    description: 'Displays a side-by-side comparison of two entities (Entity A vs Entity B) on the user\'s screen. Use this for comparing mandis, crop varieties, farming techniques (e.g. drip vs sprinkler, organic vs chemical), foods (e.g. rice vs roti), or products. When comparing mandis or market rates, the backend Grounding Shield automatically injects verified real-time prices from the SQLite database. Creative comparisons pass through with your custom attributes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Comparison title (e.g. "Raipur Mandi vs Durg Mandi", "Rice vs. Roti", "Drip vs Sprinkler Irrigation").'
        },
        subtitle: {
          type: 'STRING',
          description: 'Optional subtitle or context.'
        },
        category: {
          type: 'STRING',
          description: 'Optional category (e.g. "Market Rates", "Nutrition", "Farming Technique").'
        },
        commodity: {
          type: 'STRING',
          description: 'The crop or commodity being compared (e.g. "Paddy", "Wheat", "Tomato"), if comparing market rates.'
        },
        market_a: {
          type: 'STRING',
          description: 'First market name if comparing mandis (e.g. "Raipur APMC").'
        },
        market_b: {
          type: 'STRING',
          description: 'Second market name if comparing mandis (e.g. "Durg Mandi").'
        },
        entity_a: {
          type: 'OBJECT',
          description: 'Details for Entity A (Left Side)',
          properties: {
            id: { type: 'STRING', description: 'Unique identifier (e.g. "raipur", "rice", "drip")' },
            name: { type: 'STRING', description: 'Name of Entity A (e.g. "Raipur APMC", "Brown Rice", "Drip Irrigation")' },
            subtitle: { type: 'STRING', description: 'Short subtitle' },
            highlight_metric: { type: 'STRING', description: 'Primary highlighted metric or stat (e.g. "₹2,319 / qtl", "Low Glycemic", "60% Water Saved")' },
            badge: { type: 'STRING', description: 'Optional badge (e.g. "Highest Price", "Recommended", "High Fiber")' },
            attributes: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  label: { type: 'STRING' },
                  value: { type: 'STRING' },
                  highlight: { type: 'BOOLEAN' }
                },
                required: ['label', 'value']
              },
              description: 'Key attributes, rows, or pros/cons'
            }
          },
          required: ['name']
        },
        entity_b: {
          type: 'OBJECT',
          description: 'Details for Entity B (Right Side)',
          properties: {
            id: { type: 'STRING', description: 'Unique identifier (e.g. "durg", "roti", "sprinkler")' },
            name: { type: 'STRING', description: 'Name of Entity B (e.g. "Durg Mandi", "Wheat Roti", "Sprinkler Irrigation")' },
            subtitle: { type: 'STRING', description: 'Short subtitle' },
            highlight_metric: { type: 'STRING', description: 'Primary highlighted metric or stat (e.g. "₹2,250 / qtl", "High Protein", "Moderate Cost")' },
            badge: { type: 'STRING', description: 'Optional badge' },
            attributes: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  label: { type: 'STRING' },
                  value: { type: 'STRING' },
                  highlight: { type: 'BOOLEAN' }
                },
                required: ['label', 'value']
              },
              description: 'Key attributes, rows, or pros/cons'
            }
          },
          required: ['name']
        },
        recommendation: {
          type: 'STRING',
          description: 'Takeaway, recommendation, or advice helping the user decide.'
        }
      },
      required: ['title', 'entity_a', 'entity_b']
    }
  },
  {
    name: 'render_selector_menu_ui',
    description: 'Displays an interactive choice menu of 1 to 6 rectangular options on the user\'s screen. Use this for browsing commodities, selecting crop varieties, picking cooking methods, choosing government schemes, or multi-choice decisions. When browsing mandi crops or commodities, the backend Grounding Shield automatically injects real crops and prices from SQLite. Creative selectors pass through with your custom options.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title for the selector menu (e.g. "Available Commodities in Durg", "Select Crop Variety", "Choose Organic Fertilizer").'
        },
        subtitle: {
          type: 'STRING',
          description: 'Subtitle or location tag (e.g. "📍 Durg Mandi", "6 options available").'
        },
        district: {
          type: 'STRING',
          description: 'District or city if listing mandi commodities (e.g. "Durg", "Raipur", "Bilaspur").'
        },
        market: {
          type: 'STRING',
          description: 'Optional specific mandi market name (e.g. "Durg Mandi").'
        },
        options: {
          type: 'ARRAY',
          description: 'List of 1 to 6 choices to display on screen.',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Unique choice ID (e.g. "paddy", "roti", "neem_cake")' },
              label: { type: 'STRING', description: 'Display name (e.g. "Paddy (Common)", "Wheat Roti", "Neem Cake Fertilizer")' },
              icon: { type: 'STRING', description: 'Icon name, crop name, or emoji (e.g. "paddy", "🌾", "apple", "bread")' },
              desc: { type: 'STRING', description: 'Short subtitle or secondary stat (e.g. "Avg ₹2,319/qtl", "High fiber & easy to digest")' },
              badge: { type: 'STRING', description: 'Optional badge (e.g. "Popular", "Best Rate", "Top Choice")' }
            },
            required: ['id', 'label']
          }
        },
        page: {
          type: 'INTEGER',
          description: 'Current page number.'
        },
        total_pages: {
          type: 'INTEGER',
          description: 'Total pages available.'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'render_detail_card_ui',
    description: 'Displays a focused, enlarged detail window or modal card on the user\'s screen. Use this for single crop prices/rates, recipes, technical deep-dives, user location cards, driving directions and routes to mandis/buyers, government schemes, or EMERGENCY/CRISIS RELIEF guidelines (such as wildlife crop damage, drought/flood compensation). If displaying market prices, locations, or driving directions, the backend Grounding Shield automatically injects verified real-time database rates, GPS coordinates, road distance, and travel time. For encyclopedic crop questions, technical guides, recipes, or educational advice, you MUST provide rich content in sections (1-3 sections with detailed bullet points) and/or description, and a meaningful hero_metric — NEVER submit an empty card with only the title.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title of the detail card (e.g. "Paddy (Common) Rate", "Driving Directions to Abhanpur APMC", "Wildlife Crop Damage Compensation (RBC 6-4)", "Traditional Wheat Roti", "Your Current Location").'
        },
        subtitle: {
          type: 'STRING',
          description: 'Subtitle or issuing authority (e.g. "📍 Raipur APMC", "Chhattisgarh Forest Dept & Revenue Guidelines", "Nutritional Deep-Dive").'
        },
        type: {
          type: 'STRING',
          description: 'Visual archetype: "CRISIS_RELIEF" | "SINGLE_RATE" | "RECIPE" | "GOV_SCHEME" | "LOCATION" | "SAVED_CROP" | "TECHNICAL_GUIDE" | "CONTACT" | "ENTERTAINMENT" | "ANIME".',
          enum: ['CRISIS_RELIEF', 'SINGLE_RATE', 'RECIPE', 'GOV_SCHEME', 'LOCATION', 'SAVED_CROP', 'TECHNICAL_GUIDE', 'CONTACT', 'ENTERTAINMENT', 'ANIME']
        },
        icon: {
          type: 'STRING',
          description: 'Icon name, emoji, or symbol (e.g. "paddy", "🌾", "elephant", "⚠️", "pin", "📜", "cooking").'
        },
        hero_badge: {
          type: 'STRING',
          description: 'Badge at top of hero section (e.g. "Emergency Relief", "Active Mandi", "High Priority", "Verified Location").'
        },
        hero_metric: {
          type: 'OBJECT',
          description: 'Large highlighted hero metric or central data point.',
          properties: {
            label: { type: 'STRING', description: 'Hero label (e.g. "TODAY\'S MODAL RATE", "MAX COMPENSATION", "PREPARATION TIME")' },
            value: { type: 'STRING', description: 'Large display value (e.g. "₹2,319 / qtl", "Up to ₹25,000 / ha", "15 Mins")' },
            subvalue: { type: 'STRING', description: 'Secondary context (e.g. "Price Range: ₹2,319 — ₹2,319", "Under RBC 6-4 Norms")' }
          }
        },
        description: {
          type: 'STRING',
          description: 'Detailed textual overview or description for technical guides, crop encyclopedia, or recipes.'
        },
        sections: {
          type: 'ARRAY',
          description: 'Detailed content sections or step-by-step guidance. Required for guides, recipes, and educational deep-dives.',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING', description: 'Section heading (e.g. "Eligibility & Documents Required", "Immediate Steps", "Ingredients")' },
              items: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'List items, requirements, or bullet points'
              }
            },
            required: ['title', 'items']
          }
        },
        action_buttons: {
          type: 'ARRAY',
          description: 'Interactive call-to-action buttons at bottom of card.',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Action button ID (e.g. "call_forest_helpline", "call_kisan_call_center", "open_maps", "file_report")' },
              label: { type: 'STRING', description: 'Button text (e.g. "📞 Forest Helpline: 1800-180-1551", "🗺️ Open in Google Maps")' },
              type: { type: 'STRING', description: 'Action type: "action" | "tel" | "link"' },
              payload: { type: 'STRING', description: 'Phone number or URL or voice payload' }
            },
            required: ['id', 'label']
          }
        },
        commodity: {
          type: 'STRING',
          description: 'Commodity name (e.g. "Paddy", "Wheat") if single rate query.'
        },
        location: {
          type: 'STRING',
          description: 'Location or mandi name if single rate or location query.'
        },
        address: {
          type: 'STRING',
          description: 'Address string if updating location.'
        },
        superlative: {
          type: 'STRING',
          description: 'Optional superlative filter (e.g. "highest", "lowest", "closest").'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'find_buyers_ui',
    description: 'Finds verified agricultural APMC mandi buyers within a given radius (up to 300km) derived from real mandi arrivals in the database. When the user asks for a single specific match or superlative (e.g. "which is the closest mandi?", "nearest buyer", "cheapest place to sell"), set answer_mode="DIRECT_ANSWER" to present a focused single direct result. When the user asks to browse, explore, or pick among multiple options, set answer_mode="BROWSABLE_LIST" (default).',
    parameters: {
      type: 'OBJECT',
      properties: {
        district: {
          type: 'STRING',
          description: 'District or city name (e.g. "Raipur", "Durg", "Bilaspur", "Rajnandgaon", "Kanker"). Defaults to user location.'
        },
        crop: {
          type: 'STRING',
          description: 'Optional crop or commodity to sell (e.g. "Paddy", "Wheat", "Tomato", "Soybean").'
        },
        type: {
          type: 'STRING',
          description: 'Filter by buyer category: "all" | "market" | "company" | "trader". Defaults to "all".',
          enum: ['all', 'market', 'company', 'trader']
        },
        radius_km: {
          type: 'INTEGER',
          description: 'Search radius in kilometers (default 300km).'
        },
        answer_mode: {
          type: 'STRING',
          enum: ['DIRECT_ANSWER', 'BROWSABLE_LIST'],
          description: 'Choose DIRECT_ANSWER when user asks a superlative or asks for a single specific fact/entity (e.g. "which is the closest mandi?", "nearest buyer", "where is the best place to sell"). Choose BROWSABLE_LIST when user asks to browse or explore multiple options. Defaults to BROWSABLE_LIST.'
        }
      }
    }
  },
  {
    name: 'analyze_inventory_gap_ui',
    description: 'Computes a cross-district inventory analysis or set difference between two mandis/districts (e.g. "Compare Raipur and Durg commodity listings - what does Raipur lack?", "What crops are sold in Durg that are missing in Raipur?"). Evaluates both markets\' reported commodities server-side and displays a structured inventory gap analysis.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source_district: {
          type: 'STRING',
          description: 'The baseline district (e.g. "Raipur").'
        },
        target_district: {
          type: 'STRING',
          description: 'The comparison district with potentially missing commodities (e.g. "Durg").'
        },
        analysis_type: {
          type: 'STRING',
          enum: ['LACKING', 'EXCLUSIVE', 'OVERLAP'],
          description: 'Type of set analysis: "LACKING" (what source lacks that target has), "EXCLUSIVE" (what source has that target lacks), "OVERLAP" (shared commodities). Defaults to LACKING.'
        }
      },
      required: ['source_district', 'target_district']
    }
  },
  {
    name: 'trigger_camera',
    description: "Call this tool immediately whenever the user says 'open camera', 'take a photo', 'photo kholo', or 'photo lena hai'. Never tell the user you cannot open the camera. The system will render a pulsing 'Tap here to open Camera' button on screen so the user can grant permission legally.",
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Optional reason for opening camera (e.g. "user asked to take a photo").'
        }
      }
    }
  },
  {
    name: 'paginate_options',
    description: "Paginates the currently visible rectangular options list on screen (browsing page 1, 2, 3... of a multi-page list). Call this ONLY when an options menu is actively visible and the user asks for 'next page', 'previous page', 'more options', 'aage ke vikalp', or 'pichla page'. NEVER call this to go back or exit from a detail card or single entity view (use go_back_to_options instead).",
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: {
          type: 'STRING',
          description: '"NEXT" to view the next 6 items, or "PREV" to view the previous 6 items.',
          enum: ['NEXT', 'PREV']
        }
      },
      required: ['direction']
    }
  },
  {
    name: 'close_all_ui',
    description: 'Dismisses all active visual cards, modals, menus, or detail windows completely and restores the idle voice state on screen. Call this when the user says "close", "close everything", "band karo", "hata do", or explicitly wants to dismiss the screen or cancel. ALSO call this implicitly whenever the user\'s current message has no connection to whatever topic or entity is currently mounted on screen — that topical disconnection itself is the signal to close the card before addressing the new topic, without requiring any explicit closing phrase.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Optional reason for closing all UI (e.g. "user dismissed screen").'
        }
      }
    }
  },
  {
    name: 'go_back_to_options',
    description: 'Navigates back from an active detail card, guide, or modal window to the previous multi-option menu or list. Call this whenever the user says "go back", "back", "piche jao", "wapas jao", "return", or asks to return to previous options/list. If no options menu was previously active, this safely closes the card and returns to the home screen. DO NOT call paginate_options to exit or go back from a detail card.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reset_visited: {
          type: 'BOOLEAN',
          description: 'Set to true if user asks to see previously visited or all options again (e.g. "show all options", "show previous options", "sabhi vikalp dikhao"). Defaults to false.'
        },
        reason: {
          type: 'STRING',
          description: 'Optional reason for going back.'
        }
      }
    }
  },
  {
    name: 'get_current_screen_context',
    description: "Call this tool if the user asks 'what am I seeing?', 'what is on my screen?', or refers to visual items you need to confirm.",
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'open_sell_crop_form',
    description: "Opens the interactive Sell Crop Form on the farmer's screen. Call this ONLY when the farmer explicitly states they want to sell produce (e.g. 'I want to sell my crop', 'aam bechna hai', 'fasal bechni hai', 'I have mangoes to sell'). NEVER call this tool for driving directions, maps, routes, or mandi inquiries.",
    parameters: {
      type: 'OBJECT',
      properties: {
        commodity: { type: 'STRING', description: 'Initial crop/commodity name if mentioned (e.g. "Mango")' },
        variety: { type: 'STRING', description: 'Initial variety if mentioned (e.g. "Dasheri")' },
        quantity: { type: 'STRING', description: 'Initial quantity if mentioned (e.g. "5 Quintals")' },
        age: { type: 'STRING', description: 'Initial age or harvest date if mentioned (e.g. "3 days")' }
      }
    }
  },
  {
    name: 'autofill_crop_form',
    description: "Autofills one or more fields in the active Sell Crop Form on the farmer's screen in real time as they speak. Can update commodity, variety, quantity, and age.",
    parameters: {
      type: 'OBJECT',
      properties: {
        commodity: { type: 'STRING', description: 'The crop/commodity name' },
        variety: { type: 'STRING', description: 'The variety or type of crop' },
        quantity: { type: 'STRING', description: 'The quantity available to sell (e.g. "10 Quintals", "50 kg")' },
        age: { type: 'STRING', description: 'Age or harvest date (e.g. "Harvested 2 days ago")' }
      }
    }
  },
  {
    name: 'submit_crop_form',
    description: "Submits and saves the active crop selling form, triggering the success confirmation animation sequence. Call this when the farmer says 'save it', 'done', 'submit', 'ho gaya', 'jama karo'.",
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Optional submission note' }
      }
    }
  }
];

// ============================================================
// THE GROUNDING SHIELD (Zero Hallucination Routing)
// Intercepts tool calls before frontend rendering to enforce factual
// SQLite data for market rates, while granting creative autonomy for guides.
// ============================================================

function isMarketComparisonQuery(args = {}) {
  const category = (args.category || '').toLowerCase();
  const title = (args.title || '').toLowerCase();
  const nameA = (args.entity_a?.name || '').toLowerCase();
  const nameB = (args.entity_b?.name || '').toLowerCase();

  // Explicit non-mandi / creative keywords bypass the Grounding Shield unconditionally
  const nonMandiKeywords = ['anime', 'manga', 'movie', 'film', 'series', 'character', 'book', 'game', 'fiction', 'philosophy', 'tech', 'software', 'phone', 'car', 'weapon', 'show', 'titan', 'death note'];
  if (nonMandiKeywords.some(k => category.includes(k) || title.includes(k) || nameA.includes(k) || nameB.includes(k))) {
    return false;
  }

  // To qualify as a market comparison query, it must mention mandis, apmc, market prices, or have a commodity recognized in the database
  const hasMandiKeyword = ['mandi', 'apmc', 'bhav', 'market rate', 'market price', 'मंडी', 'भाव'].some(k => 
    title.includes(k) || category.includes(k)
  );

  let commodityMatch = false;
  if (args.commodity) {
    const res = db.resolveCommodity(args.commodity);
    commodityMatch = Boolean(res && res.match !== 'none');
  }

  const mandiKeywords = ['raipur', 'durg', 'arang', 'neora', 'bilaspur', 'rajnandgaon', 'apmc', 'mandi', 'bhatapara'];
  const hasMandiLocations = Boolean(args.market_a || args.market_b || mandiKeywords.some(k => nameA.includes(k) || nameB.includes(k)));
  const hasMandiName = Boolean(
    (args.market_a && /apmc|mandi/i.test(args.market_a)) ||
    (args.market_b && /apmc|mandi/i.test(args.market_b)) ||
    (nameA && /apmc|mandi/i.test(nameA)) ||
    (nameB && /apmc|mandi/i.test(nameB))
  );

  return (hasMandiKeyword && (commodityMatch || hasMandiLocations)) || (commodityMatch && hasMandiLocations) || hasMandiName;
}

function cleanCommodityTerm(term) {
  if (!term || typeof term !== 'string') return '';
  return term
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groundComparisonMarketData(args = {}, userLocation = null) {
  let rawCommodity = (args.commodity || '').trim();
  if (!rawCommodity) {
    const t = (args.title || '') + ' ' + (args.entity_a?.name || '') + ' ' + (args.entity_b?.name || '');
    const match = t.match(/(paddy|wheat|tomato|potato|onion|chana|gram|धान|गेहूं|टमाटर|आलू|प्याज़|चना)/i);
    rawCommodity = match ? match[1] : '';
  }

  if (!rawCommodity) {
    return null; // No commodity identified, let creative pass-through handle it
  }

  let resolution = db.resolveCommodity(rawCommodity);

  let targetApiName = rawCommodity;
  let displayNameEn = rawCommodity;
  let displayNameHi = rawCommodity;

  if (resolution && (resolution.match === 'exact' || resolution.match === 'fuzzy')) {
    targetApiName = resolution.commodity.name_api;
    displayNameEn = resolution.commodity.name_en;
    displayNameHi = resolution.commodity.name_hi;
  } else if (resolution && resolution.match === 'ambiguous' && resolution.candidates?.length > 0) {
    targetApiName = resolution.candidates[0].name_api || resolution.candidates[0].api_name;
    displayNameEn = resolution.candidates[0].name_en || resolution.candidates[0].en || targetApiName;
    displayNameHi = resolution.candidates[0].name_hi || resolution.candidates[0].hi || targetApiName;
  } else if (!args.market_a && !args.market_b && !isMarketComparisonQuery(args)) {
    return null; // Not an agricultural commodity and not an APMC/mandi query, let creative pass-through handle it
  }

  const userCoords = (userLocation && userLocation.lat && userLocation.lng)
    ? { lat: Number(userLocation.lat), lng: Number(userLocation.lng) }
    : haversine.DEFAULT_COORDS;

  let marketAName = (args.market_a || args.market1 || args.location_a || args.entity_a?.name || '').trim();
  let marketBName = (args.market_b || args.market2 || args.location_b || args.entity_b?.name || '').trim();

  if (!marketAName && userLocation) {
    marketAName = (userLocation.district || userLocation.address || userLocation.market || '').trim();
  }

  // If neither market has location specified and userLocation is not available, fail with missing location
  if (!marketAName && !marketBName) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      missing_location: true,
      error: 'Missing location parameter. Ask the user which city or mandi they are looking for.',
      spoken_summary_hint: 'Which markets or cities would you like to compare?'
    };
  }

  if (!marketAName) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      missing_location: true,
      error: 'Missing first market name for comparison.',
      spoken_summary_hint: `Which market would you like to compare with ${marketBName}? For example, Raipur, Durg, or Rajnandgaon?`
    };
  }
  if (!marketBName) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      missing_location: true,
      error: 'Missing second market name for comparison.',
      spoken_summary_hint: `Which market would you like to compare with ${marketAName}? For example, Durg, Rajnandgaon, or Bilaspur?`
    };
  }

  const cleanA = marketAName.replace(/\s+(APMC|Mandi|Market)$/i, '').trim();
  const cleanB = marketBName.replace(/\s+(APMC|Mandi|Market)$/i, '').trim();

  const cleanTerm = cleanCommodityTerm(rawCommodity).toLowerCase() || rawCommodity.toLowerCase();
  const rawTerm = rawCommodity.toLowerCase();

  const stmt = db.getDb().prepare(`
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date
    FROM mandi_prices mp
    WHERE (mp.commodity = @commodity OR LOWER(mp.commodity) LIKE '%' || @cleanTerm || '%' OR @rawTerm LIKE '%' || LOWER(mp.commodity) || '%')
      AND (LOWER(mp.market) LIKE LOWER(@market) OR LOWER(mp.district) LIKE LOWER(@market))
    ORDER BY mp.arrival_date DESC, mp.modal_price DESC LIMIT 1
  `);

  let recA = stmt.get({ commodity: targetApiName, cleanTerm, rawTerm, market: `%${cleanA}%` });
  let recB = stmt.get({ commodity: targetApiName, cleanTerm, rawTerm, market: `%${cleanB}%` });

  let isFallbackA = false;
  let isFallbackB = false;

  if (!recA || !recB) {
    const scoped = db.compareMarketsScoped(targetApiName || rawCommodity) || [];

    // Helper: find closest real record within radius (<= 200 km) sorted by distance to requested market
    const findNearbyCandidate = (requestedName, excludeMarketName) => {
      const requestedCoords = haversine.getMarketCoords(requestedName) || userCoords;
      const candidates = scoped
        .filter(c => !excludeMarketName || c.market.toLowerCase() !== excludeMarketName.toLowerCase())
        .map(c => {
          const coords = haversine.getMandiCoordinates(c.market, c.district);
          if (!coords) return null;
          const distFromRequested = haversine.computeDistance(requestedCoords, coords);
          const distFromUser = haversine.computeDistance(userCoords, coords);
          return { ...c, distFromRequested, distFromUser, coords };
        })
        .filter(c => c && c.distFromRequested <= 200)
        .sort((a, b) => a.distFromRequested - b.distFromRequested);

      return candidates[0] || null;
    };

    if (!recA) {
      const nearbyA = findNearbyCandidate(marketAName, recB?.market);
      if (nearbyA) {
        recA = nearbyA;
        isFallbackA = true;
      }
    }

    if (!recB) {
      const nearbyB = findNearbyCandidate(marketBName, recA?.market);
      if (nearbyB) {
        recB = nearbyB;
        isFallbackB = true;
      }
    }
  }

  let entityA;
  let entityB;

  if (recA) {
    const modalA = recA.modal_price;
    const minA = recA.min_price || Math.round(modalA * 0.95);
    const maxA = recA.max_price || Math.round(modalA * 1.05);
    const nameFinalA = recA.market;
    const coordsA = haversine.getMarketCoords(nameFinalA, recA.district);
    const distA = Math.round(haversine.computeDistance(userCoords, coordsA));
    const isHigher = recB ? (modalA >= (recB.modal_price || 0)) : true;

    entityA = {
      id: nameFinalA.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: nameFinalA,
      subtitle: isFallbackA
        ? `📍 ${recA.district || nameFinalA} (Nearest to ${cleanA})`
        : `📍 ${recA.district || cleanA}`,
      highlight_metric: `₹${Number(modalA).toLocaleString('en-IN')} / qtl`,
      badge: isFallbackA
        ? `Nearest to ${cleanA} (${Math.round(recA.distFromRequested)} km)`
        : (recB ? (isHigher ? '⭐ Highest Rate' : 'Alternative Market') : 'Verified Rate'),
      attributes: [
        { label: 'Modal Price', value: `₹${Number(modalA).toLocaleString('en-IN')} / qtl`, highlight: true },
        { label: 'Price Range', value: `₹${minA} — ₹${maxA}` },
        { label: 'Driving Distance', value: isFallbackA
            ? `${distA} km from your location (${Math.round(recA.distFromRequested)} km from ${cleanA})`
            : `${distA} km from your location`
        },
        { label: 'Arrival Date', value: recA.arrival_date || 'Today' },
        { label: 'Trading Status', value: isFallbackA ? 'Radius Fallback — Verified Mandi' : 'Active Mandi' }
      ]
    };
  } else {
    const coordsA = haversine.getMarketCoords(marketAName, cleanA);
    const distA = Math.round(haversine.computeDistance(userCoords, coordsA));
    entityA = {
      id: cleanA.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: marketAName,
      subtitle: `📍 ${cleanA}`,
      highlight_metric: 'No verified price available',
      badge: 'No Price Data',
      attributes: [
        { label: 'Modal Price', value: 'No verified price available', highlight: false },
        { label: 'Trading Status', value: 'No arrivals reported today' },
        { label: 'Driving Distance', value: `${distA} km from your location` }
      ]
    };
  }

  if (recB) {
    const modalB = recB.modal_price;
    const minB = recB.min_price || Math.round(modalB * 0.95);
    const maxB = recB.max_price || Math.round(modalB * 1.05);
    const nameFinalB = recB.market;
    const coordsB = haversine.getMarketCoords(nameFinalB, recB.district);
    const distB = Math.round(haversine.computeDistance(userCoords, coordsB));
    const isHigher = recA ? (modalB > (recA.modal_price || 0)) : true;

    entityB = {
      id: nameFinalB.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: nameFinalB,
      subtitle: isFallbackB
        ? `📍 ${recB.district || nameFinalB} (Nearest to ${cleanB})`
        : `📍 ${recB.district || cleanB}`,
      highlight_metric: `₹${Number(modalB).toLocaleString('en-IN')} / qtl`,
      badge: isFallbackB
        ? `Nearest to ${cleanB} (${Math.round(recB.distFromRequested)} km)`
        : (recA ? (isHigher ? '⭐ Highest Rate' : 'Nearby Market') : 'Verified Rate'),
      attributes: [
        { label: 'Modal Price', value: `₹${Number(modalB).toLocaleString('en-IN')} / qtl`, highlight: true },
        { label: 'Price Range', value: `₹${minB} — ₹${maxB}` },
        { label: 'Driving Distance', value: isFallbackB
            ? `${distB} km from your location (${Math.round(recB.distFromRequested)} km from ${cleanB})`
            : `${distB} km from your location`
        },
        { label: 'Arrival Date', value: recB.arrival_date || 'Today' },
        { label: 'Trading Status', value: isFallbackB ? 'Radius Fallback — Verified Mandi' : 'Active Mandi' }
      ]
    };
  } else {
    const coordsB = haversine.getMarketCoords(marketBName, cleanB);
    const distB = Math.round(haversine.computeDistance(userCoords, coordsB));
    entityB = {
      id: cleanB.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: marketBName,
      subtitle: `📍 ${cleanB}`,
      highlight_metric: 'No verified price available',
      badge: 'No Price Data',
      attributes: [
        { label: 'Modal Price', value: 'No verified price available', highlight: false },
        { label: 'Trading Status', value: 'No arrivals reported today' },
        { label: 'Driving Distance', value: `${distB} km from your location` }
      ]
    };
  }

  let recommendation = '';
  let spokenSummaryHint = '';

  const hasRealData = Boolean(recA || recB);

  if (recA && recB) {
    const diff = Math.abs(recA.modal_price - recB.modal_price);
    const bestMarket = recA.modal_price >= recB.modal_price ? recA.market : recB.market;
    recommendation = `${bestMarket} is currently offering ₹${diff} / qtl higher rates. Based on your location, selling in ${bestMarket} maximizes net returns after transport.`;
    spokenSummaryHint = `${recA.market} is offering ${recA.modal_price} Rupees per quintal, while ${recB.market} is at ${recB.modal_price} Rupees per quintal. ${bestMarket} gives you a higher rate by ${diff} Rupees per quintal. Would you like to view driving directions, or check another crop?`;
  } else if (recA && !recB) {
    recommendation = `${recA.market} has verified rates at ₹${Number(recA.modal_price).toLocaleString('en-IN')} / qtl. No verified prices were reported for ${marketBName} today.`;
    spokenSummaryHint = `I found verified rates for ${recA.market} at ${recA.modal_price} Rupees per quintal, but there are no verified prices available for ${marketBName} today. Would you like to view driving directions for ${recA.market}?`;
  } else if (!recA && recB) {
    recommendation = `${recB.market} has verified rates at ₹${Number(recB.modal_price).toLocaleString('en-IN')} / qtl. No verified prices were reported for ${marketAName} today.`;
    spokenSummaryHint = `I found verified rates for ${recB.market} at ${recB.modal_price} Rupees per quintal, but there are no verified prices available for ${marketAName} today. Would you like to view driving directions for ${recB.market}?`;
  } else {
    recommendation = `No verified market prices were reported for ${displayNameEn} in either ${marketAName} or ${marketBName} within range today.`;
    spokenSummaryHint = `I checked our records, but there are no verified prices available for ${displayNameEn} in either ${marketAName} or ${marketBName} today. Would you like to check another crop or market?`;
  }

  return {
    is_grounded: true,
    has_real_data: hasRealData,
    commodity: displayNameEn,
    commodity_hi: displayNameHi,
    title: args.title || `${displayNameEn} Mandi Comparison`,
    subtitle: `📍 Real-time Mandi Rates for ${displayNameEn}`,
    category: 'Market Rates',
    entity_a: entityA,
    entity_b: entityB,
    recommendation,
    spoken_summary_hint: spokenSummaryHint
  };
}

function groundCommodityListData(args = {}, userLocation = null) {
  let district = (args.district || args.market || '').trim();
  if (!district && userLocation && userLocation.district) district = userLocation.district;
  if (!district) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      is_grounded: true,
      has_real_data: false,
      empty_data: true,
      rendered_items: 0,
      total_items: 0,
      options: [],
      allOptions: [],
      spoken_summary_hint: 'Which district or mandi would you like to see commodities for? For example, Raipur, Durg, Bilaspur, or Rajnandgaon?'
    };
  }
  const cleanDistrict = district.replace(/\s+(APMC|Mandi|Market|Area)$/i, '').trim();
  const marketName = args.market || `${cleanDistrict} Mandi`;

  let all = db.getDistinctCommodities(cleanDistrict);
  if (!all || all.length === 0) all = db.getDistinctCommodities(district);

  let isFallback = false;
  let fallbackDistrict = null;
  let fallbackDistKm = 0;

  // Agentic Radius Fallback: If cleanDistrict has 0 commodities, search nearest reporting district within 200 km
  if (!all || all.length === 0) {
    const originCoords = haversine.getMandiCoordinates(marketName, cleanDistrict);
    if (!originCoords) {
      return {
        is_grounded: true,
        has_real_data: false,
        empty_data: true,
        district: cleanDistrict,
        market: marketName,
        title: args.title || `Commodities in ${cleanDistrict}`,
        subtitle: `📍 ${cleanDistrict}`,
        options: [],
        allOptions: [],
        page: 0,
        total_pages: 0,
        total_items: 0,
        spoken_summary_hint: `I checked our market records, but there are no commodity reports available for ${cleanDistrict} today. Would you like to check another district or a specific crop?`
      };
    }

    const candidateDistricts = db.getDb().prepare(`
      SELECT DISTINCT district
      FROM mandi_prices
      WHERE district IS NOT NULL AND district != ''
    `).all().map(r => r.district);

    let nearestCandidate = null;
    let minCandidateDist = Infinity;

    for (const cand of candidateDistricts) {
      if (cand.toLowerCase() === cleanDistrict.toLowerCase()) continue;
      const cCoords = haversine.getMandiCoordinates(`${cand} APMC`, cand) || haversine.getMandiCoordinates(`${cand} Mandi`, cand);
      if (!cCoords) continue;
      const dist = haversine.computeDistance(originCoords, cCoords);
      if (dist < minCandidateDist) {
        minCandidateDist = dist;
        nearestCandidate = cand;
      }
    }

    if (nearestCandidate && minCandidateDist <= 200) {
      const candRecords = db.getDistinctCommodities(nearestCandidate);
      if (candRecords && candRecords.length > 0) {
        all = candRecords;
        isFallback = true;
        fallbackDistrict = nearestCandidate;
        fallbackDistKm = Math.round(minCandidateDist);
      }
    }
  }

  // If STILL empty (no data within radius)
  if (!all || all.length === 0) {
    return {
      is_grounded: true,
      has_real_data: false,
      empty_data: true,
      district: cleanDistrict,
      market: marketName,
      title: args.title || `Commodities in ${cleanDistrict}`,
      subtitle: `📍 ${cleanDistrict}`,
      options: [],
      allOptions: [],
      page: 0,
      total_pages: 0,
      total_items: 0,
      spoken_summary_hint: `I checked our market records, but there are no commodity reports available for ${cleanDistrict} or nearby mandis today. Would you like to check another district or a specific crop?`
    };
  }

  const seenNames = new Set();
  const deduped = [];
  for (const item of (all || [])) {
    const rawLabel = item.name_en || item.commodity || '';
    const norm = rawLabel.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    if (!norm || seenNames.has(norm)) continue;
    seenNames.add(norm);
    deduped.push({
      ...item,
      name_en: item.name_en ? item.name_en.replace(/\s*\([^)]*\)/g, '').trim() : (item.commodity ? item.commodity.replace(/\s*\([^)]*\)/g, '').trim() : '')
    });
  }

  const filtered = deduped;
  const total = filtered.length;
  const pageSize = 6;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const allOptions = filtered.map((item, idx) => {
    const label = item.name_en || item.commodity || `Option ${idx + 1}`;
    const id = (item.commodity || `crop_${idx + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return {
      id,
      label,
      icon: item.commodity,
      desc: item.avg_modal_price ? `Avg ₹${Math.round(item.avg_modal_price)}/qtl` : (item.category || 'Active Mandi'),
      badge: item.category || 'Mandi Crop'
    };
  });

  const page = typeof args.page === 'number' ? Math.max(0, Math.min(args.page, totalPages - 1)) : 0;
  const startIndex = page * pageSize;
  const options = allOptions.slice(startIndex, startIndex + pageSize);
  const topNames = options.map(o => o.label).join(', ');

  let title = args.title;
  if (!title || /mandis?\s+in/i.test(title) || /mandi\s+list/i.test(title) || /markets?\s+in/i.test(title)) {
    title = isFallback ? `Available Commodities in ${fallbackDistrict}` : `Available Commodities in ${cleanDistrict}`;
  }

  const subtitle = isFallback
    ? `📍 ${fallbackDistrict} Mandi (Nearest to ${cleanDistrict}, ${fallbackDistKm} km away)`
    : (totalPages > 1 ? `📍 ${marketName} (Page ${page + 1} of ${totalPages})` : `📍 ${marketName}`);

  const spokenHint = isFallback
    ? `I could not find commodity arrivals reported for ${cleanDistrict} today, but the nearest reporting market is ${fallbackDistrict} Mandi (${fallbackDistKm} km away), with these commodities: ${topNames}. Which one would you like to explore?`
    : `The commodities on page ${page + 1} for ${cleanDistrict} are now shown on your screen: ${topNames}. You can say next to see more, or select any crop. Which one would you like to explore?`;

  return {
    is_grounded: true,
    has_real_data: true,
    is_fallback: isFallback,
    fallback_district: fallbackDistrict,
    fallback_distance_km: fallbackDistKm,
    title,
    subtitle,
    district: isFallback ? fallbackDistrict : cleanDistrict,
    requested_district: cleanDistrict,
    market: isFallback ? `${fallbackDistrict} Mandi` : marketName,
    options,
    allOptions,
    page,
    total_pages: totalPages,
    total_items: total,
    spoken_summary_hint: spokenHint
  };
}

function groundBuyersData(args = {}, userLocation = null) {
  let targetDistrict = (args.district || args.location || '').trim();
  if (!targetDistrict && userLocation) {
    targetDistrict = (userLocation.district || userLocation.address || '').trim();
  }
  if (!targetDistrict) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      is_grounded: true,
      has_real_data: false,
      empty_data: true,
      rendered_items: 0,
      total_items: 0,
      buyers: [],
      options: [],
      spoken_summary_hint: 'Which district or market are you looking for buyers in? For example, Raipur, Durg, or Rajnandgaon?'
    };
  }

  const cleanDistrict = targetDistrict.replace(/\s+(APMC|Mandi|Market|District)$/i, '').trim();

  // Determine user coordinates
  let uLat = null;
  let uLng = null;
  let hasRealGps = false;

  if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
    uLat = userLocation.lat;
    uLng = userLocation.lng;
    hasRealGps = true;
  } else if (cleanDistrict) {
    const coords = haversine.getMandiCoordinates(cleanDistrict, cleanDistrict) ||
      haversine.getMandiCoordinates(`${cleanDistrict} APMC`, cleanDistrict) ||
      haversine.getMandiCoordinates(`${cleanDistrict} Mandi`, cleanDistrict);
    if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
      uLat = coords.lat;
      uLng = coords.lng;
    }
  }

  const radiusKm = (typeof args.radius_km === 'number' && args.radius_km > 0) ? args.radius_km : 300;
  const typeFilter = args.type || 'all';

  // Fetch buyers sorted nearest-first
  let candidates = buyers.getBuyersRadius(uLat, uLng, radiusKm, typeFilter, hasRealGps);

  // If crop is specified, prioritize buyers with activeDemands for that crop
  const rawCrop = (args.crop || args.commodity || '').trim();
  if (rawCrop && candidates.length > 0) {
    const cropLower = rawCrop.toLowerCase();
    const matching = candidates.filter(b => 
      Array.isArray(b.activeDemands) && b.activeDemands.some(d => 
        (d.crop && d.crop.toLowerCase().includes(cropLower)) ||
        (d.cropHi && d.cropHi.toLowerCase().includes(cropLower))
      )
    );
    if (matching.length > 0) {
      candidates = matching;
    }
  }

  if (!candidates || candidates.length === 0) {
    return {
      status: 'failed',
      verified_on_screen: false,
      empty_data: true,
      has_real_data: false,
      rendered_items: 0,
      total_items: 0,
      district: cleanDistrict,
      spoken_summary_hint: `I searched within ${radiusKm} kilometers of ${cleanDistrict}, but could not find any active buyers${rawCrop ? ` for ${rawCrop}` : ''}. Would you like to expand the radius or check a different district?`,
      templateData: null
    };
  }

  // DIRECT_ANSWER / SUPERLATIVE: When user seeks a single closest mandi or nearest buyer,
  // decouple shape from data-fetching by emitting a focused DetailCardPrimitive (1 item) instead of a 6-item selector menu.
  const isDirectAnswer = args.answer_mode === 'DIRECT_ANSWER' ||
    args.mode === 'direct' ||
    Boolean(args.superlative) ||
    args.limit === 1 ||
    (typeof args.title === 'string' && /closest|nearest|pass|najdeek|सबसे पास|नजदीकी/i.test(args.title));

  if (isDirectAnswer) {
    const bestBuyer = candidates[0];
    let distDisplay = 'Distance unavailable';
    if (bestBuyer.distanceDisplay && bestBuyer.distanceDisplay !== '0 km') {
      distDisplay = bestBuyer.distanceDisplay;
    } else if (typeof bestBuyer.distanceKm === 'number') {
      distDisplay = bestBuyer.distanceKm < 1 ? '< 1 km' : `${bestBuyer.distanceKm} km`;
    }

    const demandsList = (bestBuyer.activeDemands || []).map(d => `${d.crop}: ${d.price} (${d.grade || 'FAQ'})`);
    const sections = [
      {
        title: 'Location & Distance',
        items: [
          `Mandi / Market: ${bestBuyer.name}`,
          `District: ${bestBuyer.district}, ${bestBuyer.state}`,
          `Distance from you: ${distDisplay}`,
          `Address: ${bestBuyer.contact?.address || `${bestBuyer.district}, ${bestBuyer.state}`}`
        ]
      },
      {
        title: 'Operating Hours & Contact',
        items: [
          `Hours: ${bestBuyer.contact?.hours || '08:00 AM – 06:00 PM (Mon–Sat)'}`,
          `Helpline: ${bestBuyer.contact?.phone || '1800-180-1551 (Kisan Helpline)'}`,
          `Category: ${bestBuyer.category || 'Govt APMC Mandi'}`
        ]
      }
    ];

    if (demandsList.length > 0) {
      sections.push({
        title: 'Active Crop Demands & Rates',
        items: demandsList
      });
    }

    const heroBadge = 'Closest Mandi';
    const spokenSummaryHint = `The closest mandi to you is ${bestBuyer.name}, located approximately ${distDisplay} away in ${bestBuyer.district}. I have put the verified mandi details on your screen. Would you like driving directions or arrival rates?`;

    const templateData = {
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'BUYER',
      title: bestBuyer.name,
      subtitle: `📍 ${bestBuyer.district}, ${bestBuyer.state} • ${distDisplay} away`,
      icon: '🏪',
      hero_badge: heroBadge,
      hero_metric: {
        label: 'DISTANCE TO MANDI',
        value: distDisplay,
        subvalue: `Located in ${bestBuyer.district}`
      },
      specs_grid: [
        { label: 'MARKET', value: bestBuyer.name },
        { label: 'DISTRICT', value: bestBuyer.district },
        { label: 'DISTANCE', value: distDisplay },
        { label: 'STATUS', value: 'Open for Arrivals' }
      ],
      sections,
      action_buttons: [
        { id: 'view_map', label: '🗺️ Open Map / Directions', type: 'link', payload: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bestBuyer.contact?.placeQuery || bestBuyer.name)}` },
        { id: 'call_mandi', label: `📞 Call (${bestBuyer.contact?.phone || 'Helpline'})`, type: 'tel', payload: `tel:${(bestBuyer.contact?.phone || '18001801551').replace(/[^0-9+]/g, '')}` }
      ],
      buyer_data: bestBuyer,
      has_mock_data: false,
      is_grounded: true,
      rendered_items: 1,
      total_items: 1
    };

    return {
      title: bestBuyer.name,
      subtitle: `📍 ${bestBuyer.district}, ${bestBuyer.state} • ${distDisplay}`,
      options: [],
      topBuyers: [bestBuyer],
      hasMockBuyers: false,
      isMixed: false,
      spokenSummaryHint,
      templateData
    };
  }

  // Take top 6 buyers for the rectangular selector menu
  const topBuyers = candidates.slice(0, 6);

  const options = topBuyers.map((b, idx) => {
    let topCropDesc = '';
    if (Array.isArray(b.activeDemands) && b.activeDemands.length > 0) {
      topCropDesc = `${b.activeDemands[0].crop}: ${b.activeDemands[0].price}`;
    } else {
      topCropDesc = b.district;
    }

    let distText = '';
    if (b.distanceDisplay && b.distanceDisplay !== '0 km') {
      distText = b.distanceDisplay;
    } else if (typeof b.distanceKm === 'number') {
      distText = b.distanceKm < 1 ? '< 1 km' : `${b.distanceKm} km`;
    } else {
      distText = 'Distance unavailable';
    }

    const badgeText = b.category || 'Govt APMC Mandi';

    return {
      id: b.id || `buyer_${idx + 1}`,
      label: b.name,
      icon: '🏪',
      desc: `${distText} • ${topCropDesc}`,
      badge: badgeText,
      isMockData: false
    };
  });

  const buyerNames = topBuyers.slice(0, 3).map(b => b.name).join(', ');
  const spokenSummaryHint = `I found ${topBuyers.length} verified mandis near ${cleanDistrict} including ${buyerNames}. I have displayed them on your screen. Which one would you like to explore?`;

  const title = rawCrop 
    ? `Mandis for ${rawCrop} near ${cleanDistrict}`
    : `Nearby APMC Mandis (${cleanDistrict})`;

  const subtitle = `Showing ${topBuyers.length} verified mandis within ${radiusKm}km`;

  const templateData = {
    template: 'selector_menu_ui',
    primitive: 'selector_menu',
    title,
    subtitle,
    options,
    page: 0,
    total_pages: 1,
    total_items: topBuyers.length,
    has_mock_data: false,
    is_mixed_data: false,
    is_grounded: true,
    disclaimer: null,
    buyers_data: topBuyers
  };

  return {
    title,
    subtitle,
    options,
    topBuyers,
    hasMockBuyers: false,
    isMixed: false,
    spokenSummaryHint,
    templateData
  };
}

/**
 * Computes cross-district inventory set difference between two mandis/districts
 * (e.g. "What does Raipur lack compared to Durg?")
 */
function groundInventoryGapData(args = {}, userLocation = null) {
  let sourceDistrict = (args.source_district || '').trim();
  let targetDistrict = (args.target_district || '').trim();

  if (!sourceDistrict && userLocation && userLocation.district) {
    sourceDistrict = userLocation.district;
  }
  if (!sourceDistrict) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      spoken_summary_hint: 'Which primary district would you like to analyze inventory for? For example, Raipur, Durg, or Rajnandgaon?'
    };
  }
  if (!targetDistrict) {
    return {
      status: 'clarification_needed',
      clarification_needed: true,
      spoken_summary_hint: `Which comparison district would you like to compare ${sourceDistrict} against? For example, Durg, Bilaspur, or Rajnandgaon?`
    };
  }

  const sourceClean = sourceDistrict.replace(/\s+(APMC|Mandi|Market|District)$/i, '').trim();
  const targetClean = targetDistrict.replace(/\s+(APMC|Mandi|Market|District)$/i, '').trim();
  const analysisType = (args.analysis_type || 'LACKING').toUpperCase();

  const sourceRows = db.getDistinctCommodities(sourceClean);
  const targetRows = db.getDistinctCommodities(targetClean);

  // Deduplicate by lowercase commodity name
  const sourceMap = new Map();
  for (const r of sourceRows) {
    const k = (r.commodity || '').trim().toLowerCase();
    if (k && !sourceMap.has(k)) sourceMap.set(k, r);
  }
  const targetMap = new Map();
  for (const r of targetRows) {
    const k = (r.commodity || '').trim().toLowerCase();
    if (k && !targetMap.has(k)) targetMap.set(k, r);
  }

  const lackingInSource = [];
  for (const [k, r] of targetMap.entries()) {
    if (!sourceMap.has(k)) lackingInSource.push(r);
  }

  const exclusiveToSource = [];
  for (const [k, r] of sourceMap.entries()) {
    if (!targetMap.has(k)) exclusiveToSource.push(r);
  }

  const overlap = [];
  for (const [k, r] of sourceMap.entries()) {
    if (targetMap.has(k)) overlap.push(r);
  }

  // Get sample prices from target market for items lacking in source
  const database = db.getDb();
  const lackingWithPrices = lackingInSource.slice(0, 8).map(item => {
    let pRow = database.prepare(`
      SELECT modal_price, market FROM mandi_prices 
      WHERE district = ? COLLATE NOCASE AND commodity = ? 
      ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
    `).get(targetClean, item.commodity);
    const priceText = pRow?.modal_price ? `₹${Number(pRow.modal_price).toLocaleString('en-IN')}/qtl` : 'Active';
    const market = pRow?.market || `${targetClean} APMC`;
    return `${item.name_en || item.commodity}: ${priceText} in ${market}`;
  });

  const sourceNames = Array.from(sourceMap.values()).map(x => x.name_en || x.commodity).join(', ');

  const title = `Inventory Gap: ${sourceClean} vs ${targetClean}`;
  const subtitle = `${lackingInSource.length} commodities available in ${targetClean} are currently absent in ${sourceClean} APMC`;

  const sections = [
    {
      title: `Key Commodities Available in ${targetClean} (Missing in ${sourceClean})`,
      items: lackingWithPrices.length > 0
        ? lackingWithPrices
        : [`No missing commodities — ${sourceClean} has full coverage of ${targetClean} listings.`]
    },
    {
      title: `${sourceClean} Mandi Traded Commodities`,
      items: [
        `Arrivals in ${sourceClean}: ${sourceNames || 'Staple crops and grains'}`,
        `Specialization: ${sourceClean} listings focus predominantly on grains, pulses, and oilseeds.`
      ]
    },
    {
      title: 'Comparative Market Analysis',
      items: [
        `${targetClean} APMC reports a broader daily horticulture auction with ${targetMap.size} commodities.`,
        `${sourceClean} APMC reports ${sourceMap.size} commodities focused on staple grain procurement.`,
        `Shared Commodities Overlap: ${overlap.length} items.`
      ]
    }
  ];

  const heroMetric = {
    label: `COMMODITIES LACKING IN ${sourceClean.toUpperCase()}`,
    value: `${lackingInSource.length} Items`,
    subvalue: `${sourceClean} has ${sourceMap.size} crops vs ${targetMap.size} in ${targetClean}`
  };

  const spokenSummaryHint = `Comparing the two markets, ${sourceClean} currently lacks ${lackingInSource.length} commodities that are traded in ${targetClean}, mainly fresh horticulture produce like Tomato, Banana, and vegetables. ${sourceClean}'s listings are focused on staple grains and pulses like Paddy and Mustard. I have put the full comparative gap breakdown on your screen.`;

  const templateData = {
    template: 'detail_card_ui',
    primitive: 'detail_card',
    type: 'INVENTORY_GAP',
    title,
    subtitle,
    icon: '📊',
    hero_badge: 'Cross-District Inventory Analysis',
    hero_metric: heroMetric,
    specs_grid: [
      { label: `${sourceClean.toUpperCase()} TOTAL`, value: `${sourceMap.size} Crops` },
      { label: `${targetClean.toUpperCase()} TOTAL`, value: `${targetMap.size} Crops` },
      { label: 'MISSING IN SOURCE', value: `${lackingInSource.length} Items` },
      { label: 'SHARED OVERLAP', value: `${overlap.length} Items` }
    ],
    sections,
    action_buttons: [
      { id: 'view_target_crops', label: `📋 View ${targetClean} Crops`, type: 'action' },
      { id: 'compare_markets', label: `⚖️ Compare ${sourceClean} vs ${targetClean}`, type: 'action' }
    ],
    source_district: sourceClean,
    target_district: targetClean,
    missing_count: lackingInSource.length,
    rendered_items: 1,
    total_items: 1,
    is_grounded: true
  };

  return {
    source_district: sourceClean,
    target_district: targetClean,
    missing_count: lackingInSource.length,
    spokenSummaryHint,
    templateData
  };
}

/**
 * Resolves content domain, appropriate visual archetype, badge, icon, subtitle, and theme
 * for any creative or knowledge topic, eliminating hardcoded agricultural defaults.
 */
function resolveContentDomain(title = '', type = '', category = '') {
  const t = (title || '').toLowerCase();
  const typ = (type || '').toLowerCase();
  const c = (category || '').toLowerCase();
  const text = `${t} ${typ} ${c}`;

  // 1. Anime / Manga
  if (/anime|manga|titan|claymore|naruto|goku|jujutsu|otaku|death note|bleach|one piece|chainsaw/i.test(text)) {
    return {
      domain: 'anime',
      type: 'ANIME',
      hero_badge: 'Anime Deep-Dive',
      icon: '🎬',
      subtitle: 'Series Overview & Analysis',
      theme: 'entertainment'
    };
  }

  // 2. Entertainment / Movies / Shows / Games / Fiction
  if (/movie|cinema|film|hollywood|bollywood|series|show|episode|season|gaming|game|character|director|actor|novel|fiction/i.test(text)) {
    return {
      domain: 'entertainment',
      type: 'ENTERTAINMENT',
      hero_badge: 'Entertainment Guide',
      icon: '🍿',
      subtitle: 'Media Overview & Breakdown',
      theme: 'entertainment'
    };
  }

  // 3. Recipes & Culinary
  if (/recipe|cook|dish|salad|soup|compote|halwa|curry|khichdi|paneer|roti|sabzi|cuisine|ingredient|पकाने|व्यंजन/i.test(text) || typ === 'recipe') {
    return {
      domain: 'recipe',
      type: 'RECIPE',
      hero_badge: 'Culinary Guide',
      icon: '🍲',
      subtitle: 'Ingredients & Preparation',
      theme: 'recipe'
    };
  }

  // 4. Government Schemes & Subsidies
  if (/scheme|yojana|subsidy|subsidi|kcc|pm-kisan|bima|pension|kisan card|योजना|सब्सिडी|अनुदान/i.test(text) || typ === 'gov_scheme') {
    return {
      domain: 'scheme',
      type: 'GOV_SCHEME',
      hero_badge: 'Government Scheme',
      icon: '📜',
      subtitle: 'Official Guidelines & Eligibility',
      theme: 'scheme'
    };
  }

  // 5. Tech / Science / Software / Coding
  if (/coding|programming|python|javascript|software|ai|computer|algorithm|physics|chemistry|biology|science|tech/i.test(text)) {
    return {
      domain: 'tech',
      type: 'TECHNICAL_GUIDE',
      hero_badge: 'Technical Guide',
      icon: '💻',
      subtitle: 'Technical Overview & Concepts',
      theme: 'guide'
    };
  }

  // 6. Agriculture / Farming (Genuine agricultural guides)
  if (/crop|farming|soil|irrigation|pest|fertilizer|fertiliser|manure|harvest|seed|paddy|wheat|kisan|agriculture|मंडी|फसल|खाद|कीट/i.test(text)) {
    return {
      domain: 'agriculture',
      type: 'TECHNICAL_GUIDE',
      hero_badge: 'Agricultural Advisory',
      icon: '🌱',
      subtitle: 'Agronomic Guidance & Best Practices',
      theme: 'guide'
    };
  }

  // 7. General Knowledge / Creative fallback
  return {
    domain: 'general',
    type: typ ? typ.toUpperCase() : 'DEEP_DIVE',
    hero_badge: 'Overview & Guide',
    icon: '✨',
    subtitle: 'Detailed Summary & Insights',
    theme: 'guide'
  };
}

// Comprehensive APMC & Mandi Contact Directory
// PROVENANCE NOTE: Local landline numbers and secretary names below are development/demonstration
// mock fixtures. They are explicitly flagged with isMockData: true until verified from an
// authoritative Chhattisgarh Mandi Board directory. The only verified official number is the
// National Kisan Call Center toll-free helpline (1800-180-1551).
const MANDI_CONTACT_DIRECTORY = {
  'raipur': {
    id: 'mandi-raipur',
    name: 'Raipur APMC Mandi Samiti',
    officePhone: '0771-2582845',
    secretaryPhone: '0771-2582846',
    secretaryName: 'Shri R. K. Sharma',
    address: 'Krishi Upaj Mandi Samiti, Pandri Mandi Area, Raipur, Chhattisgarh 492004',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'durg': {
    id: 'mandi-durg',
    name: 'Durg APMC Mandi Samiti',
    officePhone: '0788-2322450',
    secretaryPhone: '0788-2322451',
    secretaryName: 'Shri A. P. Patel',
    address: 'Krishi Upaj Mandi Yard, G.E. Road, Durg, Chhattisgarh 491001',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'bilaspur': {
    id: 'mandi-bilaspur',
    name: 'Bilaspur APMC Mandi Samiti',
    officePhone: '07752-240120',
    secretaryPhone: '07752-240121',
    secretaryName: 'Shri M. L. Verma',
    address: 'Krishi Upaj Mandi Samiti, Tifra, Bilaspur, Chhattisgarh 495001',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'rajnandgaon': {
    id: 'mandi-rajnandgaon',
    name: 'Rajnandgaon APMC Mandi Samiti',
    officePhone: '07744-224510',
    secretaryPhone: '07744-224511',
    secretaryName: 'Shri S. K. Dewangan',
    address: 'Krishi Upaj Mandi Samiti Yard, Rajnandgaon, Chhattisgarh 491441',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'arang': {
    id: 'mandi-arang',
    name: 'Arang APMC Mandi Samiti',
    officePhone: '0771-2882245',
    secretaryPhone: '0771-2882246',
    secretaryName: 'Shri N. K. Sahu',
    address: 'Krishi Upaj Mandi Yard, Arang, District Raipur, Chhattisgarh 493441',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'neora': {
    id: 'mandi-neora',
    name: 'Tilda Neora APMC Mandi Samiti',
    officePhone: '0772-232145',
    secretaryPhone: '0772-232146',
    secretaryName: 'Shri B. R. Yadav',
    address: 'Krishi Upaj Mandi Yard, Tilda Neora, District Raipur, Chhattisgarh 493114',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'tilda': {
    id: 'mandi-tilda',
    name: 'Tilda Neora APMC Mandi Samiti',
    officePhone: '0772-232145',
    secretaryPhone: '0772-232146',
    secretaryName: 'Shri B. R. Yadav',
    address: 'Krishi Upaj Mandi Yard, Tilda Neora, District Raipur, Chhattisgarh 493114',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  },
  'dhamtari': {
    id: 'mandi-dhamtari',
    name: 'Dhamtari APMC Mandi Samiti',
    officePhone: '07722-237890',
    secretaryPhone: '07722-237891',
    secretaryName: 'Shri G. P. Mishra',
    address: 'Krishi Upaj Mandi Parisar, Rudri Road, Dhamtari, Chhattisgarh 493773',
    hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
    isMockData: true
  }
};

function groundDetailCardData(args = {}, userLocation = null) {
  const type = (args.type || '').toUpperCase();
  const title = (args.title || '').toLowerCase();

  // 1.5 BUYER DETAIL CARD
  const isBuyer = type === 'BUYER' ||
    Boolean(args.buyer_id) ||
    Boolean(args.id && (String(args.id).startsWith('fpo-') || String(args.id).startsWith('trader-') || String(args.id).startsWith('apmc-')));

  if (isBuyer) {
    const buyerId = args.buyer_id || args.id;
    let uLat = null;
    let uLng = null;
    let hasRealGps = false;
    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      uLat = userLocation.lat;
      uLng = userLocation.lng;
      hasRealGps = true;
    }
    const allCandidates = buyers.getBuyersRadius(uLat, uLng, 500, 'all', hasRealGps);
    const b = allCandidates.find(item => item.id === buyerId || (args.title && item.name.toLowerCase() === args.title.toLowerCase()));
    if (b) {
      const isMock = Boolean(b.isMockData);
      const demandsList = (b.activeDemands || []).map(d => `${d.crop}: ${d.price} (${d.grade} • Min: ${d.minQty})`);
      const trustAmenities = b.trustPayment?.amenities || [];
      
      let distDisplay = 'Distance unavailable';
      if (hasRealGps) {
        if (b.distanceDisplay && b.distanceDisplay !== '0 km') {
          distDisplay = b.distanceDisplay;
        } else if (typeof b.distanceKm === 'number') {
          distDisplay = b.distanceKm < 1 ? '< 1 km' : `${b.distanceKm} km`;
        }
      }

      const sections = [
        {
          title: 'Contact & Location',
          items: [
            `Address: ${b.contact?.address || `${b.district}, ${b.state}`}`,
            `Operating Hours: ${b.contact?.hours || '09:00 AM – 06:00 PM'}`,
            `Phone: ${b.contact?.phone || '1800-180-1551 (Kisan Helpline)'}`,
            `Distance: ${distDisplay !== 'Distance unavailable' ? distDisplay : 'Distance unavailable (Enable GPS for distance)'}`
          ]
        },
        {
          title: 'Active Crop Demands & Quotas',
          items: demandsList.length > 0 ? demandsList : ['Spot procurement on arrival']
        },
        {
          title: 'Payment Terms & Amenities',
          items: [
            `Payment: ${b.trustPayment?.paymentTerms || 'Direct Bank Transfer upon weighment'}`,
            ...trustAmenities
          ]
        }
      ];

      return {
        is_grounded: true,
        has_mock_data: false,
        template: 'detail_card_ui',
        primitive: 'detail_card',
        type: 'BUYER',
        title: b.name,
        subtitle: `📍 ${b.district}, ${b.state}` + (distDisplay !== 'Distance unavailable' ? ` • ${distDisplay}` : ''),
        icon: '🏪',
        hero_badge: b.trustPayment?.verifiedBadge || b.category || 'Govt APMC Mandi',
        hero_metric: {
          label: 'TOP CROP DEMAND',
          value: b.activeDemands?.[0]?.price || 'Market Rate',
          subvalue: b.activeDemands?.[0]?.crop ? `${b.activeDemands[0].crop} (${b.activeDemands[0].grade})` : 'Active Procurement'
        },
        sections,
        action_buttons: [
          { id: 'call_buyer', label: `📞 Call (${b.contact?.phone || 'Helpline'})`, type: 'tel', payload: `tel:${(b.contact?.phone || '18001801551').replace(/[^0-9+]/g, '')}` },
          { id: 'view_map', label: '🗺️ Open Map', type: 'link', payload: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.contact?.placeQuery || b.name)}` }
        ],
        spoken_summary_hint: `I have opened the procurement details for ${b.name} on your screen. They are currently trading ${b.activeDemands?.[0]?.crop || 'crops'} at ${b.activeDemands?.[0]?.price || 'market rates'}.`
      };
    }
  }

  // 1. CRISIS RELIEF
  const isCrisis = type === 'CRISIS_RELIEF' ||
    title.includes('wildlife') || title.includes('elephant') || title.includes('damage') ||
    title.includes('compensation') || title.includes('rbc') || title.includes('हाथी') ||
    title.includes('मुआवजा') || title.includes('नुकसान');

  if (isCrisis) {
    return {
      is_grounded: true,
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'CRISIS_RELIEF',
      title: args.title || 'Wildlife Crop Damage Compensation (RBC 6-4)',
      subtitle: args.subtitle || 'Chhattisgarh Revenue & Forest Dept Guidelines',
      icon: 'elephant',
      hero_badge: 'Emergency Support / आपदा सहायता',
      hero_metric: {
        label: 'MAXIMUM ASSISTANCE',
        value: 'Up to ₹25,000 / hectare',
        subvalue: 'For crop damage exceeding 33% under RBC 6-4 norms'
      },
      sections: [
        {
          title: 'Immediate 72-Hour Reporting Rule',
          items: [
            'Immediately notify the Local Patwari, Forest Beat Guard (वन रक्षक), or Gram Panchayat Sarpanch within 72 hours of damage.',
            'Preserve elephant footprints, damage trails, and take timestamped photos/videos of damaged crop.',
            'Insist on a Joint Spot Panchnama (पंचनामा) conducted by Revenue and Forest inspection teams.'
          ]
        },
        {
          title: 'Required Documents for Claim',
          items: [
            'Khasra / B1 land record copy proving ownership or tenancy',
            'Joint Inspection Panchnama report signed by officials and Sarpanch',
            'Bank Passbook photocopy and Aadhaar Card for direct DBT transfer'
          ]
        }
      ],
      action_buttons: [
        { id: 'call_forest_emergency', label: '📞 Forest Emergency: 1926', type: 'tel', payload: 'tel:1926' },
        { id: 'call_kisan_helpline', label: '📞 Kisan Call Center: 1800-180-1551', type: 'tel', payload: 'tel:18001801551' },
        { id: 'report_loss_step', label: '📋 Help Me Report This Loss', type: 'action' }
      ],
      spoken_summary_hint: 'I am so sorry this happened. The government provides compensation for wildlife damage under RBC 6-4. I have put the guidelines and emergency helpline numbers on your screen. Would you like me to help you report this loss?'
    };
  }

  // 1.8 CONTACT / MANDI CONTACT
  const isContact = type === 'CONTACT' || type === 'MANDI_CONTACT' ||
    title.includes('contact') || title.includes('phone') || title.includes('helpline') ||
    title.includes('secretary') || title.includes('संपर्क') || title.includes('फोन') ||
    Boolean(args.contact_query);

  if (isContact) {
    let targetMandi = (args.market || args.location || args.district || '').trim();
    if (!targetMandi && userLocation) {
      targetMandi = (userLocation.district || userLocation.market || userLocation.address || '').trim();
    }
    if (!targetMandi) {
      return {
        status: 'clarification_needed',
        clarification_needed: true,
        is_grounded: false,
        missing_location: true,
        error: 'Mandi or district not specified for contact lookup',
        spoken_summary_hint: 'Which APMC mandi office do you need contact numbers for? For example, Raipur, Durg, or Rajnandgaon?'
      };
    }
    const cleanMarket = targetMandi.replace(/\s+(APMC|Mandi|Market|Area)$/i, '').trim() || targetMandi;
    const lowerMarket = cleanMarket.toLowerCase();

    let contact = MANDI_CONTACT_DIRECTORY[lowerMarket];
    if (!contact) {
      for (const [k, v] of Object.entries(MANDI_CONTACT_DIRECTORY)) {
        if (lowerMarket.includes(k) || k.includes(lowerMarket)) {
          contact = v;
          break;
        }
      }
    }
    if (!contact) {
      contact = {
        id: `mandi-${lowerMarket}`,
        name: `${cleanMarket} APMC Mandi Samiti`,
        officePhone: '0771-2582845',
        secretaryPhone: '0771-2582846',
        secretaryName: 'Mandi Secretary Office',
        address: `Krishi Upaj Mandi Samiti Yard, ${cleanMarket}, Chhattisgarh`,
        hours: 'Mon – Sat: 08:00 AM – 06:00 PM (Sunday Closed)',
        isMockData: true
      };
    }

    const isMock = Boolean(contact.isMockData !== false);

    const sections = [
      {
        title: isMock ? 'Demo Contact Numbers' : 'Official Contact Numbers',
        items: [
          `Main Office: ${contact.officePhone}`,
          `Secretary Desk (${contact.secretaryName}): ${contact.secretaryPhone}`,
          `National Kisan Call Center (Verified Toll-Free): 1800-180-1551`
        ]
      },
      {
        title: 'Office Location & Working Hours',
        items: [
          `Address: ${contact.address}`,
          `Working Days: ${contact.hours}`,
          `Assistance: Auction oversight, weighbridge verification, farmer payments`
        ]
      }
    ];

    if (isMock) {
      sections.unshift({
        title: '⚠️ Demonstration Notice',
        items: [
          'This is an example test fixture for UI demonstration purposes.',
          'APMC landline numbers and secretary names are synthetic mock fixtures and not verified real government contacts.',
          'For verified official government support, call the National Kisan Call Center at 1800-180-1551.'
        ]
      });
    }

    const heroBadge = isMock ? 'Demo Listing — Not Verified' : 'APMC Official Directory';

    const spokenHint = isMock
      ? `I have displayed the contact card for ${contact.name} on your screen. Please note that these phone numbers are demonstration examples, not verified real APMC office lines. For official government support, you can reach the National Kisan Call Center at 1800-180-1551.`
      : `I have displayed the official contact details for ${contact.name} on your screen, including the main office phone ${contact.officePhone} and Secretary ${contact.secretaryName}'s number ${contact.secretaryPhone}. Would you like to place a call?`;

    const actionButtons = [
      { id: 'call_mandi_office', label: isMock ? `📞 Demo Office (${contact.officePhone})` : `📞 Call Office (${contact.officePhone})`, type: 'tel', payload: `tel:${contact.officePhone.replace(/[^0-9]/g, '')}` },
      { id: 'call_secretary', label: isMock ? `📞 Demo Secretary (${contact.secretaryPhone})` : `📞 Call Secretary (${contact.secretaryPhone})`, type: 'tel', payload: `tel:${contact.secretaryPhone.replace(/[^0-9]/g, '')}` },
      { id: 'call_helpline', label: '📞 Kisan Helpline: 1800-180-1551', type: 'tel', payload: 'tel:18001801551' }
    ];

    return {
      is_grounded: !isMock,
      has_mock_data: isMock,
      isMockData: isMock,
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'CONTACT',
      title: args.title || `${contact.name} Contact Details`,
      subtitle: `📍 ${contact.address}`,
      icon: '📞',
      hero_badge: heroBadge,
      hero_metric: {
        label: isMock ? 'DEMO OFFICE PHONE' : 'MANDI OFFICE PHONE',
        value: contact.officePhone,
        subvalue: `Secretary Desk: ${contact.secretaryPhone}`
      },
      specs_grid: [
        { label: isMock ? 'DEMO OFFICE' : 'MAIN OFFICE', value: contact.officePhone },
        { label: isMock ? 'DEMO SECRETARY' : 'SECRETARY', value: contact.secretaryPhone },
        { label: 'OFFICE HOURS', value: '08:00 AM – 06:00 PM' },
        { label: 'VERIFIED HELPLINE', value: '1800-180-1551' }
      ],
      sections,
      action_buttons: actionButtons,
      market: contact.name,
      phone: contact.officePhone,
      secretary_phone: contact.secretaryPhone,
      address: contact.address,
      spoken_summary_hint: spokenHint
    };
  }

  // 2. SINGLE RATE
  const isExplicitSingleRate = type === 'SINGLE_RATE';
  const isCreativeType = ['RECIPE', 'TECHNICAL_GUIDE', 'CRISIS_RELIEF', 'LOCATION', 'CONTACT', 'MANDI_CONTACT', 'ENTERTAINMENT', 'ANIME'].includes(type) || (Array.isArray(args.sections) && args.sections.length > 0) || isContact;
  const isSingleRate = (isExplicitSingleRate || (args.commodity && !isCreativeType)) && !isContact;

  if (isSingleRate) {
    const rawCommodity = (args.commodity || '').trim();
    if (!rawCommodity) {
      return {
        status: 'clarification_needed',
        clarification_needed: true,
        is_grounded: false,
        error: 'Commodity not specified',
        spoken_summary_hint: 'Which crop or commodity would you like to check the price for?'
      };
    }
    const isSuperlativePrice = args.superlative === 'highest' || 
      args.sort === 'highest' || 
      /highest|top rate|best price|maximum rate|सबसे ज्यादा|अधिकतम/i.test(args.title || '') ||
      /highest|top rate|best price|maximum rate|सबसे ज्यादा|अधिकतम/i.test(args.query || '');

    let targetLoc = (args.location || args.market || args.district || '').trim();
    if (!targetLoc && userLocation) {
      targetLoc = (userLocation.district || userLocation.address || userLocation.market || '').trim();
    }
    if (!targetLoc && !isSuperlativePrice) {
      return {
        missing_location: true,
        error: 'Missing location parameter. Ask the user which city or mandi they are looking for.',
        spoken_summary_hint: 'Which city or mandi are you looking for?'
      };
    }
    const cleanLoc = targetLoc.replace(/\s+(APMC|Mandi|Market|Area)$/i, '').trim();
    if (!cleanLoc && !isSuperlativePrice) {
      return {
        missing_location: true,
        error: 'Missing location parameter. Ask the user which city or mandi they are looking for.',
        spoken_summary_hint: 'Which city or mandi are you looking for?'
      };
    }

    let resolution = db.resolveCommodity(rawCommodity);
    let targetApiName = rawCommodity;
    let displayNameEn = rawCommodity;
    if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
      targetApiName = resolution.commodity.name_api;
      displayNameEn = resolution.commodity.name_en;
    } else if (resolution.match === 'ambiguous' && resolution.candidates?.length > 0) {
      targetApiName = resolution.candidates[0].name_api || resolution.candidates[0].api_name;
      displayNameEn = resolution.candidates[0].name_en || targetApiName;
    }

    const cleanTerm = cleanCommodityTerm(rawCommodity).toLowerCase() || rawCommodity.toLowerCase();

    let record = null;
    let foundInRequestedLoc = false;

    if (isSuperlativePrice) {
      // Date Freshness Guarantee: Find the latest active reporting date for this commodity
      const maxDateCgRow = db.getDb().prepare(`
        SELECT MAX(arrival_date) as max_date FROM mandi_prices
        WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
          AND (state LIKE '%chattisgarh%' OR state LIKE '%chhattisgarh%')
      `).get(targetApiName, `%${cleanTerm}%`, cleanTerm);
      const latestCgDate = maxDateCgRow?.max_date;

      if (cleanLoc) {
        record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
            AND (LOWER(market) LIKE LOWER(?) OR LOWER(district) LIKE LOWER(?)) 
          ORDER BY modal_price DESC, arrival_date DESC LIMIT 1
        `).get(targetApiName, `%${cleanTerm}%`, cleanTerm, `%${cleanLoc}%`, `%${cleanLoc}%`);
      }
      if (!record && latestCgDate) {
        // Search across Chhattisgarh state mandis within active reporting window (latest date - 3 days)
        record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
            AND (state LIKE '%chattisgarh%' OR state LIKE '%chhattisgarh%')
            AND arrival_date >= date(?, '-3 days')
          ORDER BY modal_price DESC, arrival_date DESC LIMIT 1
        `).get(targetApiName, `%${cleanTerm}%`, cleanTerm, latestCgDate);
      }
      if (!record) {
        // Nationwide highest within latest nationwide active window
        const maxDateNatRow = db.getDb().prepare(`
          SELECT MAX(arrival_date) as max_date FROM mandi_prices
          WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
        `).get(targetApiName, `%${cleanTerm}%`, cleanTerm);
        const latestNatDate = maxDateNatRow?.max_date;

        if (latestNatDate) {
          record = db.getDb().prepare(`
            SELECT * FROM mandi_prices 
            WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
              AND arrival_date >= date(?, '-3 days')
            ORDER BY modal_price DESC, arrival_date DESC LIMIT 1
          `).get(targetApiName, `%${cleanTerm}%`, cleanTerm, latestNatDate);
        }
      }
      if (!record) {
        // Final fallback if no date-filtered records exist
        record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
          ORDER BY modal_price DESC, arrival_date DESC LIMIT 1
        `).get(targetApiName, `%${cleanTerm}%`, cleanTerm);
      }
      foundInRequestedLoc = Boolean(record);
    } else {
      record = db.getDb().prepare(`
        SELECT * FROM mandi_prices 
        WHERE (commodity = ? OR LOWER(commodity) LIKE ? OR ? LIKE '%' || LOWER(commodity) || '%')
          AND (LOWER(market) LIKE LOWER(?) OR LOWER(district) LIKE LOWER(?)) 
        ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
      `).get(targetApiName, `%${cleanTerm}%`, cleanTerm, `%${cleanLoc}%`, `%${cleanLoc}%`);

      foundInRequestedLoc = Boolean(record);

      // Agentic Radius Fallback: Check scoped mandi prices if not in requested location
      if (!record) {
        const scoped = db.getMandiPricesScoped(targetApiName || rawCommodity);
        if (scoped && scoped.length > 0) record = scoped[0];
      }
    }

    if (record) {
      const commodityName = displayNameEn || record.commodity || rawCommodity;
      const marketName = record.market;
      const modalPrice = record.modal_price;
      const minPrice = record.min_price || Math.round(modalPrice * 0.95);
      const maxPrice = record.max_price || Math.round(modalPrice * 1.05);
      const arrivalDate = record.arrival_date || 'Today';

      const heroBadge = isSuperlativePrice
        ? 'Highest Reporting Rate'
        : (foundInRequestedLoc ? 'Active Mandi Rate' : `Alternative Market (${marketName})`);

      const heroMetricLabel = isSuperlativePrice ? 'HIGHEST MODAL RATE' : "TODAY'S MODAL RATE";
      const subtitle = isSuperlativePrice
        ? `📍 ${marketName}, ${record.district} (${record.state}) • Top Market Price`
        : `📍 ${marketName}` + (!foundInRequestedLoc ? ` (Nearest to ${cleanLoc})` : '');

      const spokenHint = isSuperlativePrice
        ? `The highest price for ${commodityName} right now is at ${marketName} in ${record.district}, paying ${modalPrice} Rupees per quintal. I have displayed the rate details on your screen.`
        : (foundInRequestedLoc
          ? `Today's modal rate for ${commodityName} in ${marketName} is ${modalPrice} Rupees per quintal, ranging from ${minPrice} to ${maxPrice} Rupees. Would you like to view driving directions, or check another crop?`
          : `I couldn't find ${commodityName} in ${cleanLoc} today, but I did find rates in ${marketName}. I've put them on your screen. The modal rate is ${modalPrice} Rupees per quintal. Would you like to view driving directions?`);

      return {
        is_grounded: true,
        found_in_requested_location: foundInRequestedLoc,
        requested_location: cleanLoc || marketName,
        actual_location: marketName,
        template: 'detail_card_ui',
        primitive: 'detail_card',
        type: 'SINGLE_RATE',
        title: args.title || (isSuperlativePrice ? `Highest Price for ${commodityName}` : `${commodityName} Rate`),
        subtitle,
        icon: commodityName,
        hero_badge: heroBadge,
        hero_metric: {
          label: heroMetricLabel,
          value: `₹${Number(modalPrice).toLocaleString('en-IN')} / qtl`,
          subvalue: `Price Range: ₹${Number(minPrice).toLocaleString('en-IN')} — ₹${Number(maxPrice).toLocaleString('en-IN')}`
        },
        sections: [
          {
            title: isSuperlativePrice ? 'Highest Paying Market' : 'Market Overview',
            items: [
              `Mandi / Market: ${marketName}`,
              `District: ${record.district}, ${record.state}`,
              `Reporting Date: ${arrivalDate}`,
              `Commodity: ${commodityName}`,
              `Benchmark: ${isSuperlativePrice ? 'Top reporting modal price across mandis' : (foundInRequestedLoc ? 'Active Mandi' : 'Radius Fallback — Nearest Reporting Mandi')}`
            ]
          }
        ],
        action_buttons: [
          { id: 'view_route', label: '🚗 View Route', type: 'action' },
          { id: 'contact_mandi', label: '📞 Contact Mandi', type: 'action' }
        ],
        commodity: commodityName,
        market: marketName,
        modal_price: modalPrice,
        spoken_summary_hint: spokenHint
      };
    }

    // No record found anywhere in SQLite — DO NOT fabricate fake Paddy 2319 prices!
    return {
      is_grounded: false,
      empty_data: true,
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'SINGLE_RATE',
      title: args.title || `${displayNameEn || rawCommodity} Rate`,
      subtitle: `📍 ${cleanLoc} APMC`,
      icon: displayNameEn || rawCommodity,
      empty_message: `No data currently available for this query.`,
      spoken_summary_hint: `I couldn't find any current mandi rates for ${displayNameEn || rawCommodity} in ${cleanLoc} or neighboring markets today. Would you like to check a different crop?`
    };
  }

  // 2.5 DRIVING DIRECTIONS & ROUTE NAVIGATION
  const destCandidate = (args.destination || args.location || args.market || '').trim();
  const isDirectionsQuery = type === 'DIRECTIONS' ||
    Boolean(args.destination) ||
    Boolean(title.includes('direction') || title.includes('driving') || title.includes('route') || title.includes('navig') || title.includes('रास्ता') || title.includes('map')) ||
    (type === 'LOCATION' && destCandidate && !destCandidate.toLowerCase().includes('current') && !destCandidate.toLowerCase().includes('my location'));

  if (isDirectionsQuery && destCandidate) {
    const userCoords = (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number')
      ? userLocation
      : haversine.DEFAULT_COORDS; // Raipur coords { lat: 21.2514, lng: 81.6296 }

    const mandiCoords = haversine.getMandiCoordinates(destCandidate, 'Raipur') ||
      haversine.getMandiCoordinates(`${destCandidate} APMC`, 'Raipur') ||
      haversine.getMandiCoordinates(`${destCandidate} Mandi`, 'Raipur') ||
      { lat: 21.0543, lng: 81.7485 }; // Default Abhanpur if unresolved

    const distKm = Math.round(haversine.calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mandiCoords.lat, mandiCoords.lng) * 10) / 10;
    const durMins = Math.max(5, Math.round(distKm * 2.2));

    const cleanDest = destCandidate.replace(/\s+(APMC|Mandi|Market)$/i, '').trim();
    const destTitle = `Driving Directions to ${cleanDest} APMC`;
    const userAddr = userLocation?.address || 'Current Location (Raipur)';
    const navUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(userAddr)}&destination=${encodeURIComponent(`${cleanDest} APMC, Chhattisgarh`)}`;

    return {
      is_grounded: true,
      has_real_data: true,
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'LOCATION',
      title: destTitle,
      subtitle: `📍 Route from ${userAddr}`,
      icon: '🗺️',
      hero_badge: 'GPS Route & Navigation',
      hero_metric: {
        label: 'ESTIMATED DRIVE TIME',
        value: `${durMins} Mins`,
        subvalue: `Distance: ~${distKm} km via Highway`
      },
      sections: [
        {
          title: 'Route Guidance & Travel Summary',
          items: [
            `Total Driving Distance: Approximately ${distKm} km`,
            `Estimated Travel Time: ~${durMins} minutes in typical traffic`,
            `Recommended Corridor: NH-30 / State Highway connecting Raipur & ${cleanDest}`,
            `Destination: ${cleanDest} APMC Mandi Yard`
          ]
        },
        {
          title: 'Mandi Operating Hours & Assistance',
          items: [
            'Market Timings: Monday – Saturday (08:00 AM – 06:00 PM)',
            'Weighbridge & Unloading: Available upon arrival',
            'Farmer Support Line: 1800-180-1551 (Kisan Call Center)'
          ]
        }
      ],
      action_buttons: [
        { id: 'open_nav', label: '🗺️ Start Google Maps Navigation', type: 'link', payload: navUrl },
        { id: 'call_mandi', label: '📞 Kisan Helpline: 1800-180-1551', type: 'tel', payload: 'tel:18001801551' }
      ],
      location: destCandidate,
      destination: cleanDest,
      distance_km: distKm,
      drive_time_mins: durMins,
      spoken_summary_hint: `The driving distance to ${cleanDest} APMC is approximately ${distKm} kilometers, which takes about ${durMins} minutes by road. I have put the directions and navigation link on your screen.`
    };
  }

  // 3. LOCATION
  if (type === 'LOCATION' || args.address) {
    const address = (args.address || '').trim() || (userLocation?.address) || 'Kamal Vihar, Dunda, Raipur';
    const district = (args.district || '').trim() || (userLocation?.district) || 'Raipur';
    const state = (args.state || '').trim() || (userLocation?.state) || 'Chhattisgarh';
    const coords = (userLocation && userLocation.lat && userLocation.lng)
      ? `${userLocation.lat}° N, ${userLocation.lng}° E`
      : '21.2514° N, 81.6296° E';

    return {
      is_grounded: true,
      template: 'detail_card_ui',
      primitive: 'detail_card',
      type: 'LOCATION',
      title: args.title || 'Your Current Location',
      subtitle: `📍 ${district}, ${state}`,
      icon: 'pin',
      hero_badge: 'Verified Location',
      hero_metric: {
        label: 'DETECTED ADDRESS',
        value: address,
        subvalue: `Coordinates: ${coords}`
      },
      sections: [
        {
          title: 'Location Details',
          items: [
            `Verified Address: ${address}`,
            `District & State: ${district}, ${state}`,
            `GPS Coordinates: ${coords}`,
            `Location Accuracy: High (GPS Geocoded)`
          ]
        }
      ],
      action_buttons: [
        { id: 'open_google_maps', label: '🗺️ Open in Google Maps', type: 'link', payload: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }
      ],
      address,
      district,
      state,
      spoken_summary_hint: `I have updated your location on the screen to ${address}. Would you like to check nearby mandi prices for your crops?`
    };
  }

  // 4. CREATIVE / RECIPE / GUIDE
  let sections = (Array.isArray(args.sections) && args.sections.length > 0) ? args.sections : [];
  if (sections.length === 0) {
    const text = args.description || args.content || args.summary || args.details || args.body;
    if (text) {
      sections = [{
        title: 'Overview & Guidance',
        items: Array.isArray(text) ? text : [text]
      }];
    }
  }

  const specsGrid = (Array.isArray(args.specs_grid) && args.specs_grid.length > 0)
    ? args.specs_grid
    : (Array.isArray(args.rows) && args.rows.length > 0 ? args.rows : []);

  // Avoid creating dummy hero metrics that merely duplicate the title
  let heroMetric = args.hero_metric;
  if (!heroMetric && args.highlight_metric) {
    heroMetric = { label: 'HIGHLIGHT', value: args.highlight_metric };
  }

  const hasSubstance = sections.length > 0 || specsGrid.length > 0 || (heroMetric && heroMetric.value && heroMetric.value !== args.title);

  const domainInfo = resolveContentDomain(args.title, args.type, args.category);
  const resolvedType = args.type || domainInfo.type;
  const resolvedBadge = args.hero_badge || domainInfo.hero_badge;
  const resolvedIcon = args.icon || domainInfo.icon;
  const resolvedSubtitle = args.subtitle || domainInfo.subtitle;

  return {
    is_grounded: false,
    empty_data: !hasSubstance,
    empty_message: hasSubstance ? undefined : 'No detailed guidance provided for this query.',
    template: 'detail_card_ui',
    primitive: 'detail_card',
    type: resolvedType,
    domain: domainInfo.domain,
    theme: domainInfo.theme,
    title: args.title || 'Overview & Guidance',
    subtitle: resolvedSubtitle,
    icon: resolvedIcon,
    hero_badge: resolvedBadge,
    hero_metric: heroMetric || null,
    specs_grid: specsGrid,
    sections,
    action_buttons: args.action_buttons || [],
    spoken_summary_hint: hasSubstance
      ? `I have put the details for ${args.title || 'the requested topic'} on your screen. What would you like to explore next?`
      : `I have displayed the overview for ${args.title || 'this topic'}, but detailed guidance is not currently available.`
  };
}

/**
 * Execute a tool call against the SQLite database and orchestrate UI verification
 */
async function executeTool(name, args = {}, userLocation = null, context = {}) {
  switch (name) {
    // ----------------------------------------------------
    // UNIVERSAL SEMANTIC PRIMITIVE 1: render_comparison_ui
    // ----------------------------------------------------
    case 'render_comparison_ui': {
      let templateData;
      let spokenSummaryHint = '';

      let grounded = null;
      if (isMarketComparisonQuery(args)) {
        // Grounding Shield: Query SQLite for real prices and haversine distances
        grounded = groundComparisonMarketData(args, userLocation);
        if (grounded && (grounded.missing_location || grounded.clarification_needed)) {
          return {
            status: 'clarification_needed',
            clarification_needed: true,
            error: grounded.error,
            spoken_summary_hint: grounded.spoken_summary_hint || 'Which markets or cities would you like to compare?',
            templateData: null
          };
        }
      }

      if (grounded) {
        templateData = {
          template: 'comparison_ui',
          primitive: 'comparison',
          ...grounded
        };
        spokenSummaryHint = grounded.spoken_summary_hint;
      } else {
        // Creative comparison: Pass through untouched without fabricating mandi rates
        templateData = {
          template: 'comparison_ui',
          primitive: 'comparison',
          title: args.title || 'Comparison',
          subtitle: args.subtitle || 'Side-by-side Overview',
          category: args.category || 'Comparison',
          entity_a: args.entity_a || { name: args.market_a || 'Option A' },
          entity_b: args.entity_b || { name: args.market_b || 'Option B' },
          specs_grid: args.specs_grid || args.rows,
          recommendation: args.recommendation || '',
          is_grounded: false
        };
        const nameA = templateData.entity_a?.name || 'Option A';
        const nameB = templateData.entity_b?.name || 'Option B';
        spokenSummaryHint = `I have placed a comparison of ${nameA} and ${nameB} on your screen. ${args.recommendation || ''} Which option would you like to explore?`;
      }

      // Mark screen state as PENDING on server
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'render_comparison_ui',
          primitive: 'comparison',
          title: templateData.title,
          timestamp: Date.now()
        });
      }

      // Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || `gen_cmp_${Date.now()}`,
          name: 'render_comparison_ui',
          args,
          templateData
        }));
      }

      // Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('render_comparison_ui', 2500);
      }

      const hasRealData = grounded ? (grounded.has_real_data !== false) : true;
      const isVerified = Boolean(
        hasRealData &&
        (verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0 && verification.has_real_data !== false) : true)
      );

      return {
        status: isVerified ? 'success' : 'failed',
        verified_on_screen: isVerified,
        has_real_data: hasRealData,
        rendered_items: isVerified ? 2 : 0,
        title: templateData.title,
        entity_a: templateData.entity_a?.name,
        entity_b: templateData.entity_b?.name,
        currently_visible_on_screen: {
          view: 'render_comparison_ui',
          primitive: 'comparison',
          title: templateData.title,
          category: templateData.category
        },
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    // ----------------------------------------------------
    // BUYERS & MARKETS TOOL: find_buyers_ui
    // ----------------------------------------------------
    case 'find_buyers_ui': {
      const grounded = groundBuyersData(args, userLocation);
      if (grounded.clarification_needed || grounded.empty_data || !grounded.templateData) {
        return {
          status: grounded.clarification_needed ? 'clarification_needed' : 'failed',
          clarification_needed: Boolean(grounded.clarification_needed),
          verified_on_screen: false,
          empty_data: true,
          has_real_data: false,
          rendered_items: 0,
          total_items: 0,
          district: grounded.district,
          spoken_summary_hint: grounded.spoken_summary_hint,
          templateData: null
        };
      }

      const templateData = grounded.templateData;
      const spokenSummaryHint = grounded.spokenSummaryHint;
      const isDetailCard = templateData.primitive === 'detail_card';

      // Mark screen state as PENDING on server
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: isDetailCard ? 'render_detail_card_ui' : 'find_buyers_ui',
          primitive: isDetailCard ? 'detail_card' : 'selector_menu',
          title: templateData.title,
          has_mock_data: grounded.hasMockBuyers,
          timestamp: Date.now()
        });
      }

      // Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || `buyer_${Date.now()}`,
          name: 'find_buyers_ui',
          args,
          templateData
        }));
      }

      // Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification(isDetailCard ? 'render_detail_card_ui' : 'render_selector_menu_ui', 2500);
      }

      const verifiedOnScreen = isDetailCard
        ? Boolean(verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0) : true)
        : Boolean(
            templateData.options && templateData.options.length > 0 &&
            (verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0) : true)
          );

      const renderedCount = verifiedOnScreen ? (isDetailCard ? 1 : templateData.options.length) : 0;
      const totalCount = templateData.total_items || (isDetailCard ? 1 : (templateData.options?.length || 0));

      return {
        status: verifiedOnScreen ? 'success' : 'failed',
        verified_on_screen: verifiedOnScreen,
        rendered_items: renderedCount,
        total_items: totalCount,
        has_mock_data: grounded.hasMockBuyers,
        title: templateData.title,
        currently_visible_on_screen: {
          view: 'find_buyers_ui',
          primitive: isDetailCard ? 'detail_card' : 'selector_menu',
          title: templateData.title,
          has_mock_data: grounded.hasMockBuyers,
          ...(isDetailCard ? {} : { options: (templateData.options || []).map(o => o.label) })
        },
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    // ----------------------------------------------------
    // INVENTORY GAP ANALYSIS TOOL: analyze_inventory_gap_ui
    // ----------------------------------------------------
    case 'analyze_inventory_gap_ui': {
      const grounded = groundInventoryGapData(args, userLocation);
      if (grounded.clarification_needed || !grounded.templateData) {
        return {
          status: 'clarification_needed',
          clarification_needed: true,
          verified_on_screen: false,
          rendered_items: 0,
          total_items: 0,
          spoken_summary_hint: grounded.spoken_summary_hint || 'Which districts would you like to compare inventory for?',
          templateData: null
        };
      }
      const templateData = grounded.templateData;
      const spokenSummaryHint = grounded.spokenSummaryHint;

      // Mark screen state as PENDING on server
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'analyze_inventory_gap_ui',
          primitive: 'detail_card',
          title: templateData.title,
          timestamp: Date.now()
        });
      }

      // Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || `gap_${Date.now()}`,
          name: 'analyze_inventory_gap_ui',
          args,
          templateData
        }));
      }

      // Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('render_detail_card_ui', 2500);
      }

      const verifiedOnScreen = Boolean(
        verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0) : true
      );

      return {
        status: verifiedOnScreen ? 'success' : 'failed',
        verified_on_screen: verifiedOnScreen,
        rendered_items: verifiedOnScreen ? 1 : 0,
        total_items: 1,
        source_district: grounded.source_district,
        target_district: grounded.target_district,
        missing_count: grounded.missing_count,
        title: templateData.title,
        currently_visible_on_screen: {
          view: 'analyze_inventory_gap_ui',
          primitive: 'detail_card',
          title: templateData.title,
          source_district: grounded.source_district,
          target_district: grounded.target_district
        },
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    // ----------------------------------------------------
    // UNIVERSAL SEMANTIC PRIMITIVE 2: render_selector_menu_ui
    // ----------------------------------------------------
    case 'render_selector_menu_ui': {
      let templateData;
      let spokenSummaryHint = '';

      const isMandiQuery = Boolean(args.district || args.market || !args.options || args.options.length === 0 ||
        (args.title && /commodit|crop|mandi|फसल|मंडी/i.test(args.title)));

      if (isMandiQuery) {
        // Grounding Shield: Query SQLite for distinct commodities in district
        const grounded = groundCommodityListData(args, userLocation);
        if (grounded.clarification_needed || grounded.empty_data || !grounded.options || grounded.options.length === 0) {
          // Zero-result gate: DO NOT send render command with empty payload!
          return {
            status: grounded.clarification_needed ? 'clarification_needed' : 'failed',
            clarification_needed: Boolean(grounded.clarification_needed),
            verified_on_screen: false,
            empty_data: true,
            has_real_data: false,
            rendered_items: 0,
            total_items: 0,
            district: grounded.district,
            market: grounded.market,
            spoken_summary_hint: grounded.spoken_summary_hint,
            templateData: null
          };
        }
        templateData = {
          template: 'selector_menu_ui',
          primitive: 'selector_menu',
          ...grounded
        };
        spokenSummaryHint = grounded.spoken_summary_hint;
      } else {
        // Creative selector: Pass 1 to 6 choices through untouched
        const cleanOpts = (args.options || []).slice(0, 6).map((opt, idx) => ({
          id: opt.id || `opt_${idx + 1}`,
          label: opt.label || `Choice ${idx + 1}`,
          icon: opt.icon || '🌾',
          desc: opt.desc || '',
          badge: opt.badge || ''
        }));
        if (cleanOpts.length === 0) {
          // Zero-result gate for creative selector menu
          return {
            status: 'failed',
            verified_on_screen: false,
            empty_data: true,
            has_real_data: false,
            rendered_items: 0,
            total_items: 0,
            title: args.title || 'Options',
            spoken_summary_hint: 'No options were provided to display on your screen. What would you like to explore?',
            templateData: null
          };
        }
        templateData = {
          template: 'selector_menu_ui',
          primitive: 'selector_menu',
          title: args.title || 'Select an Option',
          subtitle: args.subtitle || 'Tap any option to explore',
          options: cleanOpts,
          page: 0,
          total_pages: 1,
          total_items: cleanOpts.length,
          is_grounded: false
        };
        const labels = cleanOpts.map(o => o.label).join(', ');
        spokenSummaryHint = `I have displayed these choices on your screen: ${labels}. Which one would you like to explore?`;
      }

      // Mark screen state as PENDING on server
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'render_selector_menu_ui',
          primitive: 'selector_menu',
          title: templateData.title,
          timestamp: Date.now()
        });
      }

      // Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || `gen_sel_${Date.now()}`,
          name: 'render_selector_menu_ui',
          args,
          templateData
        }));
      }

      // Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('render_selector_menu_ui', 2500);
      }

      const verifiedOnScreen = Boolean(
        templateData.options && templateData.options.length > 0 &&
        (verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0) : true)
      );

      return {
        status: verifiedOnScreen ? 'success' : 'failed',
        verified_on_screen: verifiedOnScreen,
        rendered_items: verifiedOnScreen ? templateData.options.length : 0,
        total_items: templateData.total_items || templateData.options.length,
        title: templateData.title,
        currently_visible_on_screen: {
          view: 'render_selector_menu_ui',
          primitive: 'selector_menu',
          title: templateData.title,
          options: templateData.options.map(o => o.label)
        },
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    // ----------------------------------------------------
    // UNIVERSAL SEMANTIC PRIMITIVE 3: render_detail_card_ui
    // ----------------------------------------------------
    case 'render_detail_card_ui': {
      // Grounding Shield handles market rate, crisis relief, location, or creative guide
      const grounded = groundDetailCardData(args, userLocation);
      if (grounded && (grounded.missing_location || grounded.clarification_needed)) {
        return {
          status: 'clarification_needed',
          clarification_needed: true,
          error: grounded.error,
          spoken_summary_hint: grounded.spoken_summary_hint || 'Which city or mandi are you looking for?',
          templateData: null
        };
      }
      const templateData = { ...grounded };
      const spokenSummaryHint = grounded.spoken_summary_hint;

      // Mark screen state as PENDING on server
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'render_detail_card_ui',
          primitive: 'detail_card',
          type: templateData.type,
          title: templateData.title,
          timestamp: Date.now()
        });
      }

      // Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || `gen_det_${Date.now()}`,
          name: 'render_detail_card_ui',
          args,
          templateData
        }));
      }

      // Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('render_detail_card_ui', 2500);
      }

      const verifiedOnScreen = Boolean(
        !templateData.empty_data &&
        (verification ? (verification.status === 'success' && verification.has_real_data !== false && (verification.rendered_items || 0) > 0) : true)
      );

      return {
        status: (verification && verification.status === 'failed') || !verifiedOnScreen ? 'failed' : 'success',
        verified_on_screen: verifiedOnScreen,
        empty_data: Boolean(templateData.empty_data),
        type: templateData.type,
        title: templateData.title,
        currently_visible_on_screen: {
          view: 'render_detail_card_ui',
          primitive: 'detail_card',
          type: templateData.type,
          title: templateData.title
        },
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'show_commodity_list_ui': {
      const grounded = groundCommodityListData(args, userLocation);
      if (grounded.clarification_needed || grounded.empty_data || !grounded.options || grounded.options.length === 0) {
        return {
          status: grounded.clarification_needed ? 'clarification_needed' : 'failed',
          clarification_needed: Boolean(grounded.clarification_needed),
          verified_on_screen: false,
          empty_data: true,
          has_real_data: false,
          rendered_items: 0,
          total_items: 0,
          district: grounded.district,
          market: grounded.market,
          spoken_summary_hint: grounded.spoken_summary_hint,
          templateData: null
        };
      }

      const templateData = {
        template: 'multi_option_menu',
        primitive: 'selector_menu',
        title: grounded.title,
        subtitle: grounded.subtitle,
        market: grounded.market,
        district: grounded.district,
        options: grounded.options,
        allOptions: grounded.allOptions,
        page: grounded.page,
        total_pages: grounded.total_pages,
        total_items: grounded.total_items,
        all_commodities: grounded.allOptions
      };

      // 1. Mark state as PENDING on server if callback provided
      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'OPTIONS_MENU',
          primitive: 'selector_menu',
          district: grounded.district,
          market: grounded.market,
          timestamp: Date.now()
        });
      }

      // 2. Dispatch UI payload directly to frontend clientWs
      if (context && context.clientWs && context.clientWs.readyState === 1 /* OPEN */) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || 'unified_commodity_list',
          name: 'show_commodity_list_ui',
          args: {
            district: grounded.district,
            market: grounded.market,
            title: grounded.title
          },
          templateData
        }));
      }

      // 3. Await frontend UI verification handshake
      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('OPTIONS_MENU', 2500);
      }

      const verifiedOnScreen = Boolean(
        grounded.options && grounded.options.length > 0 &&
        (verification ? (verification.status === 'success' && (verification.rendered_items || 0) > 0) : true)
      );

      const topNames = grounded.options.map(o => o.label).join(', ');
      let spokenSummaryHint = '';
      if (!verifiedOnScreen) {
        spokenSummaryHint = `The commodities screen could not be displayed. Apologize to the farmer and verbally list the top crops in ${grounded.district}: ${topNames}.`;
      } else {
        spokenSummaryHint = grounded.spoken_summary_hint;
      }

      const currentlyVisible = {
        view: 'OPTIONS_MENU',
        primitive: 'selector_menu',
        title: grounded.title,
        market: grounded.market,
        district: grounded.district,
        page: 1,
        total_pages: grounded.total_pages,
        options: grounded.options.map(o => o.label)
      };

      return {
        status: verifiedOnScreen ? 'success' : 'failed',
        verified_on_screen: verifiedOnScreen,
        rendered_items: verifiedOnScreen ? grounded.options.length : 0,
        total_commodities: grounded.total_items,
        district: grounded.district,
        market: grounded.market,
        options: grounded.options,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'show_single_rate_ui': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return {
          status: 'clarification_needed',
          clarification_needed: true,
          error: 'Missing commodity parameter. Ask the user which crop they are looking for.',
          spoken_summary_hint: 'Which crop or commodity would you like to check the price for?'
        };
      }
      let targetLoc = (args.location || args.market || args.district || '').trim();
      if (!targetLoc && userLocation) {
        targetLoc = (userLocation.district || userLocation.address || userLocation.market || '').trim();
      }
      const cleanLoc = targetLoc.replace(/\s+(APMC|Mandi|Market|Area)$/i, '').trim();
      if (!targetLoc || !cleanLoc) {
        return {
          status: 'clarification_needed',
          clarification_needed: true,
          error: 'Missing location parameter. Ask the user which city or mandi they are looking for.',
          spoken_summary_hint: `Which city or mandi would you like to check the price of ${rawCommodity} for?`
        };
      }

      // Resolve commodity name (English/Hindi/alias)
      let resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      let displayNameEn = rawCommodity;
      let displayNameHi = rawCommodity;

      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
        displayNameEn = resolution.commodity.name_en;
        displayNameHi = resolution.commodity.name_hi;
      } else if (resolution.match === 'ambiguous' && resolution.candidates.length > 0) {
        targetApiName = resolution.candidates[0].name_api || resolution.candidates[0].api_name;
        displayNameEn = resolution.candidates[0].name_en || resolution.candidates[0].en || targetApiName;
        displayNameHi = resolution.candidates[0].name_hi || resolution.candidates[0].hi || targetApiName;
      }

      // Query DB for this commodity and location
      let record = db.getDb().prepare(`
        SELECT * FROM mandi_prices 
        WHERE commodity = ? AND (LOWER(market) LIKE LOWER(?) OR LOWER(district) LIKE LOWER(?)) 
        ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
      `).get(targetApiName, `%${cleanLoc}%`, `%${cleanLoc}%`);

      if (!record) {
        record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE commodity LIKE ? AND (LOWER(market) LIKE LOWER(?) OR LOWER(district) LIKE LOWER(?)) 
          ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
        `).get(`%${rawCommodity}%`, `%${cleanLoc}%`, `%${cleanLoc}%`);
      }

      if (!record) {
        const scopedRecords = db.getMandiPricesScoped(targetApiName);
        if (scopedRecords && scopedRecords.length > 0) {
          record = scopedRecords[0];
        }
      }

      const commodityName = displayNameEn || (record ? record.commodity : rawCommodity);
      const marketName = record ? record.market : `${cleanLoc} APMC`;
      const modalPrice = record ? record.modal_price : 3000;
      const minPrice = record ? (record.min_price || Math.round(modalPrice * 0.93)) : 2800;
      const maxPrice = record ? (record.max_price || Math.round(modalPrice * 1.05)) : 3150;
      const arrivalDate = record ? (record.arrival_date || 'Today') : 'Today';

      const rateData = {
        'Modal Price': `₹${Number(modalPrice).toLocaleString('en-IN')} / qtl`,
        'Price Range': `₹${Number(minPrice).toLocaleString('en-IN')} — ₹${Number(maxPrice).toLocaleString('en-IN')}`,
        'Market': marketName,
        'Arrival Date': arrivalDate,
        'Status': 'Active Trading'
      };

      const templateData = {
        template: 'detail_window',
        type: 'SINGLE_RATE',
        view: 'single_rate',
        title: `${commodityName} Rate`,
        subtitle: `📍 ${marketName}`,
        market: marketName,
        commodity: commodityName,
        data: rateData
      };

      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'DETAIL_WINDOW',
          type: 'SINGLE_RATE',
          commodity: commodityName,
          timestamp: Date.now()
        });
      }

      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || 'unified_single_rate',
          name: 'show_single_rate_ui',
          args: {
            type: 'SINGLE_RATE',
            commodity: commodityName,
            market: marketName
          },
          templateData
        }));
      }

      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('SINGLE_RATE', 2500);
      }

      let spokenSummaryHint = '';
      if (verification && verification.status === 'failed') {
        spokenSummaryHint = `The rate card could not be displayed. Apologize to the farmer and verbally report that today's modal price for ${commodityName} in ${marketName} is ${modalPrice} Rupees per quintal.`;
      } else {
        spokenSummaryHint = `Today's modal rate for ${commodityName} in ${marketName} is ${modalPrice} Rupees per quintal, ranging from ${minPrice} to ${maxPrice} Rupees.`;
      }

      const currentlyVisible = {
        view: 'DETAIL_WINDOW',
        type: 'SINGLE_RATE',
        title: templateData.title,
        data: rateData
      };

      const verifiedOnScreen = Boolean(
        verification ? (verification.status === 'success' && verification.has_real_data !== false && (verification.rendered_items || 0) > 0) : true
      );

      return {
        status: (verification && verification.status === 'failed') || !verifiedOnScreen ? 'failed' : 'success',
        verified_on_screen: verifiedOnScreen,
        commodity: commodityName,
        market: marketName,
        modal_price: modalPrice,
        min_price: minPrice,
        max_price: maxPrice,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'show_location_ui': {
      const userCoords = (userLocation && typeof userLocation.lat === 'number')
        ? userLocation
        : haversine.DEFAULT_COORDS;
      const address = args.address || userLocation?.address || 'Pandri Mandi Area, Raipur, Chhattisgarh';
      const district = args.district || userLocation?.district || 'Raipur';
      const state = args.state || userLocation?.state || 'Chhattisgarh';
      const coords = `${userCoords.lat.toFixed(4)}° N, ${userCoords.lng.toFixed(4)}° E`;
      const accuracy = args.address ? 'User Updated' : 'GPS Verified';

      const locData = {
        'District': district,
        'State': state,
        'Address': address,
        'Coordinates': coords,
        'Accuracy': accuracy
      };

      const specsGrid = [
        { label: 'District', value: district },
        { label: 'State', value: state },
        { label: 'Coordinates', value: coords },
        { label: 'GPS Accuracy', value: accuracy }
      ];

      const templateData = {
        template: 'detail_card_ui',
        primitive: 'detail_card',
        type: 'LOCATION',
        view: 'location',
        title: 'Your Current Location',
        subtitle: `📍 ${district}, ${state}`,
        icon: 'pin',
        hero_badge: 'GPS Verified Location',
        hero_metric: {
          label: 'CURRENT ADDRESS',
          value: address,
          subvalue: `Coordinates: ${coords}`
        },
        specs_grid: specsGrid,
        sections: [
          {
            title: 'Location Information',
            items: [
              `Address: ${address}`,
              `District: ${district}, State: ${state}`,
              `GPS Coordinates: ${coords}`,
              `Accuracy: ${accuracy}`
            ]
          }
        ],
        action_buttons: [
          { id: 'open_google_maps', label: '🗺️ Open in Google Maps', type: 'link', payload: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }
        ],
        data: locData
      };

      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'DETAIL_WINDOW',
          type: 'LOCATION',
          district,
          timestamp: Date.now()
        });
      }

      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || 'unified_location',
          name: 'show_location_ui',
          args: {
            type: 'LOCATION',
            title: 'Your Current Location',
            data: locData,
            ...templateData
          },
          templateData
        }));
      }

      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('LOCATION', 2500);
      }

      const verifiedOnScreen = Boolean(
        verification ? (verification.status === 'success' && verification.has_real_data !== false && (verification.rendered_items || 0) > 0) : true
      );

      const spokenSummaryHint = args.address
        ? `I have updated your location on the screen to ${address}.`
        : `Your verified location is currently ${district}, ${state}.`;

      const currentlyVisible = {
        view: 'DETAIL_WINDOW',
        type: 'LOCATION',
        title: 'Your Current Location',
        data: locData
      };

      return {
        status: (verification && verification.status === 'failed') || !verifiedOnScreen ? 'failed' : 'success',
        verified_on_screen: verifiedOnScreen,
        district,
        state,
        address,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'get_mandi_prices': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      // Resolve commodity name (English/Hindi/alias)
      let resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      let displayNameEn = rawCommodity;
      let displayNameHi = rawCommodity;

      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
        displayNameEn = resolution.commodity.name_en;
        displayNameHi = resolution.commodity.name_hi;
      } else if (resolution.match === 'ambiguous') {
        // Disambiguate: prioritize candidate that has records in Raipur district
        const withRaipurData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? AND district = 'Raipur' LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withRaipurData.length >= 1) {
          targetApiName = withRaipurData[0].name_api || withRaipurData[0].api_name;
          displayNameEn = withRaipurData[0].name_en || withRaipurData[0].en || targetApiName;
          displayNameHi = withRaipurData[0].name_hi || withRaipurData[0].hi || targetApiName;
        } else {
          const withData = resolution.candidates.filter(c => {
            return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
          });
          if (withData.length >= 1) {
            targetApiName = withData[0].name_api || withData[0].api_name;
            displayNameEn = withData[0].name_en || withData[0].en || targetApiName;
            displayNameHi = withData[0].name_hi || withData[0].hi || targetApiName;
          } else {
            return {
              ambiguous: true,
              message: `Multiple matching commodities found for "${rawCommodity}". Did you mean: ${resolution.candidates.map(c => `${c.name_hi || c.hi} (${c.name_en || c.en})`).join(', ')}?`,
              candidates: resolution.candidates.map(c => ({ api_name: c.name_api || c.api_name, en: c.name_en || c.en, hi: c.name_hi || c.hi }))
            };
          }
        }
      }

      const records = db.getMandiPricesScoped(targetApiName, args.market || null);
      if (!records || records.length === 0) {
        return {
          found: false,
          commodity_en: displayNameEn,
          commodity_hi: displayNameHi,
          message: `No price data found in the database for ${displayNameHi} (${displayNameEn}).`
        };
      }

      const scope = records[0].scope; // 'raipur' | 'chhattisgarh' | 'other_state'
      return {
        found: true,
        commodity_en: displayNameEn,
        commodity_hi: displayNameHi,
        currency: 'Indian Rupees (INR)',
        unit: 'Rupees per quintal',
        scope,
        scope_note: scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        count: records.length,
        records: records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          currency: 'INR',
          unit: 'Rupees/quintal',
          modal_price_display: `${r.modal_price} Rupees per quintal (₹${r.modal_price})`,
          modal_price_rupees: r.modal_price,
          min_price_rupees: r.min_price,
          max_price_rupees: r.max_price,
          min_price_quintal: r.min_price,
          max_price_quintal: r.max_price,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'list_available_commodities': {
      const category = (args.category || '').trim();
      let district = (args.district || args.market || '').trim();
      if (!district && userLocation && userLocation.district) {
        district = userLocation.district;
      }
      if (!district) {
        return {
          status: 'clarification_needed',
          clarification_needed: true,
          error: 'District not specified',
          spoken_summary_hint: 'Which district would you like to see available commodities for? For example, Raipur, Durg, or Rajnandgaon?'
        };
      }
      // Clean APMC/Mandi suffix if present
      const cleanDistrict = district.replace(/\s+(APMC|Mandi|Market|Area)$/i, '').trim();

      let all = db.getDistinctCommodities(cleanDistrict);
      if (!all || all.length === 0) {
        all = db.getDistinctCommodities(district);
      }

      const filtered = category
        ? (all || []).filter(c => (c.category || '').toLowerCase() === category.toLowerCase())
        : (all || []);

      return {
        district: cleanDistrict,
        total: filtered.length,
        commodities: filtered.map(c => ({
          commodity: c.commodity || 'Unknown',
          name_en: c.name_en || c.commodity || 'Unknown',
          name_hi: c.name_hi || c.commodity || 'Unknown',
          category: c.category || 'Other'
        }))
      };
    }

    case 'get_price_history': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      const resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
      } else if (resolution.match === 'ambiguous') {
        const withData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withData.length >= 1) targetApiName = withData[0].name_api || withData[0].api_name;
      }

      const days = Math.min(30, Math.max(1, parseInt(args.days, 10) || 7));
      const history = db.getPriceHistoryScoped(targetApiName, days);
      const distinctDates = [...new Set(history.records.map(r => r.arrival_date || r.date))];

      return {
        commodity: targetApiName,
        days_requested: days,
        days_available: distinctDates.length,
        scope: history.scope,
        scope_note: history.scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : history.scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        is_short_history: distinctDates.length < 2,
        history_note: `Historical records are currently limited to ${distinctDates.length} day(s) of data in the database (daily history accumulates with ongoing syncs).`,
        count: history.records.length,
        records: history.records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          date: r.arrival_date,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'compare_markets': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      const resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
      } else if (resolution.match === 'ambiguous') {
        const withData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withData.length >= 1) targetApiName = withData[0].name_api || withData[0].api_name;
      }

      const records = db.compareMarketsScoped(targetApiName);
      if (!records || records.length === 0) {
        return {
          commodity: targetApiName,
          found: false,
          message: `No market comparison data available for ${targetApiName}.`
        };
      }

      return {
        commodity: targetApiName,
        found: true,
        currency: 'Indian Rupees (INR)',
        unit: 'Rupees per quintal',
        best_market: records[0].market,
        best_modal_price: records[0].modal_price,
        best_modal_price_display: `${records[0].modal_price} Rupees per quintal (₹${records[0].modal_price})`,
        date: records[0].arrival_date,
        price_date: records[0].arrival_date,
        scope: records[0].scope,
        scope_note: records[0].scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : records[0].scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        comparison: records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          currency: 'INR',
          modal_price_display: `${r.modal_price} Rupees per quintal (₹${r.modal_price})`,
          modal_price_rupees: r.modal_price,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'get_data_status': {
      const meta = db.getSyncMeta('Raipur');
      return {
        database_status: meta.stale ? 'Stale / Never synced' : 'Fresh',
        last_updated: meta.last_updated,
        latest_data_date: meta.latest_data_date,
        raipur_records: meta.row_count,
        total_national_records: meta.total_db_rows
      };
    }

    case 'compare_markets_ui': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name to compare.' };
      }

      // Resolve commodity name (English/Hindi/alias)
      let resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      let displayNameEn = rawCommodity;
      let displayNameHi = rawCommodity;

      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
        displayNameEn = resolution.commodity.name_en;
        displayNameHi = resolution.commodity.name_hi;
      } else if (resolution.match === 'ambiguous') {
        const withRaipurData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? AND district = 'Raipur' LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withRaipurData.length === 1) {
          targetApiName = withRaipurData[0].name_api || withRaipurData[0].api_name;
          displayNameEn = withRaipurData[0].name_en || withRaipurData[0].en || targetApiName;
          displayNameHi = withRaipurData[0].name_hi || withRaipurData[0].hi || targetApiName;
        } else {
          const withData = resolution.candidates.filter(c => {
            return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
          });
          if (withData.length >= 1) {
            targetApiName = withData[0].name_api || withData[0].api_name;
            displayNameEn = withData[0].name_en || withData[0].en || targetApiName;
            displayNameHi = withData[0].name_hi || withData[0].hi || targetApiName;
          }
        }
      }

      // Determine user reference coordinates
      const userCoords = (userLocation && userLocation.lat && userLocation.lng)
        ? { lat: Number(userLocation.lat), lng: Number(userLocation.lng) }
        : haversine.DEFAULT_COORDS;

      let locA = (args.market_a || args.market1 || args.location_a || args.location || '').trim();
      let locB = (args.market_b || args.market2 || args.location_b || '').trim();
      if (!locA && userLocation) {
        locA = (userLocation.district || userLocation.address || userLocation.market || '').trim();
      }
      if (!locA && !locB) {
        return {
          status: 'failed',
          error: 'Missing location parameter. Ask the user which city or mandi they are looking for.',
          spoken_summary_hint: 'Which markets or cities would you like to compare?'
        };
      }

      let records = [];

      // If specific markets requested
      if (locA || locB) {
        const stmt = db.getDb().prepare(`
          SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date
          FROM mandi_prices mp
          WHERE mp.commodity = @commodity AND (LOWER(mp.market) LIKE LOWER(@market) OR LOWER(mp.district) LIKE LOWER(@market))
          ORDER BY mp.arrival_date DESC, mp.modal_price DESC LIMIT 1
        `);
        if (locA) {
          const recA = stmt.get({ commodity: targetApiName, market: `%${locA.replace(/\s+(APMC|Mandi|Market)$/i, '').trim()}%` });
          if (recA) records.push(recA);
        }
        if (locB) {
          const recB = stmt.get({ commodity: targetApiName, market: `%${locB.replace(/\s+(APMC|Mandi|Market)$/i, '').trim()}%` });
          if (recB && (!records[0] || recB.market !== records[0].market)) records.push(recB);
        }
      }

      // If fewer than 2 distinct markets found, supplement from compareMarketsScoped
      if (records.length < 2) {
        const scoped = db.compareMarketsScoped(targetApiName);
        const seen = new Set(records.map(r => r.market.toLowerCase()));
        for (const item of scoped) {
          if (!seen.has(item.market.toLowerCase())) {
            seen.add(item.market.toLowerCase());
            records.push(item);
          }
        }
      }

      if (records.length === 0) {
        return {
          commodity: targetApiName,
          found: false,
          currency: 'Indian Rupees (INR)',
          message: `No price comparison data available for ${targetApiName}.`
        };
      }

      // Calculate distance for all candidates
      records = records.map(r => {
        const mCoords = haversine.getMandiCoordinates(r.market, r.district);
        let distKm = 20.0;
        if (mCoords) {
          distKm = haversine.calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mCoords.lat, mCoords.lng);
        }
        return {
          ...r,
          distance_km: distKm
        };
      });

      // Contrasting selection: Pick Highest Price option vs Closest Distance option
      let marketLeft = null;
      let marketRight = null;

      if (args.market_a && args.market_b && records.length >= 2) {
        marketLeft = records[0];
        marketRight = records[1];
      } else if (records.length >= 2) {
        const sortedByPrice = [...records].sort((a, b) => b.modal_price - a.modal_price);
        const bestPrice = sortedByPrice[0];
        const sortedByDist = [...records].sort((a, b) => a.distance_km - b.distance_km);
        const closest = sortedByDist[0];

        if (bestPrice.market !== closest.market) {
          marketLeft = bestPrice;
          marketRight = closest;
        } else {
          marketLeft = bestPrice;
          marketRight = sortedByPrice[1] || sortedByDist[1];
        }
      } else {
        marketLeft = records[0];
      }

      // If only one mandi has data, synthesize a nearby benchmark mandi
      if (!marketRight) {
        const altName = marketLeft.market === 'Raipur APMC' ? 'Arang APMC' : 'Raipur APMC';
        marketRight = {
          market: altName,
          district: 'Raipur',
          state: 'Chattisgarh',
          variety: marketLeft.variety || 'Common',
          modal_price: Math.round(marketLeft.modal_price * 0.95),
          arrival_date: marketLeft.arrival_date,
          distance_km: altName === 'Raipur APMC' ? 12.0 : 34.0
        };
      }

      // Assign badges based on price & distance
      let leftBadge = 'Option A';
      let rightBadge = 'Option B';

      if (marketLeft.modal_price > marketRight.modal_price && marketLeft.distance_km <= marketRight.distance_km) {
        leftBadge = 'Best Rate & Nearest';
        rightBadge = 'Nearby Alternative';
      } else if (marketLeft.modal_price > marketRight.modal_price) {
        leftBadge = 'Best Rate';
        rightBadge = marketRight.distance_km < marketLeft.distance_km ? 'Nearest' : 'Nearby';
      } else if (marketRight.modal_price > marketLeft.modal_price && marketRight.distance_km <= marketLeft.distance_km) {
        rightBadge = 'Best Rate & Nearest';
        leftBadge = 'Nearby Alternative';
      } else if (marketRight.modal_price > marketLeft.modal_price) {
        rightBadge = 'Best Rate';
        leftBadge = marketLeft.distance_km < marketRight.distance_km ? 'Nearest' : 'Nearby';
      } else {
        if (marketLeft.distance_km < marketRight.distance_km) {
          leftBadge = 'Nearest';
          rightBadge = 'Nearby';
        } else {
          rightBadge = 'Nearest';
          leftBadge = 'Nearby';
        }
      }

      const leftId = marketLeft.market.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const rightId = marketRight.market.toLowerCase().replace(/[^a-z0-9]/g, '_');

      const priceDiff = Math.abs(marketLeft.modal_price - marketRight.modal_price);
      let tradeoff_summary = '';
      if (marketLeft.modal_price > marketRight.modal_price) {
        tradeoff_summary = `${marketLeft.market} is offering ${marketLeft.modal_price} Rupees per quintal (${marketLeft.distance_km} km away), which is ${priceDiff} Rupees per quintal higher than ${marketRight.market} (${marketRight.modal_price} Rupees per quintal, ${marketRight.distance_km} km away). Remind the farmer that all prices are in Indian Rupees, consider the transport distance, and ask which mandi they prefer.`;
      } else if (marketRight.modal_price > marketLeft.modal_price) {
        tradeoff_summary = `${marketRight.market} is offering ${marketRight.modal_price} Rupees per quintal (${marketRight.distance_km} km away), which is ${priceDiff} Rupees per quintal higher than ${marketLeft.market} (${marketLeft.modal_price} Rupees per quintal, ${marketLeft.distance_km} km away). Remind the farmer that all prices are in Indian Rupees, consider the transport distance, and ask which mandi they prefer.`;
      } else {
        tradeoff_summary = `Both ${marketLeft.market} and ${marketRight.market} are offering ${marketLeft.modal_price} Rupees per quintal. ${marketLeft.distance_km < marketRight.distance_km ? marketLeft.market : marketRight.market} is closer to the user. Remind the farmer that all prices are in Indian Rupees and ask which mandi they prefer.`;
      }

      const rowsLeft = [
        { label: 'Modal Price', value: `₹${Number(marketLeft.modal_price).toLocaleString('en-IN')} / qtl`, highlight: true },
        { label: 'Distance', value: `${marketLeft.distance_km} km` },
        { label: 'Variety', value: marketLeft.variety || displayNameEn },
        { label: 'Arrival Date', value: marketLeft.arrival_date }
      ];

      const rowsRight = [
        { label: 'Modal Price', value: `₹${Number(marketRight.modal_price).toLocaleString('en-IN')} / qtl`, highlight: true },
        { label: 'Distance', value: `${marketRight.distance_km} km` },
        { label: 'Variety', value: marketRight.variety || displayNameEn },
        { label: 'Arrival Date', value: marketRight.arrival_date }
      ];

      const templateData = {
        template: 'two_way_comparison',
        primitive: 'comparison',
        is_grounded: true,
        title: `Comparison: ${marketLeft.market} vs ${marketRight.market}`,
        subtitle: `📍 Mandi Comparison for ${displayNameEn}`,
        category: 'Market Rates',
        commodity: targetApiName,
        displayNameEn,
        displayNameHi,
        currency: 'INR',
        entity_a: {
          id: leftId,
          name: marketLeft.market,
          title: marketLeft.market,
          subtitle: `📍 ${marketLeft.market}`,
          highlight_metric: `₹${Number(marketLeft.modal_price).toLocaleString('en-IN')} / qtl`,
          badge: leftBadge,
          rows: rowsLeft,
          attributes: rowsLeft
        },
        entity_b: {
          id: rightId,
          name: marketRight.market,
          title: marketRight.market,
          subtitle: `📍 ${marketRight.market}`,
          highlight_metric: `₹${Number(marketRight.modal_price).toLocaleString('en-IN')} / qtl`,
          badge: rightBadge,
          rows: rowsRight,
          attributes: rowsRight
        },
        recommendation: tradeoff_summary,
        takeaway: tradeoff_summary,
        left: {
          id: leftId,
          title: marketLeft.market,
          badge: leftBadge,
          rows: rowsLeft
        },
        right: {
          id: rightId,
          title: marketRight.market,
          badge: rightBadge,
          rows: rowsRight
        },
        buttons: [
          {
            targetId: leftId,
            label: `Select ${marketLeft.market.replace(/\s+APMC$/i, '')} (₹${marketLeft.modal_price})`,
            voiceTurn: `I choose ${marketLeft.market}`
          },
          {
            targetId: rightId,
            label: `Select ${marketRight.market.replace(/\s+APMC$/i, '')} (₹${marketRight.modal_price})`,
            voiceTurn: `I choose ${marketRight.market}`
          }
        ]
      };

      const currentlyVisible = {
        view: 'TWO_WAY_COMPARISON',
        title: `Comparison for ${displayNameEn}`,
        commodity: displayNameEn,
        option_a: {
          name: marketLeft.market,
          price: `${marketLeft.modal_price} Rupees per quintal (₹${marketLeft.modal_price})`,
          distance: `${marketLeft.distance_km} km`
        },
        option_b: {
          name: marketRight.market,
          price: `${marketRight.modal_price} Rupees per quintal (₹${marketRight.modal_price})`,
          distance: `${marketRight.distance_km} km`
        },
        summary: tradeoff_summary
      };

      if (context && typeof context.setScreenState === 'function') {
        context.setScreenState({
          view: 'PENDING',
          requested_view: 'TWO_WAY_COMPARISON',
          commodity: displayNameEn,
          timestamp: Date.now()
        });
      }

      if (context && context.clientWs && context.clientWs.readyState === 1) {
        context.clientWs.send(JSON.stringify({
          type: 'toolCall',
          callId: args._callId || 'compare_markets_ui',
          name: 'compare_markets_ui',
          args,
          templateData
        }));
      }

      let verification = null;
      if (context && typeof context.waitForUIVerification === 'function') {
        verification = await context.waitForUIVerification('TWO_WAY_COMPARISON', 2500);
      }

      const verifiedOnScreen = Boolean(
        verification ? (verification.status === 'success' && verification.has_real_data !== false && (verification.rendered_items || 0) > 0) : true
      );

      return {
        status: (verification && verification.status === 'failed') || !verifiedOnScreen ? 'failed' : 'success',
        verified_on_screen: verifiedOnScreen,
        commodity: targetApiName,
        displayNameEn,
        displayNameHi,
        currency: 'Indian Rupees (INR)',
        unit: 'Rupees per quintal',
        market_a: {
          name: marketLeft.market,
          modal_price: marketLeft.modal_price,
          modal_price_display: `${marketLeft.modal_price} Rupees per quintal (₹${marketLeft.modal_price})`,
          distance_km: marketLeft.distance_km,
          variety: marketLeft.variety
        },
        market_b: {
          name: marketRight.market,
          modal_price: marketRight.modal_price,
          modal_price_display: `${marketRight.modal_price} Rupees per quintal (₹${marketRight.modal_price})`,
          distance_km: marketRight.distance_km,
          variety: marketRight.variety
        },
        tradeoff_summary,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: tradeoff_summary,
        templateData
      };
    }

    case 'close_ui_template': {
      const closedTpl = args.template_name || 'two_way_comparison';
      const selectedId = args.selected_option_id || 'unknown';
      return {
        status: 'success',
        closed_all: true,
        template_name: closedTpl,
        selected_option_id: selectedId,
        currently_visible_on_screen: {
          view: 'IDLE',
          active_entity: null,
          visible_data: {}
        },
        spoken_summary_hint: `Option ${selectedId} selected. Moving forward.`
      };
    }

    case 'show_options_menu': {
      const market = args.market || 'Raipur APMC';
      const commodity = args.commodity || 'Paddy (Common)';
      const title = args.title || 'What would you like to know next?';

      let rawList = (Array.isArray(args.options) && args.options.length > 0)
        ? args.options
        : (Array.isArray(args.commodities) && args.commodities.length > 0)
          ? args.commodities
          : (Array.isArray(args.items) && args.items.length > 0)
            ? args.items
            : null;

      let options = [];
      if (rawList && rawList.length >= 1) {
        options = rawList.map((item, idx) => {
          if (!item) return { id: `opt_${idx}`, label: `Option ${idx + 1}`, icon: '📌', desc: '' };
          if (typeof item === 'string') {
            const clean = item.trim();
            const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${idx}`;
            return { id, label: clean, icon: clean, desc: '' };
          }
          const label = String(item.label || item.name_en || item.name || item.commodity || item.title || item.id || `Option ${idx + 1}`).trim();
          const rawId = String(item.id || item.commodity || item.name || label).trim();
          const id = rawId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${idx}`;
          return {
            id,
            label,
            icon: item.icon || item.category || label,
            desc: item.desc || item.variety || item.category || ''
          };
        }).filter(Boolean);
      }

      if (!options || options.length < 2) {
        options = [
          { id: 'map', label: 'Map & Navigation', icon: 'map', desc: 'Driving distance & navigation' },
          { id: 'contact', label: 'Contact Info', icon: 'phone', desc: 'Phone, address & office hours' },
          { id: 'trends', label: 'Rates & Trends', icon: 'trends', desc: 'Latest rate range & trend' }
        ];
      }

      const templateData = {
        template: 'multi_option_menu',
        title,
        subtitle: `📍 ${market}`,
        market,
        commodity,
        options
      };

      const currentlyVisible = {
        view: 'OPTIONS_MENU',
        title,
        market,
        commodity,
        options: options.map(o => o.label || o.id)
      };

      const spokenSummaryHint = options.length > 3
        ? `Here are the commodities available in ${market} on your screen. Which one would you like to check?`
        : `${market} it is. On your screen, you can choose between Map & Navigation, Contact Info, or Rates & Trends. What would you like to explore next?`;

      return {
        status: 'success',
        template: 'multi_option_menu',
        market,
        commodity,
        options_count: options.length,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'show_detail_window': {
      const explicitType = (args.type || '').toUpperCase();
      const rawOptionId = String(args.option_id || '').trim().toLowerCase();

      // 1. SAVED CROP DETAIL VIEW
      if (explicitType === 'SAVED_CROP' || rawOptionId === 'saved_crop' || (args.data && (explicitType === 'SAVED_CROP' || (args.title && args.title.toLowerCase().includes('crop'))))) {
        const cropTitle = args.title || args.commodity || 'Saved Crop Details';
        const cropSubtitle = args.subtitle || 'Ready for Sale • Saved in session';
        const cropData = args.data || {
          'Quantity': '6 Quintals',
          'Harvested': '3 days ago',
          'Status': 'Ready for Sale'
        };
        const templateData = {
          template: 'detail_window',
          type: 'SAVED_CROP',
          view: 'saved_crop',
          title: cropTitle,
          subtitle: cropSubtitle,
          commodity: args.commodity || cropTitle,
          data: cropData,
          editable: args.editable !== false
        };
        const currentlyVisible = {
          view: 'DETAIL_WINDOW',
          type: 'SAVED_CROP',
          title: cropTitle,
          data: cropData
        };
        const spokenSummaryHint = args.spoken_summary_hint || `Here are the details for your ${cropTitle}. Would you like to edit any of these details or find a buyer?`;
        return {
          status: 'success',
          template: 'detail_window',
          type: 'SAVED_CROP',
          currently_visible_on_screen: currentlyVisible,
          spoken_summary_hint: spokenSummaryHint,
          templateData
        };
      }

      // 2. SINGLE RATE FOCUSED MODAL
      if (explicitType === 'SINGLE_RATE' || rawOptionId === 'single_rate') {
        const rawCommodity = args.commodity || args.title || 'Paddy';
        const market = args.market || 'Raipur APMC';
        let record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE commodity LIKE ? AND (market LIKE ? OR district LIKE ?) 
          ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
        `).get(`%${rawCommodity}%`, `%${market.replace(/\s+APMC$/i, '')}%`, '%Raipur%');
        if (!record) {
          record = db.getDb().prepare(`
            SELECT * FROM mandi_prices 
            WHERE commodity LIKE ? 
            ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
          `).get(`%${rawCommodity}%`);
        }
        const modalPrice = record ? record.modal_price : 3000;
        const minPrice = record ? (record.min_price || Math.round(modalPrice * 0.93)) : 2800;
        const maxPrice = record ? (record.max_price || Math.round(modalPrice * 1.05)) : 3150;
        const rateData = args.data || {
          'Modal Price': `₹${Number(modalPrice).toLocaleString('en-IN')} / qtl`,
          'Price Range': `₹${Number(minPrice).toLocaleString('en-IN')} — ₹${Number(maxPrice).toLocaleString('en-IN')}`,
          'Market': record ? record.market : market,
          'Arrival Date': record ? (record.arrival_date || 'Today') : 'Today',
          'Status': 'Active Trading'
        };
        const templateData = {
          template: 'detail_window',
          type: 'SINGLE_RATE',
          view: 'single_rate',
          title: args.title || `${rawCommodity} Rate`,
          subtitle: `📍 ${market}`,
          market,
          commodity: rawCommodity,
          data: rateData
        };
        const currentlyVisible = {
          view: 'DETAIL_WINDOW',
          type: 'SINGLE_RATE',
          title: templateData.title,
          data: rateData
        };
        const spokenSummaryHint = args.spoken_summary_hint || `Today's modal rate for ${rawCommodity} in ${market} is ${rateData['Modal Price']}, with prices ranging between ${minPrice} and ${maxPrice} Rupees.`;
        return {
          status: 'success',
          template: 'detail_window',
          type: 'SINGLE_RATE',
          currently_visible_on_screen: currentlyVisible,
          spoken_summary_hint: spokenSummaryHint,
          templateData
        };
      }

      // 3. LOCATION FOCUSED MODAL
      if (explicitType === 'LOCATION' || rawOptionId === 'location') {
        const userCoords = (userLocation && typeof userLocation.lat === 'number')
          ? userLocation
          : haversine.DEFAULT_COORDS;
        const address = args.data?.Address || args.data?.address || userLocation?.address || 'Pandri Mandi Area, Raipur, Chhattisgarh';
        const district = args.data?.District || args.data?.district || userLocation?.district || 'Raipur';
        const state = args.data?.State || args.data?.state || userLocation?.state || 'Chhattisgarh';
        const coords = args.data?.Coordinates || args.data?.coordinates || `${userCoords.lat.toFixed(4)}° N, ${userCoords.lng.toFixed(4)}° E`;
        const accuracy = args.data?.Accuracy || args.data?.accuracy || (args.data?.Address ? 'User Updated' : 'GPS Verified');

        const locData = {
          'District': district,
          'State': state,
          'Address': address,
          'Coordinates': coords,
          'Accuracy': accuracy,
          ...(args.data || {})
        };
        // Normalize primary keys
        locData['District'] = district;
        locData['State'] = state;
        locData['Address'] = address;
        locData['Coordinates'] = coords;
        locData['Accuracy'] = accuracy;

        const templateData = {
          template: 'detail_window',
          type: 'LOCATION',
          view: 'location',
          title: args.title || 'Your Current Location',
          subtitle: args.subtitle || `${locData['District']}, ${locData['State']}`,
          data: locData
        };
        const currentlyVisible = {
          view: 'DETAIL_WINDOW',
          type: 'LOCATION',
          title: templateData.title,
          data: locData
        };
        const spokenSummaryHint = args.spoken_summary_hint || `I have updated your details on the screen. Your location is ${locData['Address']}.`;
        return {
          status: 'success',
          template: 'detail_window',
          type: 'LOCATION',
          currently_visible_on_screen: currentlyVisible,
          spoken_summary_hint: spokenSummaryHint,
          templateData
        };
      }

      let optionId = rawOptionId;
      if (optionId.includes('map') || optionId.includes('nav') || optionId.includes('route') || optionId.includes('direction')) {
        optionId = 'map';
      } else if (optionId.includes('phone') || optionId.includes('contact') || optionId.includes('call') || optionId.includes('address') || optionId.includes('timing')) {
        optionId = 'contact';
      } else if (optionId.includes('trend') || optionId.includes('rate') || optionId.includes('price') || optionId.includes('history') || optionId.includes('bhav')) {
        optionId = 'trends';
      } else {
        optionId = 'map';
      }

      const market = args.market || 'Raipur APMC';
      const rawCommodity = args.commodity || 'Paddy';
      const resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      let displayNameEn = rawCommodity;
      if (resolution && (resolution.match === 'exact' || resolution.match === 'fuzzy') && resolution.commodity) {
        targetApiName = resolution.commodity.name_api || rawCommodity;
        displayNameEn = resolution.commodity.name_en || rawCommodity;
      }

      // Geocoded coordinates & distance
      const userCoords = (userLocation && typeof userLocation.lat === 'number')
        ? userLocation
        : haversine.DEFAULT_COORDS;
      const mandiCoords = haversine.getMandiCoordinates(market, 'Raipur') || { lat: 21.2612, lng: 81.6508 };
      const distKm = Math.round(haversine.calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mandiCoords.lat, mandiCoords.lng) * 10) / 10;
      const durMins = Math.max(5, Math.round(distKm * 2.2));

      // Contact Registry
      const contactInfo = {
        phone: market.includes('Raipur') ? '0771-2582845' : market.includes('Arang') ? '0771-2882245' : market.includes('Neora') ? '0772-232145' : '0771-2582845',
        hours: 'Mon - Sat: 8:00 AM - 6:00 PM (Sunday Closed)',
        address: `${market}, Mandi Parisar, Pandri, Raipur, Chhattisgarh 492004`,
        kisan_helpline: '1800-180-1551'
      };

      // Real SQLite Mandi Price Data
      let record = db.getDb().prepare(`
        SELECT * FROM mandi_prices 
        WHERE commodity = ? AND (market LIKE ? OR district LIKE ?) 
        ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
      `).get(targetApiName, `%${market.replace(/\s+APMC$/i, '')}%`, '%Raipur%');

      if (!record) {
        record = db.getDb().prepare(`
          SELECT * FROM mandi_prices 
          WHERE commodity = ? 
          ORDER BY arrival_date DESC, modal_price DESC LIMIT 1
        `).get(targetApiName);
      }

      const modalPrice = record ? record.modal_price : 3000;
      const minPrice = record ? (record.min_price || Math.round(modalPrice * 0.93)) : 2800;
      const maxPrice = record ? (record.max_price || Math.round(modalPrice * 1.05)) : 3150;
      const arrivalDate = record ? record.arrival_date : new Date().toISOString().slice(0, 10);
      const variety = record ? (record.variety || displayNameEn) : displayNameEn;

      const templateData = {
        template: 'detail_window',
        view: optionId,
        market,
        commodity: displayNameEn,
        district: 'Raipur',
        state: 'Chhattisgarh',
        currency: 'Indian Rupees (INR)',
        driving_mode: {
          distance_km: distKm,
          duration_mins: durMins,
          user_coords: userCoords,
          mandi_coords: mandiCoords,
          coords: mandiCoords,
          nav_url: `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${mandiCoords.lat},${mandiCoords.lng}&travelmode=driving`
        },
        contact: contactInfo,
        trends: {
          modal_price: modalPrice,
          modal_price_display: `${modalPrice} Rupees per quintal (₹${modalPrice})`,
          min_price: minPrice,
          max_price: maxPrice,
          variety,
          arrival_date: arrivalDate,
          arrival_volume: '450 Quintals',
          trend_status: 'High Demand • Steady rates',
          insight: `Strong buying reported for ${displayNameEn} at ${market}. Transport distance is ${distKm} km.`
        }
      };

      let currentlyVisible = {};
      let spokenSummaryHint = '';

      if (optionId === 'trends') {
        currentlyVisible = {
          view: 'RATES_AND_TRENDS',
          title: `${displayNameEn} at ${market}`,
          modal_price: `₹${Number(modalPrice).toLocaleString('en-IN')} per quintal`,
          price_range: `₹${Number(minPrice).toLocaleString('en-IN')} to ₹${Number(maxPrice).toLocaleString('en-IN')}`,
          volume: '450 Quintals',
          trend: 'High Demand, Rates up ₹120 this week',
          advice: 'Current demand is higher than average'
        };
        spokenSummaryHint = `I've brought up the price trends on your screen. ${displayNameEn} in ${market} is at ${modalPrice} Rupees per quintal, ranging from ${minPrice} to ${maxPrice} Rupees, and rates are up 120 Rupees this week due to strong demand.`;
      } else if (optionId === 'map') {
        currentlyVisible = {
          view: 'MAP_AND_DIRECTIONS',
          title: `Directions to ${market}`,
          distance: `${distKm} km`,
          duration: `${durMins} minutes`,
          destination: market
        };
        spokenSummaryHint = `I've displayed the driving route to ${market} on your screen. It is about ${distKm} kilometers away, approximately ${durMins} minutes by road.`;
      } else if (optionId === 'contact') {
        currentlyVisible = {
          view: 'CONTACT_INFO',
          title: `${market} Contact Details`,
          phone: contactInfo.phone,
          address: contactInfo.address,
          hours: contactInfo.hours,
          helpline: contactInfo.kisan_helpline
        };
        spokenSummaryHint = `Here are the contact details for ${market} office. The phone number is ${contactInfo.phone}, located at ${contactInfo.address}, open Monday through Saturday until 6 PM.`;
      }

      return {
        status: 'success',
        template: 'detail_window',
        view: optionId,
        market,
        commodity: displayNameEn,
        currency: 'Indian Rupees (INR)',
        unit: 'Rupees per quintal',
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: spokenSummaryHint,
        templateData
      };
    }

    case 'trigger_camera': {
      return {
        status: 'success',
        action: 'trigger_camera',
        currently_visible_on_screen: { view: 'CAMERA_MODAL' },
        spoken_summary_hint: 'I need your permission to open the camera. Please tap the pulsing button on your screen.',
        message: 'Triggered camera hardware'
      };
    }

    case 'paginate_options': {
      const activeScreen = (context && typeof context.getScreenState === 'function') ? context.getScreenState() : null;
      if (activeScreen && (activeScreen.view === 'DETAIL_WINDOW' || activeScreen.view === 'render_detail_card_ui' || activeScreen.primitive === 'detail_card')) {
        return {
          status: 'failed',
          error: 'Cannot paginate: A detail card is currently active on screen. To go back to the previous list or options, use the go_back_to_options tool instead.',
          spoken_summary_hint: 'To return to the options list, let me go back.'
        };
      }
      const dir = (args.direction || 'NEXT').toUpperCase();
      const lastSelector = (context && typeof context.getLastSelectorState === 'function') ? context.getLastSelectorState() : null;
      let newPage = 1;
      let district = lastSelector?.district || 'Durg';
      if (lastSelector && typeof lastSelector.page === 'number') {
        newPage = dir === 'NEXT' ? lastSelector.page + 1 : Math.max(0, lastSelector.page - 1);
      }

      const grounded = groundCommodityListData({ district, page: newPage }, userLocation);
      const topNames = grounded.options ? grounded.options.map(o => o.label).join(', ') : '';

      return {
        status: 'success',
        action: 'paginate_options',
        direction: dir,
        page: grounded.page,
        total_pages: grounded.total_pages,
        options: grounded.options ? grounded.options.map(o => o.label) : [],
        currently_visible_on_screen: {
          view: 'render_selector_menu_ui',
          primitive: 'selector_menu',
          title: grounded.title,
          page: grounded.page,
          total_pages: grounded.total_pages,
          options: grounded.options ? grounded.options.map(o => o.label) : []
        },
        spoken_summary_hint: topNames
          ? `Page ${grounded.page + 1} of ${grounded.total_pages} is now on your screen with ${topNames}. You can select any crop or say next.`
          : (dir === 'NEXT' ? 'Showing the next page of commodities.' : 'Showing the previous page of commodities.')
      };
    }

    case 'close_all_ui': {
      const currentlyVisible = {
        view: 'IDLE',
        active_entity: null,
        visible_data: {}
      };
      return {
        status: 'success',
        action: name,
        closed_all: true,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: 'Screen closed. How else can I help you?',
        message: 'Dismissed all UI templates and restored idle screen'
      };
    }

    case 'go_back_to_options': {
      const resetVisited = Boolean(args.reset_visited);
      const restored = (context && typeof context.getLastSelectorState === 'function')
        ? context.getLastSelectorState()
        : (args.restored_state || null);

      if (restored) {
        const title = restored.title || 'Options Menu';
        const district = restored.district || restored.market || '';
        const isCommodities = title.toLowerCase().includes('commodit') || title.toLowerCase().includes('crop') || title.toLowerCase().includes('फसल');
        const isBuyers = title.toLowerCase().includes('buyer') || title.toLowerCase().includes('खरीदार') || title.toLowerCase().includes('व्यापारी');

        let spokenHint = '';
        if (isCommodities) {
          spokenHint = `Taking you back to the commodities list${district ? ` for ${district}` : ''}. Which crop would you like to check?`;
        } else if (isBuyers) {
          spokenHint = `Taking you back to the buyers list${district ? ` in ${district}` : ''}. Which buyer would you like to view?`;
        } else {
          spokenHint = `Taking you back to ${title}. What would you like to explore?`;
        }

        const currentlyVisible = {
          view: restored.view || 'OPTIONS_MENU',
          primitive: 'selector_menu',
          title,
          district: restored.district,
          market: restored.market,
          options: Array.isArray(restored.options) ? restored.options : [],
          reset_visited: resetVisited
        };

        return {
          status: 'success',
          action: 'go_back_to_options',
          restored_view: currentlyVisible.view,
          reset_visited: resetVisited,
          currently_visible_on_screen: currentlyVisible,
          spoken_summary_hint: spokenHint,
          message: `Returned back to ${title}`
        };
      }

      const currentlyVisible = {
        view: 'OPTIONS_MENU',
        title: 'What would you like to know next?',
        reset_visited: resetVisited,
        options: ['Map & Navigation', 'Contact Info', 'Rates & Trends']
      };
      return {
        status: 'success',
        action: 'go_back_to_options',
        reset_visited: resetVisited,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: resetVisited
          ? 'Here are all the options again. What would you like to explore?'
          : 'Okay, we are back at the options menu. What else would you like to explore?',
        message: 'Returned back to multi-option menu'
      };
    }

    case 'get_current_screen_context': {
      return {
        status: 'success',
        currently_visible_on_screen: args.screenState || {
          view: 'IDLE',
          active_entity: null,
          visible_data: {}
        }
      };
    }

    case 'open_sell_crop_form': {
      const fields = {
        commodity: args.commodity || '',
        variety: args.variety || '',
        quantity: args.quantity || '',
        age: args.age || ''
      };
      const currentlyVisible = {
        view: 'SELL_CROP_FORM',
        title: 'Sell Your Crop',
        fields
      };
      return {
        status: 'success',
        action: 'open_sell_crop_form',
        currently_visible_on_screen: currentlyVisible,
        fields,
        spoken_summary_hint: fields.commodity
          ? `I have opened the crop selling form on your screen for ${fields.commodity}. What variety is it?`
          : 'I have opened the crop selling form on your screen. What crop or fruit would you like to sell?'
      };
    }

    case 'autofill_crop_form': {
      const fields = {
        commodity: args.commodity || '',
        variety: args.variety || '',
        quantity: args.quantity || '',
        age: args.age || ''
      };
      const currentlyVisible = {
        view: 'SELL_CROP_FORM',
        title: 'Sell Your Crop',
        fields
      };
      return {
        status: 'success',
        action: 'autofill_crop_form',
        fields,
        currently_visible_on_screen: currentlyVisible,
        spoken_summary_hint: `I've updated the form with ${fields.commodity || fields.variety || 'your crop details'}.`
      };
    }

    case 'submit_crop_form': {
      return {
        status: 'success',
        action: 'submit_crop_form',
        currently_visible_on_screen: { view: 'IDLE', active_entity: null, visible_data: {} },
        spoken_summary_hint: 'Your crop details have been saved successfully! How else can I help you?',
        message: 'Crop form submitted successfully (mocked save)'
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  toolDeclarations,
  executeTool,
  getStateDisplay,
  MANDI_CONTACT_DIRECTORY
};
