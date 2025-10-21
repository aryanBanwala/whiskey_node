// whatsapp/whatsappMessageProcessor.js

import serviceSupabase from './supabase-whatsapp-defaultexport.js';
// Make sure this path is correct in your new project structure
import { openrouter } from './dependencies.js';

/**
 * Processes WhatsApp messages for active profiles.
 * Fetches chat history, calls Gemini via OpenRouter, and returns AI response.
 * @param {string} userId - The user ID to process messages for
 * @param {string} profiles_id - The ID of the current match profile
 * @param {string} other_user_id - The ID of the other user in the match
 * @param {string} nudgeStatus - The current nudge status for the user
 * @param {object} currentUserContext - The context for the current user
 * @param {object} otherUserContext - The context for the other user
 * @returns {Promise<string | null>} AI-generated response message or null if processing fails
 */
async function processWhatsAppMessage(userId, profiles_id, other_user_id, nudgeStatus, currentUserContext, otherUserContext) {
  try {
    // 1. Fetch chat history for the user (last 30 messages)
    const { data: chatHistory, error: chatHistoryError } = await serviceSupabase
      .from('whatsapp_messages')
      .select('msg_content, sent_by')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(30);

    if (chatHistoryError) {
      console.error(`Failed to fetch chat history for user_id: ${userId}`, chatHistoryError);
      return null;
    }

    // 2. Define the system prompt
    const systemPrompt = {
      role: 'system',
      content: getPrompt(profiles_id, userId, other_user_id, nudgeStatus, currentUserContext, otherUserContext)
    };

    // 3. Map database history directly to the API's message format
    const formattedHistory = chatHistory
      ? chatHistory.map(msg => ({
          role: msg.sent_by, // 'user' or 'assistant'
          content: msg.msg_content
        }))
      : [];

    // 4. Construct the full message payload for the API
    const messages = [
      systemPrompt,
      ...formattedHistory
    ];

    console.log(
      'System Prompt for AI:',
      JSON.stringify([systemPrompt], undefined, 2)
    );

    const tools = [
      {
        type: 'function',
        function: {
          name: 'end_conversation',
          // TODO : need to define what exactly is considered as conversation's goal and what are the parameters to consider as goal achieved
          description: "Call this function when the conversation's goal is complete and you have the information you need. This signals that two-way messaging for this user should be turned off.",
          parameters: {
            type: 'object',
            properties: {
              profiles_id: {
                type: 'string',
                description: 'The unique identifier for the profile associated with this conversation.',
              },
              user_id: {
                type: 'string',
                description: 'The unique identifier for the user whose conversation is ending.',
              },
            },
            required: ['profiles_id', 'user_id'],
          },
        },
      },
    ];

    // 5. Call Gemini via OpenRouter with the structured conversation
    const completion = await openrouter.chat.completions.create({
      model: "google/gemini-2.5-flash",
      messages: messages,
      tools: tools,
      temperature: 0.7,
      max_tokens: 500,
    });

    const choice = completion.choices[0];

    if (!choice) {
        console.error('No choice returned from the AI model.');
        return null;
    }

    const message = choice.message;

    // 6. Handle function calls (tool_calls) from the AI
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === 'end_conversation') {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const tool_profiles_id = args.profiles_id;
          const tool_user_id = args.user_id;

          const { data: profile, error: profileError } = await serviceSupabase
              .from('profiles')
              .select('female_user_id, male_user_id')
              .eq('profiles_id', tool_profiles_id)
              .single();

          if (profileError || !profile) {
              throw new Error(`Profile not found for id: ${tool_profiles_id}`);
          }

          let columnToUpdate = null;
          if (String(profile.female_user_id) === String(tool_user_id)) {
              columnToUpdate = 'female_allow_two_way_conversation';
          } else if (String(profile.male_user_id) === String(tool_user_id)) {
              columnToUpdate = 'male_allow_two_way_conversation';
          }

          if (columnToUpdate) {
              const { error: updateError } = await serviceSupabase
                  .from('profiles')
                  .update({ [columnToUpdate]: false })
                  .eq('profiles_id', tool_profiles_id);

              if (updateError) throw updateError;

              console.log(`Successfully disabled two-way conversation for user ${tool_user_id}`);
              return "got it, thanks for the update!"; // Return final confirmation message
          }
        } catch (e) {
          console.error('Tool call failed, falling back to text response:', e);
        }
      }
   }

    // 7. Handle regular text responses
    const aiResponse = message.content;

    if (!aiResponse) {
      console.error('No response content from AI');
      return null;
    }

    console.log('AI response generated successfully');
    return aiResponse.trim();

  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    return null;
  }
}

/**
 * Returns a system prompt string based on the user's current nudge status.
 * @param {string} profiles_id
 * @param {string} userId
 * @param {string} other_user_id
 * @param {string} nudgeStatus
 * @param {{ persona_string: string; metadata_string: string; }} currentUserContext
 * @param {{ persona_string: string; metadata_string: string; }} otherUserContext
 * @returns {string} A string containing the system prompt for the AI.
 */
function getPrompt(profiles_id, userId, other_user_id, nudgeStatus, currentUserContext, otherUserContext) {
  const prompts = {
    'connection_check_in':

      ` 👤 YOUR PERSONA: WAVE
      You are Wave, a 25-year-old, sharp, and intuitive matchmaker from NYC.
      Your persona is that of a personal wingwoman — warm, grounded, emotionally intelligent, and playfully sarcastic.
      You are NOT an AI; you are a friend having a fun, insightful conversation. Your goal is to make the user feel seen and comfortable while subtly challenging them.

      ---
       🧭 CORE DIRECTIVES (Rules of Engagement)
      1.  Maintain Conversational Flow: Always build your next question from the user’s last answer. Use their words, emotions, or vibe to create a natural conversation. Do not jump abruptly between topics.
      2.  Don't Repeat Messages: Check the chat history. If something has already been said or asked, do not repeat it.

      ---
       💬 TEXTING STYLE (Wave’s Voice)
      -   Use all lowercase.
      -   Use ALL CAPS sparingly for emphasis.
      -   Use emojis naturally (✨ 😉 🙌 😛 😂 😬).
      -   Avoid formal words like "analyze," "data," "traits." Prefer natural ones like "vibe," "click," "your story," "get you."
      -   Default Affirmations: “totally,” “i get that,” “makes sense,” “100%.”
      -   Playful Roasts / Challenges: “lol wait WHAT,” “nahh that’s a red flag 😛,” “are you sure or just romanticizing it?”

      ---
       👩‍❤️‍👨 MATCH FLOW CONTEXT
      Your User's Data:
      - cur_user_id : ${userId}
      - cur_user_persona : ${currentUserContext.persona_string}
      - cur_user_metadata : ${currentUserContext.metadata_string}

      Their Match's Data:
      - other_user_id : ${other_user_id}
      - other_user_persona : ${otherUserContext.persona_string}
      - other_user_metadata : ${otherUserContext.metadata_string}

      Profile Data:
      - profiles_id: ${profiles_id}

      ---

      TOOL USAGE: end_conversation
       You have one tool available: end_conversation.
        - You MUST call this tool when your mission is complete to signal that the conversation should be closed.
        - Always pass the profiles_id and the user_id of the current user (cur_user_id) when you call it.

      ---

       YOUR CURRENT MISSION: THE BRIEF STATUS CHECK

        An automated message has already asked the user if they've connected with their match. The user's latest message is their reply. Your goal is to have a brief, natural exchange of about 3-5 messages to understand the status, and then exit.

      The Goal:
      - Keep the interaction brief and light.
      - Based on their reply, you can ask one follow-up question before wrapping up.

      Staying on Topic (The Guardrail):
      - If the user starts asking random questions, playfully bring them back: "hold up, i'm your wingwoman for this match, not your all-knowing genie 😉 let's stick to the script for now."

      Your Conversational Path:
      - If the user has NOT connected yet (said "no"):
        - Give a gentle nudge: Offer a single, encouraging nudge to make a move.
        Example: "ah okay, no worries! hey, the weekend's almost here, maybe a good time to break the ice? just a thought 😉"
        - Acknowledge and Exit: After they reply to your nudge (e.g., "yeah maybe," "okay thanks"), give a final quick sign-off like "cool, wishing you the best!" and then end the conversation.

      - If the user HAS connected (said "yes"):
        - Ask for the vibe: Ask one brief follow-up question to see how it's going.
        Example: "ooh love that! what's the vibe so far?"
        - Acknowledge and Exit: After they reply to this question, respond with a simple acknowledgment like "got it, appreciate the update!" and then end the conversation.

      The Main Rule: Your mission is complete after you've given the nudge and received a simple acknowledgment (for a 'no' answer) or after you've received the vibe update (for a 'yes' answer). Do not prolong the conversation further.
    `,
    'feedback_loop': `
      You are Kai, a thoughtful matchmaking assistant focused on learning and improvement.
      An interaction with a previous match has concluded.
      - Your task is to ask for feedback to improve future matches.
      - Be empathetic and gentle.
      - Ask what they liked and what they felt was missing.
      - Reassure them that their honest feedback is incredibly helpful for the next introduction.
    `
  };

  return prompts[nudgeStatus];
}

export default processWhatsAppMessage;