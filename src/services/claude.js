require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Required when ANTHROPIC_API_KEY is an identity-linked key (tied to a user
  // login rather than a single workspace) — tells the API which workspace's
  // billing/rate limits this request should count against.
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : undefined,
});

// Keep these in sync with the theme options on the sign-up form / dashboard.
const THEME_PROMPTS = {
  adventure: 'a brave outdoor adventure with a quest, a map, and a moment of courage',
  fantasy: 'a gentle fantasy kingdom story with kind rulers, soft magic, and no real danger',
  space: 'a cozy outer-space journey among friendly planets and stars',
  underwater: 'an undersea adventure through coral cities and gentle sea creatures',
  animals: 'a story about talking woodland animal friends and a warm, sleepy forest',
  fairytale: 'a classic fairy-tale style story, timeless and magical, but original',
  mythical: 'a gentle story starring friendly mythical creatures — dragons, unicorns, centaurs, griffins, a phoenix, mermaids, a pegasus, fairies, or kind trolls — full of wonder and no real danger',
};

/**
 * Generates one unique bedtime story for a child.
 * @param {string} childName
 * @param {string} theme - one of the THEME_PROMPTS keys
 * @param {string[]} recentTitles - titles of this child's most recent stories, to steer away from repeats
 * @returns {Promise<{ title: string, body: string }>}
 */
async function generateStory(childName, theme, recentTitles = []) {
  const themeDescription = THEME_PROMPTS[theme] || THEME_PROMPTS.adventure;

  const avoidanceNote = recentTitles.length
    ? `\n- This child has already received these recent stories -- do not reuse their titles, settings, plots, or named side-characters. Make tonight's story clearly different (a new setting detail, new supporting characters, a new central event, and a new title):\n${recentTitles
        .map((t) => `  - "${t}"`)
        .join('\n')}`
    : '';

  const systemPrompt = `You write short, original bedtime stories for young children.
Rules:
- The child named below is always the warm, brave, kind hero of the story.
- Keep it gentle and calming — suitable to read right before sleep. No peril that isn't quickly resolved, nothing scary, sad, or violent.
- Length: 5-7 short paragraphs, simple sentences, calm pacing that winds down toward a peaceful ending.
- End on a sleepy, cozy note (the character getting drowsy, heading to bed, stars coming out, etc.).
- Each night's story must feel distinct from previous nights, even within the same theme.
- Use the write_bedtime_story tool to submit the finished story.${avoidanceNote}`;

  const userPrompt = `Write tonight's bedtime story starring a child named ${childName}. Theme: ${themeDescription}.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [
      {
        name: 'write_bedtime_story',
        description: "Submit tonight's finished bedtime story.",
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'A short, warm story title.' },
            body: { type: 'string', description: 'The full story text, with paragraphs separated by newline characters.' },
          },
          required: ['title', 'body'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'write_bedtime_story' },
  });

  // Structured tool input is validated by the API against the schema above,
  // which avoids the free-text-JSON failure mode where Claude occasionally
  // forgets to escape a quotation mark inside dialogue and breaks JSON.parse.
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || !toolUse.input || !toolUse.input.title || !toolUse.input.body) {
    console.error('Unexpected Claude response shape:', JSON.stringify(response.content));
    throw new Error('Story generation did not return the expected story fields.');
  }

  return { title: toolUse.input.title, body: toolUse.input.body };
}

module.exports = { generateStory, THEME_PROMPTS };
