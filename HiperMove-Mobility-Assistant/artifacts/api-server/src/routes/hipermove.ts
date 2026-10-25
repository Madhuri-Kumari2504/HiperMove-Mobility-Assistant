import OpenAI from "openai";
import { Router, type IRouter } from "express";
import {
  CreateHipermoveSessionExplanationBody,
  CreateHipermoveSessionExplanationResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const requestWindows = new Map<string, { count: number; resetAt: number }>();
const REQUEST_LIMIT = 12;
const WINDOW_MS = 60_000;

function isRateLimited(clientKey: string) {
  const now = Date.now();
  const window = requestWindows.get(clientKey);

  if (!window || window.resetAt <= now) {
    requestWindows.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  if (window.count >= REQUEST_LIMIT) return true;
  window.count += 1;
  return false;
}

router.post("/hipermove/session-explanation", async (req, res) => {
  const clientKey = req.ip ?? "unknown";
  if (isRateLimited(clientKey)) {
    res.status(429).json({ error: "Please wait a moment before requesting another explanation." });
    return;
  }

  const parsed = CreateHipermoveSessionExplanationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Session metrics are invalid." });
    return;
  }

  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "AI explanations are not configured." });
    return;
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "X-Title": "HiperMove",
      },
    });
    const metrics = parsed.data;
    const completion = await client.chat.completions.create({
      model: "google/gemma-4-26b-a4b-it",
      temperature: 0.35,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are HiperMove, a supportive movement assistant. Explain the measured squat session in clear, encouraging language. Metrics: repetitions is the detected repetition count; averageKneeAngleDegrees is the average knee angle at each rep's lowest point (approximate; a lower angle means a deeper bend); consistencyPercent reflects how consistent rep durations were; averageRepSeconds is the full standing-to-standing cycle duration; analyzedSeconds is the clip duration. These are approximate computer-vision measurements, not a clinical assessment: do not diagnose, judge the person's body, infer pain or injury, or claim medical certainty. Use only the supplied metrics. Return one JSON object with exactly three short string fields: headline, explanation, tip. The tip should be a gentle, practical observation, not medical advice.",
        },
        {
          role: "user",
          content: JSON.stringify(metrics),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response.");

    const explanation = CreateHipermoveSessionExplanationResponse.parse(
      JSON.parse(content),
    );
    res.json(explanation);
  } catch (error) {
    req.log.error({ err: error }, "Gemma session explanation failed");
    res.status(502).json({
      error: "The explanation could not be generated right now. Your movement analysis is still available.",
    });
  }
});

export default router;
