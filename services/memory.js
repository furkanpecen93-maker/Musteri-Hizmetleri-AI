// services/memory.js — Supabase destekli kalıcı konuşma geçmişi
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config/env');
const log = require('../utils/logger');

// Supabase İstemcisi
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// RAM Cache (Her seferinde veritabanına sorgu atmamak için)
const conversations = new Map();
const userStates = new Map();
const greetedUsers = new Set();
const MAX_HISTORY = 20;

async function getState(senderId) {
  if (!userStates.has(senderId)) {
    try {
      const { data, error } = await supabase.from('user_states').select('state').eq('sender_id', senderId).single();
      if (data && data.state) {
        userStates.set(senderId, data.state);
      } else {
        userStates.set(senderId, { hasAskedLocation: false, profile: {} });
      }
    } catch (err) {
      log.error('[memory] getState error', err);
      userStates.set(senderId, { hasAskedLocation: false, profile: {} });
    }
  }
  return userStates.get(senderId);
}

async function updateState(senderId, updates) {
  const currentState = await getState(senderId);
  Object.assign(currentState, updates);
  
  try {
    await supabase.from('user_states').upsert({
      sender_id: senderId,
      state: currentState
    });
  } catch (err) {
    log.error('[memory] updateState error', err);
  }
}

async function addMessage(senderId, role, content) {
  if (!conversations.has(senderId)) {
    await getHistory(senderId);
  }
  const history = conversations.get(senderId) || [];
  const timestamp = Date.now();
  
  history.push({ role, content, timestamp });
  while (history.length > MAX_HISTORY) history.shift();
  conversations.set(senderId, history);

  try {
    await supabase.from('conversations').insert({
      sender_id: senderId,
      role,
      content,
      timestamp
    });
  } catch (err) {
    log.error('[memory] addMessage DB error', err);
  }
}

async function getHistory(senderId) {
  if (conversations.has(senderId)) {
    return conversations.get(senderId);
  }
  
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('role, content, timestamp')
      .eq('sender_id', senderId)
      .gt('timestamp', cutoff)
      .order('timestamp', { ascending: true })
      .limit(MAX_HISTORY);

    const history = data ? data.map(d => ({ role: d.role, content: d.content, timestamp: d.timestamp })) : [];
    conversations.set(senderId, history);
    return history;
  } catch (err) {
    log.error('[memory] getHistory error', err);
    return [];
  }
}

async function isDuplicate(senderId, messageText, windowMs = 30000) {
  if (!conversations.has(senderId)) {
    await getHistory(senderId);
  }
  const history = conversations.get(senderId) || [];
  if (history.length === 0) return false;
  
  const cutoff = Date.now() - windowMs;
  return history.some(m => m.role === 'user' && m.content === messageText && m.timestamp > cutoff);
}

async function clearHistory(senderId) {
  conversations.delete(senderId);
  userStates.delete(senderId);
  greetedUsers.delete(senderId);
  
  try {
    await Promise.all([
      supabase.from('conversations').delete().eq('sender_id', senderId),
      supabase.from('user_states').delete().eq('sender_id', senderId),
      supabase.from('greeted_users').delete().eq('sender_id', senderId)
    ]);
    log.info(`[memory] ${senderId} icin gecmis ve state temizlendi.`);
  } catch (err) {
    log.error('[memory] clearHistory error', err);
  }
}

async function markUserAsGreeted(senderId) {
  greetedUsers.add(senderId);
  try {
    await supabase.from('greeted_users').upsert({ sender_id: senderId });
  } catch (err) {
    log.error('[memory] markUserAsGreeted error', err);
  }
}

async function hasUserBeenGreeted(senderId) {
  if (greetedUsers.has(senderId)) return true;
  
  try {
    const { data } = await supabase.from('greeted_users').select('sender_id').eq('sender_id', senderId).single();
    if (data) {
      greetedUsers.add(senderId);
      return true;
    }
  } catch (err) {
    // Eğer row yoksa single() hata atar, problem yok.
  }
  return false;
}

function isGenericGreeting(messageText) {
  if (!messageText) return false;
  const txt = messageText.toLowerCase().trim();
  const exactMatches = ['merhaba', 'merhabalar', 'selam', 'selamlar', 'iyi günler', 'kolay gelsin', 'nasılsınız', 'slm'];
  return exactMatches.includes(txt);
}

module.exports = { addMessage, getHistory, isDuplicate, getState, updateState, isGenericGreeting, clearHistory, markUserAsGreeted, hasUserBeenGreeted };
