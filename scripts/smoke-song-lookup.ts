/**
 * Smoke Test: Private Song Database Integration
 * 
 * Tests the private acoustic setlist database lookup functionality.
 * Run with: npm run smoke:db
 * 
 * This script verifies:
 * 1. Database loads and parses correctly
 * 2. Search queries return correct matches
 * 3. Response format matches frontend expectations
 * 4. Gemini fallback works when needed
 */

const testCases = [
  {
    name: "Exact DB hit (Majboor)",
    query: "Majboor",
    expectedTitle: "Majboor",
    expectedArtist: "Sheheryar Rehan",
    minConfidence: 0.9,
  },
  {
    name: "Case-insensitive match",
    query: "majboor",
    expectedTitle: "Majboor",
    expectedArtist: "Sheheryar Rehan",
    minConfidence: 0.9,
  },
  {
    name: "Singer + song match",
    query: "Apna Bana Le Arijit",
    expectedTitle: "Apna Bana Le",
    minConfidence: 0.85,
  },
  {
    name: "Film/album search",
    query: "Dhurandhar Jaiye",
    expectedTitle: "Jaiye Sajana",
    minConfidence: 0.75,
  },
  {
    name: "Partial title match",
    query: "Agar Tum",
    expectedTitle: "Agar Tum Saath Ho",
    minConfidence: 0.75,
  },
  {
    name: "Unknown song (should fallback)",
    query: "some random xyz abc non existing",
    expectedSource: null, // Should be null for non-match
  },
];

async function runSmokeTest() {
  console.log("=".repeat(60));
  console.log("🎸 Plectrum AI - Private Song Database Smoke Test");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.name}`);
    console.log(`   Query: "${testCase.query}"`);

    try {
      // Simulate private DB lookup
      const response = await fetch("/api/test-song-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: testCase.query,
          language: "English",
          skillLevel: "Intermediate",
        }),
      });

      if (!response.ok) {
        console.error(`   ❌ FAILED: HTTP ${response.status}`);
        failed++;
        continue;
      }

      const result = await response.json();

      // Validate response structure
      const hasRequiredFields =
        result.title &&
        result.artist &&
        result.content &&
        result.key &&
        result.capo !== undefined &&
        result.strummingPattern;

      if (!hasRequiredFields) {
        console.error(
          `   ❌ FAILED: Missing required fields in response`
        );
        console.log(`   Response keys:`, Object.keys(result));
        failed++;
        continue;
      }

      // Check if result matches expectations
      if (testCase.expectedTitle) {
        const titleMatch =
          result.title.toLowerCase().includes(testCase.expectedTitle.toLowerCase()) ||
          testCase.expectedTitle.toLowerCase().includes(result.title.toLowerCase());

        if (!titleMatch) {
          console.error(
            `   ❌ FAILED: Expected "${testCase.expectedTitle}", got "${result.title}"`
          );
          failed++;
          continue;
        }
      }

      if (testCase.expectedArtist) {
        const artistMatch = result.artist.toLowerCase().includes(testCase.expectedArtist.toLowerCase());
        if (!artistMatch) {
          console.error(
            `   ❌ FAILED: Expected artist "${testCase.expectedArtist}", got "${result.artist}"`
          );
          failed++;
          continue;
        }
      }

      if (testCase.minConfidence && result._debug?.confidence) {
        if (result._debug.confidence < testCase.minConfidence) {
          console.warn(
            `   ⚠️  Low confidence: ${result._debug.confidence.toFixed(2)}`
          );
        }
      }

      // Check source
      if (testCase.expectedSource === null) {
        if (result.source === "private_db") {
          console.error(
            `   ❌ FAILED: Expected Gemini fallback, got private_db source`
          );
          failed++;
          continue;
        }
      }

      console.log(`   ✅ PASSED`);
      console.log(`   → Title: ${result.title}`);
      console.log(`   → Artist: ${result.artist}`);
      console.log(`   → Key: ${result.key}, Capo: ${result.capo}`);
      console.log(`   → Source: ${result.source}`);
      if (result._debug?.confidence) {
        console.log(`   → Confidence: ${result._debug.confidence.toFixed(2)}`);
      }

      passed++;
    } catch (error) {
      console.error(`   ❌ FAILED: ${error.message}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  // Karaoke smoke test
  console.log("\n🎤 Karaoke Mode Smoke Test");
  console.log("-".repeat(60));
  try {
    const response = await fetch("/api/test-song-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Majboor",
        language: "English",
        skillLevel: "Intermediate",
      }),
    });

    const result = await response.json();

    if (result.content && result.content.includes("[")) {
      console.log("✅ Karaoke Content: Lines with chords found");
      const lines = result.content.split("\n").slice(0, 5);
      console.log("   Sample lines:");
      lines.forEach(line => console.log(`     ${line}`));
    } else {
      console.error("❌ Karaoke Content: No chords found in content");
    }
  } catch (error) {
    console.error(`❌ Karaoke test failed: ${error.message}`);
  }

  // Paste mode smoke test
  console.log("\n📋 Paste Mode Smoke Test");
  console.log("-".repeat(60));
  try {
    const response = await fetch("/api/test-song-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Bairan",
        language: "English",
        skillLevel: "Beginner",
      }),
    });

    const result = await response.json();

    if (result.content && result.content.includes("###")) {
      console.log("✅ Paste Format: Section headers found");
      const headerCount = (result.content.match(/###/g) || []).length;
      console.log(`   Found ${headerCount} sections`);
    } else {
      console.error("❌ Paste Format: No section headers found");
    }
  } catch (error) {
    console.error(`❌ Paste mode test failed: ${error.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ Smoke test complete!");
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

// Run the test
runSmokeTest().catch(error => {
  console.error("Fatal error during smoke test:", error);
  process.exit(1);
});
