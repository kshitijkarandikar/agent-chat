tool({
  name: "find_restaurants",
  description: "Search for restaurants matching a cuisine, location and time of day, optionally within a budget or for a special occasion. Use when the user asks for dining suggestions.",
  inputs: {
    cuisine: { type: "string", description: "Type of food, e.g. \"Thai\" or \"Italian\"" },
    location: { type: "string", description: "City or address, e.g. \"Amsterdam\" or \"1600 Amphitheatre Parkway, Mountain View\"" },
    time_of_day: { type: "string", description: "When the user plans to eat, e.g. \"lunch\", \"dinner\" or \"brunch\"" },
    budget: { type: "string", description: "Price level, one of \"cheap\", \"moderate\", \"expensive\"", optional: true },
    occasion: { type: "boolean", description: "True if it is a special occasion and budget can be ignored", optional: true }
  },
  needs: ["SPOONACULAR_API_KEY"],
  ask_first: false,
  run: async ({ cuisine, location, time_of_day, budget, occasion }, { env, getJSON }) => {
    const apiKey = env.SPOONACULAR_API_KEY;
    if (!apiKey) return { error: "Missing SPOONACULAR_API_KEY in .env" };

    // Build a single query string that Spoonacular expects.
    // Combine cuisine and time_of_day for better relevance.
    const query = [cuisine, time_of_day].filter(Boolean).join(" ");

    const params = new URLSearchParams({
      query,
      location,
      number: "10",
      apiKey
    });

    // Spoonacular uses priceLevel (1‑4). Map our simple strings when not a special occasion.
    if (!occasion && budget) {
      const map = { cheap: "1", moderate: "2", expensive: "3" };
      const level = map[budget.toLowerCase()];
      if (level) params.append("priceLevel", level);
    }

    try {
      const url = `https://api.spoonacular.com/food/restaurants/search?${params.toString()}`;
      const data = await getJSON(url);
      if (!data || !Array.isArray(data.restaurants)) {
        return { error: "Unexpected response format from restaurant service" };
      }
      const results = data.restaurants.map(r => ({
        name: r.name,
        address: r.address,
        rating: r.rating,
        price_level: r.priceLevel
      }));
      return { restaurants: results };
    } catch (e) {
      return { error: "Failed to fetch restaurants: " + (e.message || e) };
    }
  }
})
