const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You turn a short text message from a family tracking app into strict JSON.
The app has three sections: budget, calories, exercise.

Return ONLY a JSON object, no prose, no markdown fences, matching exactly this shape:

{
  "section": "budget" | "calories" | "exercise" | "unknown",
  "target_person": string | null,
  "budget": { "amount": number, "bucket_name": string, "description": string } | null,
  "calories": { "direct_amount": number | null, "food_items": string[], "food_items_estimated_calories": number[] } | null,
  "exercise": { "description": string } | null
}

Rules:
- "target_person" is who the entry is FOR, taken from the list of known people names given to you.
  Only set it if the message explicitly names one of them (e.g. "for Joe", "Hillary: ..."). Otherwise null
  (the app will default it to whoever sent the text).
- For budget messages: extract the dollar amount as a positive number, match "bucket_name" to the
  closest one of the known bucket names given to you (copy it verbatim from that list), and put a short
  description of what was purchased in "description".
- For calorie messages: if the message is just a number of calories (e.g. "300 calories", "just log 450"),
  set "direct_amount" to that number and leave food_items empty. Otherwise, split the message into
  distinct food items in "food_items" (e.g. "Hamburger and fries" -> ["hamburger", "fries"]), and for
  each item give your own best-guess average calorie count for a typical single serving in the parallel
  array "food_items_estimated_calories" (same length/order), to be used only as a fallback if a food
  database lookup fails. Leave "direct_amount" null in that case.
- For exercise messages: put a short, clean description of the exercise performed in "description".
- If the message cannot be understood as any of the above, set "section" to "unknown" and leave the
  other fields null.
- Never include commentary, only the JSON object.`;

function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

async function parseMessage({ text, senderName, knownPeopleNames, bucketNames }) {
  const userPrompt = `Known people: ${knownPeopleNames.join(', ')}
Message sender: ${senderName}
Known budget buckets: ${bucketNames.join(', ')}

Message: """${text}"""`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    return JSON.parse(stripFences(raw));
  } catch (err) {
    console.error('[parser] Failed to parse model output as JSON:', raw);
    return { section: 'unknown', target_person: null, budget: null, calories: null, exercise: null };
  }
}

module.exports = { parseMessage };
