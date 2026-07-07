let activeChats = [];
let activeTakeovers = {};
let currentSelectedSenderId = null;
let messagesPollingInterval = null;

const chatListEl = document.getElementById('chat-list');
const chatCountEl = document.getElementById('chat-count');
const searchInput = document.getElementById('search-input');
const chatHeaderEl = document.getElementById('chat-header');
const chatMessagesEl = document.getElementById('chat-messages');
const currentChatNameEl = document.getElementById('current-chat-name');
const botStatusTextEl = document.getElementById('bot-status-text');
const togglePauseBtn = document.getElementById('toggle-pause-btn');

async function fetchChats() {
    try {
        const response = await fetch('/api/crm/chats');
        if (!response.ok) {
            if (response.status === 401) {
                window.location.reload(); // Trigger browser auth prompt
            }
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        activeChats = data.chats;
        activeTakeovers = data.activeTakeovers;
        renderChatList();
    } catch (error) {
        console.error('Error fetching chats:', error);
    }
}

function renderChatList() {
    const searchTerm = searchInput.value.toLowerCase();
    const filteredChats = activeChats.filter(chat => 
        chat.sender_id.toLowerCase().includes(searchTerm) || 
        chat.content.toLowerCase().includes(searchTerm)
    );

    chatCountEl.textContent = filteredChats.length;
    chatListEl.innerHTML = '';

    if (filteredChats.length === 0) {
        chatListEl.innerHTML = '<div class="loading-spinner">Sohbet bulunamadı.</div>';
        return;
    }

    filteredChats.forEach(chat => {
        const isPaused = activeTakeovers[chat.sender_id];
        const isActive = chat.sender_id === currentSelectedSenderId;
        const timeString = new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item ${isActive ? 'active' : ''} ${isPaused ? 'paused' : ''}`;
        chatItem.onclick = () => selectChat(chat.sender_id);

        chatItem.innerHTML = `
            <div class="avatar"><i class="fa-solid ${isPaused ? 'fa-user-clock' : 'fa-user'}"></i></div>
            <div class="chat-item-info">
                <div class="chat-item-header">
                    <span class="chat-name">${chat.sender_id}</span>
                    <span class="chat-time">${timeString}</span>
                </div>
                <div class="chat-preview">${isPaused ? '⏸️ (Susturuldu) ' : ''}${chat.role === 'assistant' ? 'AI: ' : ''}${chat.content}</div>
            </div>
        `;
        chatListEl.appendChild(chatItem);
    });
}

async function selectChat(senderId) {
    currentSelectedSenderId = senderId;
    currentChatNameEl.textContent = senderId;
    chatHeaderEl.style.display = 'flex';
    
    updateHeaderStatus();
    await fetchMessages();
    
    if (messagesPollingInterval) clearInterval(messagesPollingInterval);
    messagesPollingInterval = setInterval(fetchMessages, 5000);
    
    renderChatList(); // Update active class
}

function updateHeaderStatus() {
    const isPaused = activeTakeovers[currentSelectedSenderId];
    if (isPaused) {
        botStatusTextEl.textContent = 'Bot Susturuldu';
        botStatusTextEl.className = 'status offline';
        togglePauseBtn.className = 'btn btn-resume';
        togglePauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Botu Aktifleştir';
    } else {
        botStatusTextEl.textContent = 'Bot Aktif';
        botStatusTextEl.className = 'status online';
        togglePauseBtn.className = 'btn btn-pause';
        togglePauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Botu Sustur (15dk)';
    }
}

async function fetchMessages() {
    if (!currentSelectedSenderId) return;
    
    try {
        const response = await fetch(`/api/crm/messages/${currentSelectedSenderId}`);
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
    }
}

function renderMessages(messages) {
    // Basic check to see if we need to auto-scroll (only if we were already at bottom)
    const isAtBottom = chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop <= chatMessagesEl.clientHeight + 50;
    
    chatMessagesEl.innerHTML = '';
    
    if (messages.length === 0) {
        chatMessagesEl.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-comments"></i>
                <p>Mesaj bulunamadı.</p>
            </div>
        `;
        return;
    }

    messages.forEach(msg => {
        const msgEl = document.createElement('div');
        msgEl.className = `message ${msg.role === 'assistant' ? 'assistant' : 'user'}`;
        
        // Render markdown-like elements simply
        let content = msg.content.replace(/\n/g, '<br>');
        const timeString = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        msgEl.innerHTML = `
            <div class="message-content">${content}</div>
            <div class="message-time">${timeString}</div>
        `;
        chatMessagesEl.appendChild(msgEl);
    });
    
    if (isAtBottom) {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
}

togglePauseBtn.onclick = async () => {
    if (!currentSelectedSenderId) return;
    
    // Optimistic update
    const wasPaused = activeTakeovers[currentSelectedSenderId];
    activeTakeovers[currentSelectedSenderId] = !wasPaused;
    updateHeaderStatus();
    renderChatList();
    
    try {
        await fetch(`/api/crm/pause/${currentSelectedSenderId}`, { method: 'POST' });
        fetchChats(); // Re-sync
    } catch (error) {
        console.error('Error toggling pause:', error);
        // Revert on error
        activeTakeovers[currentSelectedSenderId] = wasPaused;
        updateHeaderStatus();
        renderChatList();
    }
};

searchInput.addEventListener('input', renderChatList);

// Start
fetchChats();
setInterval(fetchChats, 10000); // Sync chat list every 10s
