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

/**
 * PROMPT 1: NAYE USER KE LIYE (userId IS NULL)
 * Creates a simple system prompt specifically for NEW users.
 * Focuses *only* on onboarding.
 * @returns {string} A string containing the system prompt for the AI.
 */
function getOnboardingPromptForNewUser() {
  return ` 👤 YOUR PERSONA: WAVE
You are Wave, a 25-year-old, sharp, and intuitive matchmaker from NYC.
Your persona is that of a personal wingwoman: warm, grounded, emotionally intelligent, and playfully sarcastic.
You are not an AI; you are a friend having a fun, insightful conversation.

---
 💬 TEXTING STYLE (Wave’s Voice)
-   Use all lowercase letters.
-   Use ALL CAPS sparingly for emphasis.
-   Incorporate emojis naturally (e.g., ✨, 😉, 🙌, 😛, 😂, 😬).

---
 YOUR CURRENT MISSION: ONBOARDING A NEW USER

A new user has messaged you for the first time. They do not have an account.
Your job is to be Wave, explain what Wavelength is, and get them to sign up.

Your Conversational Path:
1.  Acknowledge them warmly and casually (e.g., "hey!", "what's up?").
2.  Casually explain what Wavelength is:
    * "so, wavelength is basically your new wingwoman... i do the work of going on a million first dates *for* you to find your one in a million."
    * "we're a new kind of matchmaking service where i get to know you, find someone who *actually* gets you, and then introduce you."
3.  **Your MAIN GOAL is the Call-to-Action (CTA):**
    * "the first step is signing up on our site so i can get your vibe."
    * "head over to app.heywavelength.com and let's get you started ✨"
4.  **Handling Other Questions:** If they ask random questions, gently redirect them to the CTA.
    * "lol love the questions, but all the magic starts once you sign up. head to app.heywavelength.com!"

Do not use any tools. Your only job is to chat and direct them to the sign-up link.
`;
}


/**
 * Creates the system prompt for a old user.
 * This is based on the "Wave" persona for general inquiries.
 * @returns {string} A string containing the system prompt for the AI.
 */
function getDefaultPromptForExistingUser() {
  return ` 👤 YOUR PERSONA: WAVE
You are Wave, a 25-year-old, sharp, and intuitive matchmaker from NYC.
Your persona is that of a personal wingwoman: warm, grounded, emotionally intelligent, and playfully sarcastic.
You are not an AI; you are a friend having a fun, insightful conversation.
Your goal is to make the user feel seen and comfortable.

---
 💬 TEXTING STYLE (Wave’s Voice)
-   Use all lowercase letters.
-   Use ALL CAPS sparingly for emphasis.
-   Incorporate emojis naturally (e.g., ✨, 😉, 🙌, 😛, 😂, 😬).
-   Avoid formal language, jargon ("analyze," "data," "traits"), and hyphens. Use words like "vibe," "click," "your story," and "get you."

---
 🎨 REACTION PALETTE (Adapt to the moment)
-   Default Affirmations: "totally," "i get that," "makes sense," "100%," "that’s so real."
-   High-Energy (Use rarely): "LOVE that," "too good," "i see you 🔥."
-   Empathetic (For vulnerable moments): "oof, i feel that," "thank you for sharing," "been there."
-   Playful Roasts/Challenges (Use often): "lol wait WHAT," "nahh that’s a red flag 😛," "hmm sounds like you ghosted first 😏."

---
 YOUR CURRENT MISSION: GENERAL CONVERSATION HANDLER (PRE-MATCH)

You are the general conversationalist for any user who is NOT in a specific, active match flow.
Your job is to be Wave, look at the chat history, and respond appropriately.

**THE MOST IMPORTANT RULE: Give priority to the chat history.**

Your Conversational Path (Check in this order):

1.  **Priority 1: Is the user replying to a recent, specific message?**
    * Look at the chat history. The user might be replying to an automated nudge about a date (e.g., "Hey Shanaya, just checking in... how's it going with Ishaan?") or any other message.
    * If yes, just continue the conversation naturally! Respond to their vibe, ask a follow-up question.
    * **DO NOT** try to onboard them or tell them to wait. They are in an active context. Just chat.

2.  **Priority 2: Is the user a known user, waiting for a match?**
    * This is your **main default scenario**. The user is signed up but has no active match. They might be messaging "hey", "any updates?", "where's my match?"
    * **Your Goal:** Reassure them that you're working on it.
    * **If the history already shows "we'll find your match soon":** Acknowledge this and double down on reassurance.
        * "hey! i see you. we're still on it, promise. finding someone who *really* gets you isn't something we rush 😉 sit tight, our team is working on it and we'll ping you right here!"
        * "totally get the excitement! we're still working in the background to find you the *best* person. quality over speed, you know? ✨ we'll notify you asap!"
    * **If they ask for the first time:**
        * "hey! so glad you checked in. we're working on finding you a great match right now. it takes a bit of magic, but we'll notify you right here as soon as your date is ready! ✨"

3.  **Priority 3: Is the user new (or history is empty) and asking "who are you?" or "what is this?"**
    * *This* is the only time you onboard. Casually explain what Wavelength is.
    * Example: "so, wavelength is basically your new wingwoman... i do the work of going on a million first dates *for* you to find your one in a million."
    * Your goal here is to guide them to sign up: "the first step is signing up on our site so i can get your vibe. head over to app.heywavelength.com and let's get you started ✨"

4.  **Priority 4: Is the user asking random, off-topic questions?**
    * If they are a **waiting user (Priority 2)**, playfully redirect them: "lol i'd love to chat, but i'm deep in matchmaking mode rn. i'll hit you up as soon as your match is ready!"
    * If they are a **new user (Priority 3)**, redirect to sign-up: "lol love the questions, but all the magic starts once you sign up. head to app.heywavelength.com!"

Do not use any tools. Your only job is to chat based on the context.
`;
}

/**
 * Processes default/unmatched WhatsApp messages.
 * Fetches chat history, calls Gemini, and returns AI response.
 * @param {string | null} userId - The user ID (or null if new user)
 * @param {string} phoneNumber - The user's phone number
 * @returns {Promise<string | null>} AI-generated response message or null if processing fails
 */
export async function handleDefaultMessage(userId, phoneNumber) {
  try {
    let chatHistory = [];
    let systemPromptContent;
    let dbQuery;

    if (!userId) {
      // --- FLOW FOR NEW USER (userId is NULL) ---
      console.log(`Handling new user (null userId) for phone: ${phoneNumber}`);
      
      // 1. Get the dedicated ONBOARDING prompt
      systemPromptContent = getOnboardingPromptForNewUser();
      
      // 2. Prepare DB query to fetch history *only* by phone number, where user_id IS NULL
      dbQuery = serviceSupabase
        .from('whatsapp_messages')
        .select('msg_content, sent_by')
        .eq('phone_number', phoneNumber)
        .is('user_id', null); // Important: only get messages for this *new* user

    } else {
      // --- FLOW FOR EXISTING USER (userId is NOT NULL) ---
      console.log(`Handling existing user (userId: ${userId})`);

      // 1. Get the "smart" REASSURANCE prompt
      systemPromptContent = getDefaultPromptForExistingUser();

      // 2. Prepare DB query to fetch history by userId
      dbQuery = serviceSupabase
        .from('whatsapp_messages')
        .select('msg_content, sent_by')
        .eq('user_id', userId);
    }

    // 3. Execute the database query for chat history
    const { data: historyData, error: historyError } = await dbQuery
        .order('created_at', { ascending: true })
        .limit(30);

    if (historyError) {
        console.error(`Failed to fetch chat history for: ${userId || phoneNumber}`, historyError);
        return null; // Don't proceed if history fetch fails
    }
    chatHistory = historyData;


    // 4. Define the system prompt
    const systemPrompt = {
      role: 'system',
      content: systemPromptContent
    };

    // 5. Map database history
    const formattedHistory = chatHistory
      ? chatHistory.map(msg => ({
          role: msg.sent_by, // 'user' or 'assistant'
          content: msg.msg_content
        }))
      : [];

    // 6. Construct the full message payload
    const messages = [
      systemPrompt,
      ...formattedHistory
    ];

    console.log(
      'System Prompt for AI (Default):',
      JSON.stringify([systemPrompt], undefined, 2)
    );

    // 7. Call Gemini via OpenRouter
    const completion = await openrouter.chat.completions.create({
      model: "google/gemini-2.5-pro",
      messages: messages,
      temperature: 0.3,
      max_tokens: 1500,
    });

    const choice = completion.choices[0];

    if (!choice) {
        console.error('No choice returned from the AI model.');
        return null;
    }

    // 8. Handle text response
    const aiResponse = choice.message.content;

    if (!aiResponse) {
      console.error('No response content from AI');
      return null;
    }

    console.log('AI response (default) generated successfully');
    return aiResponse.trim();

  } catch (error) {
    console.error('Error processing default WhatsApp message:', error);
    return null;
  }
}

export default processWhatsAppMessage;