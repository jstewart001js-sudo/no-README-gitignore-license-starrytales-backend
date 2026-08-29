require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep these in sync with the theme options on the sign-up form / dashboard.
const THEME_PROMPTS = {
  adventure: 'a brave outdoor adventure with a quest, a map, and a moment of courage',
  fantasy: 'a gentle fantasy kingdom story with kind rulers, soft magic, and no real danger',
  space: 'a cozy outer-space journey among friendly planets and stars',
  underwater: 'an undersea adventure through coral cities and gentle sea creatures',
  animals: 'a story about talking woodland animal friends and a warm, sleepy forest',
  fairytale: 'a classic fairy-tale style story, timeless and magical, but original',
};

/**
 * Generates one unique bedtime story for a child.
 * @param {string} childName
 * @param {string} theme - one of the THEME_PROMPTS keys
 * @returns {Promise<{ title: string, body: string }>}
 */
async function generateStory(childName, theme) {
  const themeDescription = THEME_PROMPTS[theme] || THEME_PROMPTS.adventure;

  const systemPrompt = `You write short, original bedtime stories for young children.
Rules:
- The child named below is always the warm, brave, kind hero of the story.
- Keep it gentle and calming — suitable to read right before sleep. No peril that isn't quickly resolved, nothing scary, sad, or violent.
- Length: 5-7 short paragraphs, simple sentences, calm pacing that winds down toward a peaceful ending.
- End on a sleepy, cozy note (the character getting drowsy, heading to bed, stars coming out, etc.).
- Respond ONLY with valid JSON in this exact shape, no extra commentary:
{"title": "Story Title", "body": "Full story text with paragraphs separated by newlines"}`;

  const userPrompt = `Write tonight's bedtime story starring a child named ${childName}. Theme: ${themeDescription}.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('No text returned from Claude API.');
  }

  try {
    const parsed = JSON.parse(textBlock.text);
    if (!parsed.title || !parsed.body) throw new Error('Missing title or body.');
    return parsed;
  } catch (err) {
    console.error('Failed to parse story JSON:', textBlock.text);
    throw new Error('Story generation returned an unexpected format.');
  }
}

module.exports = { generateStory, THEME_PROMPTS };
