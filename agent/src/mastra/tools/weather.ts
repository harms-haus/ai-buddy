import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const geocodeCache = new Map<string, { lat: number; lon: number; ts: number }>();
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

function describeWind(speed: number): string {
  if (speed < 5) return "There's almost no wind.";
  if (speed < 15) return "There's a gentle breeze.";
  if (speed < 25) return "It's a little windy outside.";
  if (speed < 40) return "It's pretty windy out there!";
  return "It's super windy! Hold on to your hat!";
}

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: "The sky is clear and sunny",
  1: "The sun is out with a few fluffy clouds",
  2: "There are some clouds in the sky but you can still see the sun",
  3: "There are a lot of clouds in the sky",
  45: "It's foggy outside, like walking through a cloud",
  48: "It's foggy outside, like walking through a cloud",
  51: "It's drizzling, tiny raindrops",
  53: "It's drizzling, tiny raindrops",
  55: "It's drizzling, tiny raindrops",
  56: "Freezing drizzle. The raindrops are turning to ice",
  57: "Freezing drizzle. The raindrops are turning to ice",
  61: "It's raining outside",
  63: "It's raining outside",
  65: "It's raining outside",
  66: "Freezing rain, icy raindrops",
  67: "Freezing rain, icy raindrops",
  71: "It's snowing outside",
  73: "It's snowing outside",
  75: "It's snowing outside",
  77: "It's snowing outside",
  80: "Rain showers are passing through",
  81: "Rain showers are passing through",
  82: "Rain showers are passing through",
  85: "Snow showers are falling",
  86: "Snow showers are falling",
  95: "A thunderstorm with lots of thunder and lightning!",
  96: "A thunderstorm with hail. Stay inside!",
  99: "A thunderstorm with hail. Stay inside!",
};

function formatDailyReport(
  daily: {
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  },
  dayIndex: number,
  when: number,
  cityName: string,
): string {
  const weatherCode = daily.weather_code[dayIndex];
  const highTemp = Math.round(daily.temperature_2m_max[dayIndex]);
  const lowTemp = Math.round(daily.temperature_2m_min[dayIndex]);
  const precipProb = daily.precipitation_probability_max[dayIndex];
  const windSpeed = daily.wind_speed_10m_max[dayIndex];

  const dayLabel = when === 1 ? "Tomorrow" : `In ${when} days`;
  const description =
    WEATHER_DESCRIPTIONS[weatherCode] ?? "Interesting weather out there";

  let report = `${dayLabel} in ${cityName}: ${description.toLowerCase()}. It'll be between ${lowTemp} and ${highTemp} degrees. ${describeWind(windSpeed)}`;

  if (precipProb > 30) {
    report += ` There's a ${precipProb}% chance of rain!`;
  }

  const needsJacket =
    (weatherCode >= 51 && weatherCode <= 67) ||
    (weatherCode >= 71 && weatherCode <= 77) ||
    (weatherCode >= 80 && weatherCode <= 86) ||
    weatherCode >= 95;
  const needsCoat = highTemp < 50;

  if (needsJacket) {
    report += " Don't forget your jacket!";
  } else if (needsCoat) {
    report += " It's pretty cold. You might want a warm coat!";
  }

  return report;
}

export const weatherTool = createTool({
  id: "get-weather",
  description:
    "Get the current or forecasted weather for a location. Returns a kid-friendly weather description. Uses WEATHER_LOCATION env var as default location if no city is specified.",
  inputSchema: z.object({
    city: z
      .string()
      .optional()
      .describe(
        "City name to get weather for. If not provided, uses WEATHER_LOCATION env var."
      ),
    when: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe(
        "Days ahead to forecast: 0=now (current conditions), 1=tomorrow, up to 5 days ahead."
      ),
  }),
  outputSchema: z.object({
    report: z.string().describe("Kid-friendly weather report"),
  }),
  execute: async (inputData) => {
    const rawLocation = inputData.city || process.env.WEATHER_LOCATION;
    if (!rawLocation) {
      return {
        report:
          "I don't know where to check the weather! Can you tell me which city you're in?",
      };
    }
    const location = rawLocation.split(",")[0].trim();

    try {
      // Check geocode cache first
      const cached = geocodeCache.get(location);
      let latitude: number;
      let longitude: number;
      let cityName: string;

      if (cached && Date.now() - cached.ts < GEOCODE_TTL_MS) {
        latitude = cached.lat;
        longitude = cached.lon;
        cityName = location;
      } else {
        // Geocode the city name to coordinates
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
        );
        if (!geoRes.ok) {
          return {
            report:
              "I couldn't look up that city right now. Try again soon!",
          };
        }
        const geoData = await geoRes.json();
        if (!geoData.results || geoData.results.length === 0) {
          return {
            report:
              "I couldn't find that place on the map. Let's try a different city name!",
          };
        }
        latitude = geoData.results[0].latitude;
        longitude = geoData.results[0].longitude;
        cityName = geoData.results[0].name;

        geocodeCache.set(location, {
          lat: latitude,
          lon: longitude,
          ts: Date.now(),
        });
      }

      // Fetch weather
      const when = inputData.when ?? 0;
      let weatherUrl: string;
      if (when >= 1) {
        weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max&forecast_days=${when + 1}&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
      } else {
        weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
      }

      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) {
        return {
          report:
            "I couldn't get the weather information right now. Try again soon!",
        };
      }
      const weatherData = await weatherRes.json();

      // Format report
      let report: string;
      if (when >= 1) {
        report = formatDailyReport(weatherData.daily, when, when, cityName);
      } else {
        // Extract current conditions
        const temp: number = weatherData.current.temperature_2m;
        const weatherCode: number = weatherData.current.weather_code;
        const windSpeed: number = weatherData.current.wind_speed_10m;

        // Build kid-friendly report
        const description =
          WEATHER_DESCRIPTIONS[weatherCode] ?? "Interesting weather out there";
        report = `${description} It's ${Math.round(temp)} degrees in ${cityName}. ${describeWind(windSpeed)}`;

        const needsJacket =
          (weatherCode >= 51 && weatherCode <= 67) ||
          (weatherCode >= 71 && weatherCode <= 77) ||
          (weatherCode >= 80 && weatherCode <= 86) ||
          weatherCode >= 95;
        const needsCoat = temp < 50;

        if (needsJacket) {
          report += " Don't forget your jacket!";
        } else if (needsCoat) {
          report += " It's pretty cold. You might want a warm coat!";
        }
      }

      return { report };
    } catch {
      return {
        report:
          "Hmm, I couldn't check the weather right now. Let's try again in a little bit!",
      };
    }
  },
});
