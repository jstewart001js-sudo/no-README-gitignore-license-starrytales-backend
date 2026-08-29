// Manual test — run with: node scripts/test-story.js "Amara" space
// Prints a generated story to the console so you can eyeball quality/tone
// before wiring it into the nightly pipeline.

require('dotenv').config();
const { generateStory } = require('../src/services/claude');

async function main() {
  const name = process.argv[2] || 'Wren';
  const theme = process.argv[3] || 'adventure';

  console.log(`Generating a "${theme}" story for ${name}...\n`);

  try {
    const story = await generateStory(name, theme);
    console.log('TITLE:', story.title);
    console.log('\n' + story.body);
  } catch (err) {
    console.error('Story generation failed:', err.message);
    process.exit(1);
  }
}

main();
