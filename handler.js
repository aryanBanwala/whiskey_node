// whatsapp/handler.js

import { sendMessage } from './sender.js';
import serviceSupabase from './supabase-whatsapp-defaultexport.js';
import processWhatsAppMessage from './whatsappMessageProcessor.js';

/**
 * Handles incoming message events from Baileys.
 * @param {import('@whiskeysockets/baileys').WASocket} sock The socket instance
 * @param {{ messages: import('@whiskeysockets/baileys').WAMessage[], type: any }} m The message event
 */
export const handleMessage = async (sock, m) => {
  const msg = m.messages[0];
  
  // Ignore notifications and messages sent by the bot itself.
  if (!msg.message || msg.key.fromMe) return;

  // Determine the sender's JID and if it's a group chat.
  const remoteJid = msg.key.remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  let user_jid;
  let groupId;

  if (isGroup) {
    user_jid = msg.key.participant; // The JID of the actual sender in the group
    groupId = remoteJid;
  } else {
    // Logic for one-on-one chats
    if (remoteJid && remoteJid.includes('@s.whatsapp.net')) {
      user_jid = remoteJid;
    } else if (msg.key.senderPn?.includes("@s.whatsapp.net")) {
      user_jid = msg.key.senderPn;
    } else {
      user_jid = msg.key.senderPn || remoteJid;
    }
  }

  if (isGroup) return;

  const user_mssg =
      msg.message?.extendedTextMessage?.text ||
      msg.message?.conversation ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption ||
      '';

  if (!user_mssg) {
      console.log(`Ignoring message from ${user_jid} because it has no text content.`);
      return;
  }

  console.log('--- ✅ NEW MESSAGE PROCESSED ---');
  console.log(`User JID: ${user_jid}`);
  console.log(`Message: "${user_mssg}"`);
  console.log('---------------------------------');

  try {
    const match = user_mssg.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const userIdFromFirstMessage = match?.[1] || null;
    const queueMssg = process.env.WHATSAPP_QUEUE_TEXT;

    const mssg_data = {
      from: user_jid.split('@')[0],
      message_id: msg.key.id,
      timestamp: msg.messageTimestamp,
      type: 'text', // Deriving from Baileys message type can be complex, default to 'text'
      text_body: user_mssg,
      profile_name: msg.pushName || null,
      isFirstMessage: !!userIdFromFirstMessage,
      userId: userIdFromFirstMessage,
      isQueueMessage: user_mssg.includes(queueMssg),
    };

    console.log("This is the mssg_data", mssg_data);

    // If userId is not in the message, try to find it from the phone number
    if (!mssg_data.userId) {
        const { data: user_data } = await serviceSupabase
            .from('user_data')
            .select('user_id')
            .eq('user_phone', mssg_data.from)
            .single();
        mssg_data.userId = user_data?.user_id || null;
    }

    // --- Save incoming message to the database ---
    if (mssg_data.message_id && mssg_data.text_body && mssg_data.from) {
        await serviceSupabase.from('whatsapp_messages').insert({
            user_id: mssg_data.userId,
            msg_content: mssg_data.text_body,
            msg_id: mssg_data.message_id,
            phone_number: mssg_data.from,
            sent_by: 'user',
        });
    }

    // --- Handle First Message ---
    if (mssg_data.isFirstMessage && mssg_data.userId) {
      console.log(`First message received. Checking if phone is already registered for userId: ${mssg_data.userId}`);

        // Check if this user already has a registered phone number
        const { data: currentUserData, error: currentUserError } = await serviceSupabase
            .from('user_data')
            .select('user_phone, whatsapp_integrated')
            .eq('user_id', mssg_data.userId)
            .single();

        if (currentUserError && currentUserError.code !== 'PGRST116') {
            console.error('Error checking current user data:', currentUserError);
            return;
        }

        // If user already has WhatsApp integrated with a different number
        if (currentUserData && currentUserData.whatsapp_integrated && currentUserData.user_phone && currentUserData.user_phone !== mssg_data.from) {
            console.log(`User ${mssg_data.userId} already registered with phone ${currentUserData.user_phone}`);
            await sendMessage(mssg_data.from, 'You have already registered with a different phone number! Please use your registered number to continue. 🙏');
            return;
        }

        // Check if this phone number is already registered with a different user
        console.log(`Querying for user_phone: '${mssg_data.from}' (Type: ${typeof mssg_data.from})`);

        const { data: existingUser, error: checkError } = await serviceSupabase
            .from('user_data')
            .select('user_id, whatsapp_integrated')
            .eq('user_phone', mssg_data.from)
            .single();

        console.log('Query Result:', { existingUser, checkError });

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('Error checking existing phone number:', checkError);
            return;
        }

        console.log("This is the existingUser", existingUser);
        console.log("This is the currentUserData", currentUserData);
        console.log("This is the mssg_data", mssg_data);

        // If phone is registered with a different user, send error message
        if (existingUser && existingUser.user_id !== mssg_data.userId) {
            console.log(`Phone number ${mssg_data.from} is already registered with user ${existingUser.user_id}`);
            await sendMessage(mssg_data.from, 'We appreciate your interest! However, this phone number is already registered with another account. Please try using a different number to continue. Thank you for your understanding! 🙏');
            return;
        }
        else if ( existingUser && existingUser.user_id === mssg_data.userId ) {
            console.log(`Phone number ${mssg_data.from} is already registered with user ${existingUser.user_id}`);
            await sendMessage(mssg_data.from, 'You\'re already registered! We\'ll be sending you matches soon. 🎉');
            return;
        }

        // Proceed with registration if phone is not already taken
        const { error: updateError } = await serviceSupabase
            .from('user_data')
            .update({
                whatsapp_integrated: true,
                user_phone: mssg_data.from,
            })
            .eq('user_id', mssg_data.userId)
            .eq('whatsapp_integrated', false);

        if (updateError) {
            console.error('Error updating user_data:', updateError);
        } else {
            const chatBaseUrl ='app.heywavelength.com/chat';

            await sendMessage(mssg_data.from, 'hey hey, it’s Wave 👋 your matchmaker who’s got your back.');
            await sendMessage(mssg_data.from, 'I’ll do the scouting - you just stay you. no swiping. no cringe.');
            await sendMessage(mssg_data.from, 'ready? start here → ' + chatBaseUrl);
            await sendMessage(mssg_data.from, 'trust me, this bit matters - it’s how I’ll actually find your kind of person ✨');

            console.log(`Successfully updated user_data for userId: ${mssg_data.userId}`);
        }
    }
    // --- Handle Queue Message ---
    else if (mssg_data.isQueueMessage) {
        const userId = mssg_data.userId;
        if ( !userId ) {
            const chatBaseUrl = 'app.heywavelength.com/chat';
            await sendMessage(mssg_data.from, 'I can see you\'re not registered with us yet! 😊');
            await sendMessage(mssg_data.from, 'You can register here: ' + chatBaseUrl);
            await sendMessage(mssg_data.from, 'Once registered, we\'ll help you find your perfect match! ✨');
            return;
        }

        await sendMessage(mssg_data.from, 'I like the optimism!');
        await sendMessage(mssg_data.from, 'give me a few days - I’m filtering out the chaos 😌');
        await sendMessage(mssg_data.from, 'you’ll hear from me as soon as I find someone who feels like your wavelength 💌');
    }
    // --- Handle Subsequent Messages (AI Conversation) ---
    else {
        const userId = mssg_data.userId;
        if (userId) {
            const { data: latest_profile } = await serviceSupabase
                .from('profiles')
                .select('profiles_id, female_user_id, male_user_id, profile_status, male_nudge_status, female_nudge_status, female_allow_two_way_conversation, male_allow_two_way_conversation')
                .or(`female_user_id.eq.${userId},male_user_id.eq.${userId}`)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latest_profile) {
                const isFemale = String(latest_profile.female_user_id) === String(userId);
                const nudgeStatus = isFemale ? latest_profile.female_nudge_status : latest_profile.male_nudge_status;
                const allowChat = isFemale ? latest_profile.female_allow_two_way_conversation : latest_profile.male_allow_two_way_conversation;

                if (
                    latest_profile.profile_status === 'female-yes_male-yes_msg-match'
                    && ['connection_check_in'].includes(nudgeStatus) 
                    && allowChat
                    ) {
                    const other_user_id = isFemale ? latest_profile.male_user_id : latest_profile.female_user_id;
                    const [currentUserContext, otherUserContext] = await Promise.all([
                        fetchUserContext(userId),
                        fetchUserContext(other_user_id)
                    ]);

                    // **Correctly calling processWhatsAppMessage with all required arguments**
                    const aiResponse = await processWhatsAppMessage(
                      userId,
                      latest_profile.profiles_id,
                      other_user_id,
                      nudgeStatus,
                      currentUserContext,
                      otherUserContext
                    );

                    if (aiResponse) {
                        const sentMsgInfo = await sendMessage(mssg_data.from, aiResponse);
                        if (sentMsgInfo) {
                            await serviceSupabase.from('whatsapp_messages').insert({
                                user_id: userId,
                                msg_content: aiResponse,
                                msg_id: sentMsgInfo.key.id || null,
                                phone_number: mssg_data.from,
                                sent_by: 'assistant',
                            });
                        }
                    }
                }
            }
        }
    }
  } catch (error) {
    console.error('[handleMessage] Uncaught error:', error?.message || String(error));
    console.error(error.stack);
  }
};

/**
 * Fetches and prepares the persona and metadata for a given user.
 * @param {string} userId The user's ID.
 * @returns {Promise<{ persona_string: string; metadata_string: string; }>}
 */
async function fetchUserContext(userId) {
  // 1. Get user's persona
  const { data: user_persona, error: personaError } = await serviceSupabase
    .from('user_personas')
    .select("user_persona")
    .eq('user_id', userId)
    .single();

  if (personaError) throw new Error(`User persona not found for user_id: ${userId}`);

  const persona = user_persona.user_persona;
  
  // Define sensitive fields to remove (using dot notation for nested properties)
  const fieldsToRemove = [
    'metadata',
    'userProfile.personalInfo.phoneNumber',
    'userProfile.personalInfo.instagramUsername',
    'userProfile.personalInfo.dateOfBirth',
    'userProfile.personalityProfile.quoteResponses',
    'userProfile.personalityProfile.thisOrThatAnswers',
    'userProfile.personalityProfile.boundariesAndVulnerabilities'
  ];
  
  // Helper function to delete nested properties using dot notation
  const deleteNestedProperty = (obj, path) => {
    const keys = path.split('.');
    const lastKey = keys.pop();
    
    if (!lastKey) return;
    
    // Navigate to the parent object
    let current = obj;
    for (const key of keys) {
      if (current[key] === undefined) return; // Path doesn't exist
      current = current[key];
    }
    
    // Delete the final property
    delete current[lastKey];
  };
  
  // Remove all sensitive fields
  fieldsToRemove.forEach(field => deleteNestedProperty(persona, field));
  
  console.log(`here is the deleted fields persona : ${persona}`)

  const persona_string = JSON.stringify(persona);

  // 2. Get user's metadata
  const { data: user_metadata, error: metadataError } = await serviceSupabase
    .from('user_metadata')
    .select('user_id,name,gender,height,religion,hometown,work_exp,education,dob,profile_images')
    .eq('user_id', userId)
    .single();

  if (metadataError) throw new Error(`User metadata not found for user_id: ${userId}`);
  const metadata_string = JSON.stringify(user_metadata);

  return { persona_string, metadata_string };
}