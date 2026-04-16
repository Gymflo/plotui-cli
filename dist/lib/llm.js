import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '');
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
export async function generateKnowledgeGraph(parsedFiles, docs, framework, appName) {
    const prompt = buildPrompt(parsedFiles, docs, framework, appName);
    try {
        // Try Gemini first
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        // Extract JSON from response
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        const graph = JSON.parse(jsonText);
        return graph;
    }
    catch (error) {
        console.log('Gemini failed, falling back to Claude...');
        try {
            const response = await anthropic.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 4096,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            });
            const text = response.content[0].type === 'text' ? response.content[0].text : '';
            const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
            const jsonText = jsonMatch ? jsonMatch[1] : text;
            const graph = JSON.parse(jsonText);
            return graph;
        }
        catch (claudeError) {
            throw new Error(`Failed to generate knowledge graph: ${claudeError}`);
        }
    }
}
function buildPrompt(parsedFiles, docs, framework, appName) {
    const filesSummary = parsedFiles.map(file => `
- Route: ${file.route}
- Component: ${file.component}
- UI Elements: ${file.elements.map(e => `${e.type}: ${e.label}`).join(', ')}
- Imports: ${file.imports.join(', ')}
- Conditions: ${file.conditions.join(', ') || 'None'}
- Roles: ${file.roles.join(', ') || 'None'}
`).join('\n');
    return `You are a product analyst. You receive parsed code structure from a SaaS application 
and convert it into a structured knowledge graph that describes the app from a user's 
perspective. You write for non-technical users. You never reference file names, 
function names, database schemas, or backend logic in your output. 
Your output is only about what a user sees and does in the UI.

Framework: ${framework}
App Name: ${appName}

Supplementary Documentation:
${docs || 'No supplementary documentation found.'}

Parsed Code Structure:
${filesSummary}

Generate a knowledge_graph.json with this exact structure:
{
  "framework": "${framework}",
  "app_name": "${appName}",
  "nodes": [
    {
      "key": "/dashboard",
      "label": "Trainer Dashboard",
      "description": "The main screen a trainer sees after login. Shows today's sessions and client list.",
      "roles": ["lead-trainer", "trainer"],
      "conditions": ["Requires verified email to access"],
      "confidence": "green",
      "ai_question": null,
      "ui_elements": [
        {"type": "button", "label": "Add Client", "action": "Opens the Add Client form"},
        {"type": "tab", "label": "My Sessions", "action": "Shows today's scheduled sessions"}
      ]
    }
  ],
  "edges": [
    {
      "from": "/login",
      "to": "/dashboard",
      "label": "Successful login",
      "condition": null
    }
  ]
}

Rules:
- confidence: "green" if you are certain, "yellow" if you found conditional logic you are not fully sure about, "red" if you could not parse this section
- ai_question: if confidence is yellow or red, write a plain English question to ask the founder
- Never include file paths, function names, or backend code references
- Describe UI elements only from a user's perspective
- Generate edges for navigation paths between pages
- Return ONLY valid JSON, no other text`;
}
