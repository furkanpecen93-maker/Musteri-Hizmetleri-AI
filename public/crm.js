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
    const filteredChats = activeChats.filter(chat => {
        const matchesSearch = chat.sender_id.toLowerCase().includes(searchTerm) || chat.content.toLowerCase().includes(searchTerm);
        
        let matchesStatus = true;
        let matchesPriority = true;
        let matchesTags = true;
        
        if (chat.profile) {
            if (activeFilters.status.length > 0) {
                matchesStatus = activeFilters.status.includes(chat.profile.status);
            }
            if (activeFilters.priority.length > 0) {
                matchesPriority = activeFilters.priority.includes(chat.profile.priority);
            }
            if (activeFilters.tags.length > 0) {
                matchesTags = activeFilters.tags.every(t => chat.profile.tags && chat.profile.tags.includes(t));
            }
        }
        
        return matchesSearch && matchesStatus && matchesPriority && matchesTags;
    });

    chatCountEl.textContent = filteredChats.length;
    chatListEl.innerHTML = '';

    if (filteredChats.length === 0) {
        chatListEl.innerHTML = '<div class="loading-spinner">Sohbet bulunamadÄ±.</div>';
        return;
    }

    filteredChats.forEach(chat => {
        const isPaused = activeTakeovers[chat.sender_id];
        const isActive = chat.sender_id === currentSelectedSenderId;
        const timeString = new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item ${isActive ? 'active' : ''} ${isPaused ? 'paused' : ''}`;
        chatItem.onclick = () => selectChat(chat.sender_id);

        let profileBadgesHTML = '';
        if (chat.profile) {
            profileBadgesHTML += `<span class="mini-badge status-${chat.profile.status.replace(/\s+/g, '-').toLowerCase()}">${chat.profile.status}</span>`;
            if (chat.profile.tags && chat.profile.tags.length > 0) {
                chat.profile.tags.slice(0, 2).forEach(t => {
                    profileBadgesHTML += `<span class="mini-badge tag-badge-mini">${t}</span>`;
                });
                if (chat.profile.tags.length > 2) {
                    profileBadgesHTML += `<span class="mini-badge tag-badge-mini">+${chat.profile.tags.length - 2}</span>`;
                }
            }
        }

        chatItem.innerHTML = `
            <div class="avatar"><i class="fa-solid ${isPaused ? 'fa-user-clock' : 'fa-user'}"></i></div>
            <div class="chat-item-info">
                <div class="chat-item-header">
                    <span class="chat-name">${chat.sender_id}</span>
                    <span class="chat-time">${timeString}</span>
                </div>
                <div class="chat-item-badges">${profileBadgesHTML}</div>
                <div class="chat-preview">${isPaused ? 'â¸ï¸ (Susturuldu) ' : ''}${chat.role === 'assistant' ? 'AI: ' : ''}${chat.content}</div>
            </div>
        `;
        chatListEl.appendChild(chatItem);
    });
}

async function selectChat(senderId) {
    currentSelectedSenderId = senderId;
    currentChatNameEl.textContent = senderId;
    chatHeaderEl.style.display = 'flex';
    
    // Mobil iÃ§in class ekle
    document.querySelector('.app-container').classList.add('mobile-chat-active');
    
    updateHeaderStatus();
    document.getElementById('profile-sidebar').style.display = 'flex';
    document.getElementById('chat-input-area').style.display = 'flex';
    fetchProfile(senderId);
    await fetchMessages();
    
    if (messagesPollingInterval) clearInterval(messagesPollingInterval);
    messagesPollingInterval = setInterval(fetchMessages, 5000);
    
    renderChatList(); // Update active class
}

const mobileBackBtn = document.getElementById('mobile-back-btn');
if (mobileBackBtn) {
    mobileBackBtn.onclick = () => {
        document.querySelector('.app-container').classList.remove('mobile-chat-active');
        if (messagesPollingInterval) clearInterval(messagesPollingInterval);
    };
}

function updateHeaderStatus() {
    const isPaused = activeTakeovers[currentSelectedSenderId];
    if (isPaused) {
        botStatusTextEl.textContent = 'Bot Susturuldu';
        botStatusTextEl.className = 'status offline';
        togglePauseBtn.className = 'btn btn-resume';
        togglePauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Botu AktifleÅŸtir';
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
                <p>Mesaj bulunamadÄ±.</p>
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

// Profile Logic
let currentTags = [];
let activeFilters = { tags: [], status: [], priority: [] };

window.addFilter = function(type, value) {
    if (!activeFilters[type].includes(value)) {
        activeFilters[type].push(value);
        renderActiveFilters();
        renderChatList();
    }
};

window.removeFilter = function(type, value) {
    activeFilters[type] = activeFilters[type].filter(item => item !== value);
    renderActiveFilters();
    renderChatList();
};

function renderActiveFilters() {
    const container = document.getElementById('active-filters-container');
    container.innerHTML = '';
    
    let hasFilters = false;
    
    for (const type of ['status', 'priority', 'tags']) {
        activeFilters[type].forEach(val => {
            hasFilters = true;
            const chip = document.createElement('div');
            chip.className = 'filter-chip';
            chip.innerHTML = `<span>${val}</span> <i class="fa-solid fa-times" onclick="removeFilter('${type}', '${val}')"></i>`;
            container.appendChild(chip);
        });
    }
    
    if (hasFilters) {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }
}

const profileStatusEl = document.getElementById('profile-status');
const profilePriorityEl = document.getElementById('profile-priority');
const tagInputEl = document.getElementById('tag-input');
const tagsListEl = document.getElementById('tags-list');
const profileNotesEl = document.getElementById('profile-notes');
const saveProfileBtn = document.getElementById('save-profile-btn');

async function fetchProfile(senderId) {
    try {
        const response = await fetch(`/api/crm/profile/${senderId}`);
        const data = await response.json();
        
        currentTags = data.tags || [];
        profileStatusEl.value = data.status || 'Yeni';
        profilePriorityEl.value = data.priority || 'Normal';
        profileNotesEl.value = data.notes || '';
        
        renderTags();
    } catch (error) {
        console.error('Error fetching profile:', error);
        currentTags = [];
        renderTags();
    }
}

function renderTags() {
    tagsListEl.innerHTML = '';
    currentTags.forEach(tag => {
        const badge = document.createElement('div');
        badge.className = 'tag-badge';
        badge.innerHTML = `<span onclick="addFilter('tags', '${tag}')" style="cursor: pointer;" title="Filtrele">${tag}</span> <i class="fa-solid fa-xmark" onclick="removeTag('${tag}')"></i>`;
        tagsListEl.appendChild(badge);
    });
}

window.removeTag = function(tagToRemove) {
    currentTags = currentTags.filter(tag => tag !== tagToRemove);
    renderTags();
};

tagInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const newTag = tagInputEl.value.trim();
        if (newTag && !currentTags.includes(newTag)) {
            currentTags.push(newTag);
            renderTags();
        }
        tagInputEl.value = '';
    }
});

saveProfileBtn.addEventListener('click', async () => {
    if (!currentSelectedSenderId) return;
    
    const originalText = saveProfileBtn.innerHTML;
    saveProfileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...';
    
    try {
        await fetch(`/api/crm/profile/${currentSelectedSenderId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: profileStatusEl.value,
                priority: profilePriorityEl.value,
                tags: currentTags,
                notes: profileNotesEl.value
            })
        });
        
        saveProfileBtn.innerHTML = '<i class="fa-solid fa-check"></i> Kaydedildi';
        setTimeout(() => {
            saveProfileBtn.innerHTML = originalText;
        }, 2000);
    } catch (error) {
        console.error('Error saving profile:', error);
        saveProfileBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Hata';
        setTimeout(() => {
            saveProfileBtn.innerHTML = originalText;
        }, 2000);
    }
});

// Start
fetchChats();
setInterval(fetchChats, 10000); // Sync chat list every 10s

// Send Message Logic
const chatInputEl = document.getElementById('chat-input');
const sendMsgBtnEl = document.getElementById('send-msg-btn');

async function sendManualMessage() {
    if (!currentSelectedSenderId) return;
    const text = chatInputEl.value.trim();
    if (!text) return;
    
    // Optimistic UI update
    const msgEl = document.createElement('div');
    msgEl.className = 'message assistant';
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgEl.innerHTML = `
        <div class="message-content">${text.replace(/\n/g, '<br>')}</div>
        <div class="message-time">${timeString} <i class="fa-regular fa-clock" style="font-size: 0.7rem; margin-left: 3px;"></i></div>
    `;
    chatMessagesEl.appendChild(msgEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    
    chatInputEl.value = '';
    chatInputEl.disabled = true;
    sendMsgBtnEl.disabled = true;
    sendMsgBtnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        const response = await fetch(`/api/crm/messages/${currentSelectedSenderId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Bilinmeyen hata');
        }
        
        // Success
        msgEl.querySelector('.fa-clock').className = 'fa-solid fa-check';
        
        // Update takeover status locally
        activeTakeovers[currentSelectedSenderId] = true;
        updateHeaderStatus();
        renderChatList();
        
    } catch (err) {
        console.error('Send message error:', err);
        msgEl.querySelector('.fa-clock').className = 'fa-solid fa-triangle-exclamation';
        msgEl.querySelector('.message-time').style.color = 'var(--danger)';
        alert('Hata: ' + err.message);
    } finally {
        chatInputEl.disabled = false;
        sendMsgBtnEl.disabled = false;
        sendMsgBtnEl.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
        chatInputEl.focus();
    }
}

sendMsgBtnEl.onclick = sendManualMessage;
chatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendManualMessage();
    }
});

// --- View Switching Logic ---
function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    
    const viewEl = document.getElementById('view-' + viewName);
    if (viewEl) {
        viewEl.style.display = (viewName === 'messages' || viewName === 'portal') ? 'flex' : 'block';
    }
    
    const navEl = document.getElementById('nav-' + viewName);
    if (navEl) {
        navEl.classList.add('active');
    }
    
    if (viewName === 'dashboard') {
        fetchDashboardMetrics();
    } else if (viewName === 'customers') {
        renderCustomersList();
    }
}

async function fetchDashboardMetrics() {
    try {
        const res = await fetch('/api/crm/dashboard');
        const data = await res.json();
        
        // Update main dashboard cards
        const revEl = document.getElementById('dash-revenue');
        if(revEl) revEl.textContent = data.totalRevenue + ' ₺';
        
        const custEl = document.getElementById('dash-customers');
        if(custEl) custEl.textContent = data.totalCustomers;
        
        const hotEl = document.getElementById('dash-hot');
        if(hotEl) hotEl.textContent = data.hotCustomers;
        
        const ordersEl = document.getElementById('dash-orders');
        if(ordersEl) ordersEl.textContent = data.pendingOrders;
        
        // Update reports section
        if (data.reports) {
            const rdRev = document.getElementById('report-daily-rev');
            const rdMsg = document.getElementById('report-daily-msgs');
            const rwRev = document.getElementById('report-weekly-rev');
            const rwMsg = document.getElementById('report-weekly-msgs');
            const rmRev = document.getElementById('report-monthly-rev');
            const rmMsg = document.getElementById('report-monthly-msgs');
            
            if(rdRev) rdRev.textContent = data.reports.daily.rev + ' ₺';
            if(rdMsg) rdMsg.textContent = data.reports.daily.msgs;
            
            if(rwRev) rwRev.textContent = data.reports.weekly.rev + ' ₺';
            if(rwMsg) rwMsg.textContent = data.reports.weekly.msgs;
            
            if(rmRev) rmRev.textContent = data.reports.monthly.rev + ' ₺';
            if(rmMsg) rmMsg.textContent = data.reports.monthly.msgs;
        }
    } catch (e) {
        console.error('Dashboard error:', e);
    }
}

function renderCustomersList() {
    const tbody = document.getElementById('customers-table-body');
    tbody.innerHTML = '';
    
    // Use activeChats which contains profile data
    const uniqueSenders = {};
    activeChats.forEach(chat => {
        if (!uniqueSenders[chat.sender_id]) {
            uniqueSenders[chat.sender_id] = chat;
        }
    });

    Object.values(uniqueSenders).forEach(chat => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        const status = chat.profile ? chat.profile.status : 'Yeni Müşteri';
        const priority = chat.profile ? chat.profile.priority : 'Normal';
        const timeString = new Date(chat.timestamp).toLocaleString('tr-TR');
        
        tr.innerHTML = `
            <td style="padding: 15px;">${chat.sender_id}</td>
            <td style="padding: 15px;"><span class="mini-badge status-${status.replace(/\s+/g, '-').toLowerCase()}">${status}</span></td>
            <td style="padding: 15px;">${priority}</td>
            <td style="padding: 15px;">${timeString}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    switchView('portal');
});
// --- Manual Customer Logic ---
async function saveManualCustomer() {
    const phone = document.getElementById('mc-phone').value;
    const status = document.getElementById('mc-status').value;
    const priority = document.getElementById('mc-priority').value;
    
    if (!phone) return alert('Lütfen müşteri numarası girin');
    
    try {
        const res = await fetch('/api/crm/manual_customer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: phone, status, priority })
        });
        
        if(res.ok) {
            document.getElementById('manual-customer-modal').style.display='none';
            // Reload active chats to show the new customer in the list
            fetchChats();
            setTimeout(() => renderCustomersList(), 1000);
            alert('Müşteri başarıyla eklendi.');
        } else {
            alert('Müşteri eklenirken hata oluştu.');
        }
    } catch(err) {
        console.error(err);
        alert('Hata oluştu.');
    }
}

// --- AI Analysis Logic ---
window.analyzeProfileWithAI = async function() {
    if (!currentSelectedSenderId) return alert('Lütfen önce bir müşteri seçin.');
    
    const btn = document.getElementById('ai-analyze-btn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Düşünüyor...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`/api/crm/ai-analyze/${currentSelectedSenderId}`);
        if (!response.ok) throw new Error('AI Analizi başarısız oldu');
        
        const data = await response.json();
        
        if (data.status) document.getElementById('profile-status').value = data.status;
        if (data.priority) document.getElementById('profile-priority').value = data.priority;
        
        // Auto-save the new profile info
        saveProfileBtn.click();
        
    } catch (err) {
        console.error('AI Analysis Error:', err);
        alert('AI Analizi başarısız oldu. Manuel seçiniz.');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};
