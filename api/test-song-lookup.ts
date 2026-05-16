/**
 * Test API endpoint for private song database integration.
 * Used by smoke tests to verify the DB lookup is working correctly.
 */

import { generateSongFromTitle } from '../services/geminiService';
import { AppLanguage, SkillLevel } from '../types';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const { query, language = 'English', skillLevel = 'Intermediate' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required.' });
    }

    const result = await generateSongFromTitle(
      query,
      language as AppLanguage,
      skillLevel as SkillLevel
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[TestSongLookup] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
