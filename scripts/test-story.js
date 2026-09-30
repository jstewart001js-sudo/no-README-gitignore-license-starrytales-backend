// Manual test — run with: node scripts/test-story.js "Amara" space
// Prints a generated story to the console so you can eyeball quality/tone
// before wiring it into the nightly pipeline.

require('dotenv').config();
const pool = require('../db/pool');
const { generateStory } = require('../src/services/claude');

async function main() {
  const name = process.argv[2] || 'Wren';
  const theme = process.argv[3] || 'adventure';

  console.log(`Generating a "${theme}" story for ${name}...\n`);

  try {
    // Pulls recent titles for this theme across real children, same as
    // production -- without this, every test run starts with zero
    // avoidance context, which understates how repetitive stories can
    // look on the live theme (this is exactly how the "Whispering Woods
    // Map" / "Blanket of Stars" duplicate-title issue was found).
    const recentTitlesResult = await pool.query(
      `SELECT s.title FROM stories s
       JOIN children c ON c.id = s.child_id
       WHERE c.story_theme = $1 AND s.created_at > now() - interval '14 days'
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [theme]
    );
    const recentTitles = recentTitlesResult.rows.map((r) => r.title);

    const story = await generateStory(name, theme, recentTitles);
    console.log('TITLE:', story.title);
    console.log('\n' + story.body);
  } catch (err) {
    console.error('Story generation failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
