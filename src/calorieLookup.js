const config = require('./config');

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const DETAIL_URL = (fdcId) => `https://api.nal.usda.gov/fdc/v1/food/${fdcId}`;

async function lookupOneFood(item) {
  try {
    const params = new URLSearchParams({
      api_key: config.usda.apiKey,
      query: item,
      dataType: 'Survey (FNDDS)',
      pageSize: '1',
    });
    const searchRes = await fetch(`${SEARCH_URL}?${params.toString()}`);
    if (!searchRes.ok) return null;
    const searchJson = await searchRes.json();
    const food = searchJson.foods && searchJson.foods[0];
    if (!food) return null;

    const energyPer100g = (food.foodNutrients || []).find(
      (n) => n.nutrientName === 'Energy' && n.unitName === 'KCAL'
    );
    if (!energyPer100g) return null;

    let gramWeight = 100;
    try {
      const detailParams = new URLSearchParams({ api_key: config.usda.apiKey });
      const detailRes = await fetch(`${DETAIL_URL(food.fdcId)}?${detailParams.toString()}`);
      if (detailRes.ok) {
        const detailJson = await detailRes.json();
        const portion = (detailJson.foodPortions || [])[0];
        if (portion && portion.gramWeight) gramWeight = portion.gramWeight;
      }
    } catch {
      // fall back to the 100g figure
    }

    const calories = Math.round((energyPer100g.value * gramWeight) / 100);
    return { item, calories, source: 'usda', matchedName: food.description };
  } catch (err) {
    console.error('[calorieLookup] USDA lookup failed for', item, err.message);
    return null;
  }
}

// items: string[], aiEstimates: number[] (same length, fallback guesses from the parser)
async function estimateCaloriesForItems(items, aiEstimates) {
  const breakdown = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const usdaResult = await lookupOneFood(item);
    if (usdaResult) {
      breakdown.push(usdaResult);
    } else {
      breakdown.push({
        item,
        calories: Math.round(aiEstimates[i] || 0),
        source: 'ai_estimate',
      });
    }
  }
  const total = breakdown.reduce((sum, b) => sum + b.calories, 0);
  return { total, breakdown };
}

module.exports = { estimateCaloriesForItems };
