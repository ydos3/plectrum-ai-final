import dotenv from 'dotenv';
dotenv.config();

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

import { generateSongFromTitle } from '../services/geminiService.ts';

async function test() {
  try {
    console.log("Testing generation with key length:", process.env.GEMINI_API_KEY.length);
    const result = await generateSongFromTitle("ladki by kirtidan", "English");
    console.log("Result Karaoke URL:", result.karaokeUrl);
    console.log("Result Content length:", result.content?.length);
    console.log("Starts with:\n", result.content?.substring(0, 200));
  } catch(e) {
    console.error("Test failed:", e);
  }
}
test();
