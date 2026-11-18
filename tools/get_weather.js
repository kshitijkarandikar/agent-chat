tool({
  name: "get_weather",
  description: "Get the current weather and a 3-day forecast for a city.",
  inputs: {
    city: { type: "string", description: "City name, for example Utrecht" }
  },
  run: async ({ city }, { getJSON }) => {
    const sky = (code) => code === 0 ? "clear" : code <= 3 ? "partly cloudy" : code <= 48 ? "fog" : code <= 67 ? "rain" : code <= 77 ? "snow" : code <= 82 ? "showers" : "thunderstorm";
    const geo = await getJSON("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + encodeURIComponent(city));
    if (!geo.results || !geo.results.length) return { error: "City not found: " + city };
    const place = geo.results[0];
    const w = await getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude +
      "&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code&forecast_days=3&timezone=auto");
    return {
      place: place.name + ", " + place.country,
      now: { temperature_c: w.current.temperature_2m, wind_kmh: w.current.wind_speed_10m, sky: sky(w.current.weather_code) },
      forecast: w.daily.time.map((date, i) => ({
        date,
        min_c: w.daily.temperature_2m_min[i],
        max_c: w.daily.temperature_2m_max[i],
        rain_chance_percent: w.daily.precipitation_probability_max[i],
        sky: sky(w.daily.weather_code[i])
      }))
    };
  }
})
