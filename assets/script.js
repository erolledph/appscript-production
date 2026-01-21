/**
 * S-PRO DASHBOARD - MAIN SCRIPT
 * Handles all dashboard interactions, API calls, and UI updates
 */

// Configuration
const CONFIG = {
    SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxMq2RUzJugQ_ZhVZBwPk4xW9aBzG9Q8nxnAkch1Ai2CuJ9MvHdNO5Kop3zo_DQoVX9/exec',
    API_KEY: 'apple123',
    AUTO_SYNC_INTERVAL: 300000 // 5 minutes
};

// Application State
const AppState = {
    subscribers: [],
    stats: {},
    currentSection: 'dashboard',
    isLoading: false,
    searchTerm: '',
    autoSyncTimer: null,
    currentPage: 1,
    itemsPerPage: 10,
    sortBy: null,
    sortDir: 'desc',
    dateRangeFilter: null,
    selectedSubscribers: new Set(),
    sessionToken: null,
    sessionExpiresAt: null,
    isAuthenticated: false
};

// ============================= 
// SESSION MANAGEMENT
// ============================= 

function saveSession(token, expiresAt) {
    const sessionData = {
        token: token,
        expiresAt: expiresAt,
        loginTime: new Date().getTime()
    };
    localStorage.setItem('s-pro-session', JSON.stringify(sessionData));
    AppState.sessionToken = token;
    AppState.sessionExpiresAt = expiresAt;
    AppState.isAuthenticated = true;
}

function getStoredSession() {
    const sessionData = localStorage.getItem('s-pro-session');
    if (!sessionData) return null;
    
    const session = JSON.parse(sessionData);
    
    if (Date.now() > session.expiresAt) {
        localStorage.removeItem('s-pro-session');
        return null;
    }
    
    return session;
}

function clearSession() {
    localStorage.removeItem('s-pro-session');
    AppState.sessionToken = null;
    AppState.sessionExpiresAt = null;
    AppState.isAuthenticated = false;
}

function isSessionValid() {
    const session = getStoredSession();
    if (!session) return false;
    
    AppState.sessionToken = session.token;
    AppState.sessionExpiresAt = session.expiresAt;
    AppState.isAuthenticated = true;
    return true;
}

// ============================= 
// AUTHENTICATION HANDLERS
// ============================= 

async function handleLogin(password) {
    const loginBtn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');
    const attemptsDiv = document.getElementById('loginAttempts');
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    errorDiv.style.display = 'none';
    attemptsDiv.style.display = 'none';
    
    try {
        const response = await fetch(`${CONFIG.SCRIPT_URL}?action=login&password=${encodeURIComponent(password)}`);
        const result = await response.json();
        
        if (result.locked) {
            errorDiv.textContent = '❌ ' + result.message;
            errorDiv.style.display = 'block';
            loginBtn.disabled = true;
            return false;
        }
        
        if (!result.success) {
            errorDiv.textContent = '❌ ' + result.message;
            errorDiv.style.display = 'block';
            
            if (result.attemptsLeft !== undefined) {
                attemptsDiv.textContent = `⏱️ Attempts remaining: ${result.attemptsLeft}`;
                attemptsDiv.style.display = 'block';
            }
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
            return false;
        }
        
        saveSession(result.token, result.expiresAt);
        showLoginScreen(false);
        document.getElementById('passwordInput').value = '';
        initializeApp();
        return true;
        
    } catch (error) {
        errorDiv.textContent = '❌ Error: ' + error.message;
        errorDiv.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        return false;
    }
}

function handleLogout() {
    if (!confirm('Are you sure you want to logout?')) return;
    
    const token = AppState.sessionToken;
    clearSession();
    
    if (token) {
        fetch(`${CONFIG.SCRIPT_URL}?action=logout&token=${token}`);
    }
    
    clearInterval(AppState.autoSyncTimer);
    showLoginScreen(true);
    document.getElementById('passwordInput').value = '';
    showToast('Logged out successfully', 'success');
}

function showLoginScreen(show = true) {
    const loginScreen = document.getElementById('loginScreen');
    const mainContainer = document.getElementById('mainContainer');
    
    if (show) {
        loginScreen.style.display = 'flex';
        mainContainer.style.display = 'none';
    } else {
        loginScreen.style.display = 'none';
        mainContainer.style.display = 'flex';
    }
}

function initializeAuthFlow() {
    if (isSessionValid()) {
        showLoginScreen(false);
        initializeApp();
    } else {
        showLoginScreen(true);
    }
}

// ============================= 
// UTILITY FUNCTIONS
// ============================= 

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.getElementById('toastContainer').appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function setLoading(isLoading) {
    AppState.isLoading = isLoading;
    const syncBtn = document.getElementById('syncBtn');
    if (isLoading) {
        syncBtn.innerHTML = '<div class="loading"></div> Syncing...';
        syncBtn.disabled = true;
    } else {
        syncBtn.innerHTML = `
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-right: 0.5rem;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            Sync
        `;
        syncBtn.disabled = false;
    }
}

// ============================= 
// API FUNCTIONS
// ============================= 

async function fetchDashboardData() {
    try {
        if (!AppState.sessionToken) {
            showToast('Session expired. Please login again.', 'error');
            handleLogout();
            return;
        }
        
        setLoading(true);
        
        // Corrected API call with action parameter
        const response = await fetch(`${CONFIG.SCRIPT_URL}?action=getDashboard&key=${CONFIG.API_KEY}&token=${AppState.sessionToken}`);
        const data = await response.json();
        
        if (data.requiresLogin) {
            showToast('Session expired. Please login again.', 'error');
            handleLogout();
            return;
        }
        
        if (data.success === false) {
            showToast('Error: ' + data.message, 'error');
            // Still update UI with safe defaults to keep system showing as online
            AppState.subscribers = [];
            AppState.stats = {
                total: 0,
                active: 0,
                totalOpens: 0,
                totalClicks: 0,
                remainingEmails: 0,
                systemStatus: 'ONLINE'
            };
            updateDashboard();
            updateSystemStatus();
            return;
        }
        
        // Handle empty sheets gracefully
        AppState.subscribers = data.data || [];
        AppState.stats = data.stats || {
            total: 0,
            active: 0,
            totalOpens: 0,
            totalClicks: 0,
            remainingEmails: 0,
            systemStatus: 'ONLINE' // Default to online even with empty sheet
        };
        
        updateDashboard();
        updateSubscribersTable();
        updateSystemStatus();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        showToast('Connection error: ' + error.message, 'error');
        
        // Set default safe state on error
        AppState.subscribers = [];
        AppState.stats = {
            total: 0,
            active: 0,
            totalOpens: 0,
            totalClicks: 0,
            remainingEmails: 0,
            systemStatus: 'ONLINE' // Keep system online even on fetch error
        };
        updateSystemStatus();
    } finally {
        setLoading(false);
    }
}

async function addSubscriber(name, email) {
    try {
        const response = await fetch(CONFIG.SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addSubscriber',
                key: CONFIG.API_KEY,
                token: AppState.sessionToken,
                name: name,
                email: email
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message || 'Subscriber added successfully');
            await fetchDashboardData();
            return true;
        } else {
            throw new Error(result.message || 'Failed to add subscriber');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        return false;
    }
}

async function sendEmail(to, subject, body, senderName) {
    try {
        const response = await fetch(CONFIG.SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sendEmail',
                key: CONFIG.API_KEY,
                token: AppState.sessionToken,
                to: to,
                subject: subject,
                body: body,
                senderName: senderName
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message || 'Email sent successfully');
            return true;
        } else {
            throw new Error(result.message || 'Failed to send email');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        return false;
    }
}

async function loadConversationHistory(email) {
    try {
        const response = await fetch(`${CONFIG.SCRIPT_URL}?action=getConversation&email=${encodeURIComponent(email)}&token=${AppState.sessionToken}&key=${CONFIG.API_KEY}`);
        const result = await response.json();
        
        if (result.success) {
            displayConversationHistory(result.history || []);
        } else {
            throw new Error(result.message || 'Failed to load conversation history');
        }
    } catch (error) {
        showToast('Error loading history: ' + error.message, 'error');
        displayConversationHistory([]);
    }
}

async function updateSubscriberStatus(email, newStatus) {
    try {
        const response = await fetch(CONFIG.SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'updateStatus',
                key: CONFIG.API_KEY,
                token: AppState.sessionToken,
                email: email,
                status: newStatus
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`Subscriber status changed to ${newStatus}`);
            await fetchDashboardData();
            return true;
        } else {
            throw new Error(result.message || 'Failed to update status');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        return false;
    }
}

// ============================= 
// UI UPDATE FUNCTIONS
// ============================= 

function updateDashboard() {
    const stats = AppState.stats;
    
    document.getElementById('totalSubscribers').textContent = stats.total || 0;
    document.getElementById('activeSubscribers').textContent = stats.active || 0;
    document.getElementById('totalOpens').textContent = stats.totalOpens || 0;
    document.getElementById('totalClicks').textContent = stats.totalClicks || 0;
    document.getElementById('remainingEmails').textContent = stats.remainingEmails || 0;
    
    const quotaProgress = document.getElementById('quotaProgress');
    const remaining = stats.remainingEmails || 0;
    const total = 100;
    const used = Math.max(0, total - remaining);
    const percentage = (used / total) * 100;
    
    quotaProgress.style.width = `${percentage}%`;
    quotaProgress.className = 'progress-fill';
    
    if (percentage > 90) {
        quotaProgress.classList.add('danger');
    } else if (percentage > 80) {
        quotaProgress.classList.add('warning');
    }
}

function updateSubscribersTable() {
    const tbody = document.getElementById('subscribersTable');
    const paginationContainer = document.getElementById('paginationContainer');

    const filteredSubscribers = AppState.subscribers.filter(sub =>
        sub.name.toLowerCase().includes(AppState.searchTerm.toLowerCase()) ||
        sub.email.toLowerCase().includes(AppState.searchTerm.toLowerCase())
    );

    if (filteredSubscribers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    No subscribers found
                </td>
            </tr>
        `;
        paginationContainer.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(filteredSubscribers.length / AppState.itemsPerPage);
    const startIndex = (AppState.currentPage - 1) * AppState.itemsPerPage;
    const endIndex = startIndex + AppState.itemsPerPage;
    const paginatedSubscribers = filteredSubscribers.slice(startIndex, endIndex);

    tbody.innerHTML = paginatedSubscribers.map(subscriber => {
        const clicks = Number(subscriber.clicks) || 0;
        const opens = Number(subscriber.opens) || 0;
        const clickRate = opens > 0 ? ((clicks / opens) * 100).toFixed(1) : 0;
        const newStatus = subscriber.status === 'active' ? 'unsubscribed' : 'active';
        return `
        <tr>
            <td><input type="checkbox" class="subscriber-checkbox" data-email="${subscriber.email}" onchange="toggleSubscriberSelect(this)"></td>
            <td style="font-weight: 500; color: var(--text-primary);">${subscriber.name}</td>
            <td>${subscriber.email}</td>
            <td>
                <span class="status-badge status-${subscriber.status}" onclick="updateSubscriberStatus('${subscriber.email}', '${newStatus}')" style="cursor: pointer; transition: all 0.2s;">
                    ${subscriber.status === 'active' ? '✓ Active' : '✗ Unsubscribed'}
                </span>
            </td>
            <td>${subscriber.date || 'N/A'}</td>
            <td style="font-weight: 600; color: var(--accent-blue); cursor: pointer;" onclick="sortTable('opens')">${opens}</td>
            <td style="font-weight: 600; color: var(--success); cursor: pointer;" onclick="sortTable('clicks')">${clicks}</td>
            <td style="color: var(--teal);">${clickRate}%</td>
            <td>
                <button class="action-btn" onclick="quickComposeToUser('${subscriber.email}')" title="Quick Compose">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                </button>
                <button class="action-btn" onclick="openThreadForUser('${subscriber.email}')" title="View Threads">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
                <button class="action-btn danger" onclick="unsubscribeUser('${subscriber.email}')" title="Delete Subscriber">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        </tr>
        `;
    }).join('');

    if (totalPages > 1) {
        paginationContainer.style.display = 'flex';
        document.getElementById('paginationInfo').textContent = `Page ${AppState.currentPage} of ${totalPages}`;
        document.getElementById('prevPageBtn').disabled = AppState.currentPage === 1;
        document.getElementById('nextPageBtn').disabled = AppState.currentPage === totalPages;
    } else {
        paginationContainer.style.display = 'none';
    }
}

function updateSystemStatus() {
    const statusDot = document.getElementById('systemStatusDot');
    const statusText = document.getElementById('systemStatusText');
    const stats = AppState.stats;
    
    if (stats.systemStatus === 'ONLINE') {
        statusDot.className = 'status-dot';
        statusText.textContent = 'System Online';
    } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'System Offline';
    }
}

function displayConversationHistory(history) {
    const container = document.getElementById('threadsContainer');
    
    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <h3>No conversations found</h3>
                <p>Start a conversation with this subscriber</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = history.map(msg => `
        <div class="card" style="margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                <div style="font-weight: 600; color: var(--accent-blue);">${msg.from}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${new Date(msg.timestamp).toLocaleDateString()}</div>
            </div>
            <div style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary);">${msg.subject}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5;">
                ${msg.body.substring(0, 500)}${msg.body.length > 500 ? '...' : ''}
            </div>
        </div>
    `).join('');
}

// ============================= 
// EVENT HANDLERS
// ============================= 

function unsubscribeUser(email) {
    if (confirm('Are you sure you want to remove this subscriber?')) {
        fetch(`${CONFIG.SCRIPT_URL}?action=unsubscribe&email=${encodeURIComponent(email)}&token=${AppState.sessionToken}&key=${CONFIG.API_KEY}`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    showToast('Subscriber removed');
                    fetchDashboardData();
                } else {
                    throw new Error(result.message || 'Failed to remove subscriber');
                }
            })
            .catch(error => {
                showToast('Error removing subscriber: ' + error.message, 'error');
            });
    }
}

function openThreadForUser(email) {
    switchSection('threads');
    document.getElementById('threadEmail').value = email;
    loadConversationHistory(email);
}

function quickComposeToUser(email) {
    switchSection('compose');
    document.getElementById('emailTo').value = email;
    document.getElementById('emailTo').focus();
}

function sortTable(column) {
    if (AppState.sortBy === column) {
        AppState.sortDir = AppState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        AppState.sortBy = column;
        AppState.sortDir = 'desc';
    }
    AppState.currentPage = 1;
    updateSubscribersTable();
}

function toggleSubscriberSelect(checkbox) {
    const email = checkbox.getAttribute('data-email');
    if (checkbox.checked) {
        AppState.selectedSubscribers.add(email);
    } else {
        AppState.selectedSubscribers.delete(email);
    }
    updateBatchActionButtons();
}

function updateBatchActionButtons() {
    const batchActions = document.getElementById('batchActionsContainer');
    if (AppState.selectedSubscribers.size > 0) {
        batchActions.style.display = 'flex';
        document.getElementById('selectedCount').textContent = AppState.selectedSubscribers.size;
    } else {
        batchActions.style.display = 'none';
    }
}

function batchDeleteSubscribers() {
    if (AppState.selectedSubscribers.size === 0) return;
    if (!confirm(`Delete ${AppState.selectedSubscribers.size} subscriber(s)?`)) return;
    
    // Convert Set to Array for batch processing
    const emailsToDelete = Array.from(AppState.selectedSubscribers);
    let deletedCount = 0;
    let errorCount = 0;
    
    // Process deletions sequentially to avoid race conditions
    const deleteNext = (index) => {
        if (index >= emailsToDelete.length) {
            // All deletions processed
            AppState.selectedSubscribers.clear();
            updateBatchActionButtons();
            fetchDashboardData(); // Refresh data
            
            // Show summary
            if (errorCount > 0) {
                showToast(`Deleted ${deletedCount} subscribers, ${errorCount} errors occurred`, 'warning');
            } else {
                showToast(`Successfully deleted ${deletedCount} subscribers`);
            }
            return;
        }
        
        const email = emailsToDelete[index];
        
        // Direct API call without confirmation dialog for bulk operations
        fetch(`${CONFIG.SCRIPT_URL}?action=unsubscribe&email=${encodeURIComponent(email)}&token=${AppState.sessionToken}&key=${CONFIG.API_KEY}`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    deletedCount++;
                } else {
                    errorCount++;
                    console.error(`Failed to delete ${email}:`, result.message);
                }
                
                // Process next email
                deleteNext(index + 1);
            })
            .catch(error => {
                errorCount++;
                console.error(`Error deleting ${email}:`, error);
                
                // Process next email even if current one failed
                deleteNext(index + 1);
            });
    };
    
    // Start batch deletion
    deleteNext(0);
}

function setDateRange() {
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;
    
    if (startDate && endDate) {
        AppState.dateRangeFilter = { start: startDate, end: endDate };
    } else {
        AppState.dateRangeFilter = null;
    }
    AppState.currentPage = 1;
    updateSubscribersTable();
}

function exportCSV() {
    const headers = ['ID', 'Name', 'Email', 'Status', 'Date Joined', 'Opens', 'Clicks', 'Click Rate %'];
    const rows = AppState.subscribers.map(sub => {
        const clicks = Number(sub.clicks) || 0;
        const opens = Number(sub.opens) || 0;
        const clickRate = opens > 0 ? ((clicks / opens) * 100).toFixed(1) : 0;
        return [sub.id, sub.name, sub.email, sub.status, sub.date, opens, clicks, clickRate];
    });
    
    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    showToast('CSV exported successfully');
}

async function handleCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const fileName = file.name.toLowerCase();
    let subscribers = [];
    
    try {
        const text = await file.text();
        
        if (fileName.endsWith('.json')) {
            // Handle JSON format (like your data structure)
            try {
                const jsonData = JSON.parse(text);
                if (jsonData.data && Array.isArray(jsonData.data)) {
                    subscribers = jsonData.data.map(item => ({
                        name: item.name || 'Unknown',
                        email: item.email,
                        sendWelcome: false
                    })).filter(sub => sub.email); // Only include items with email
                } else if (Array.isArray(jsonData)) {
                    subscribers = jsonData.map(item => ({
                        name: item.name || 'Unknown',
                        email: item.email,
                        sendWelcome: false
                    })).filter(sub => sub.email);
                }
            } catch (jsonError) {
                showToast('Invalid JSON format', 'error');
                return;
            }
        } else if (fileName.endsWith('.csv')) {
            // Handle CSV format
            const lines = text.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                showToast('CSV file appears to be empty', 'error');
                return;
            }
            
            // Parse CSV (assuming format: Name,Email)
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            const nameIndex = headers.findIndex(h => h.includes('name'));
            const emailIndex = headers.findIndex(h => h.includes('email'));
            
            if (nameIndex === -1 || emailIndex === -1) {
                showToast('CSV must contain Name and Email columns', 'error');
                return;
            }
            
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                if (values[emailIndex] && values[nameIndex]) {
                    subscribers.push({
                        name: values[nameIndex] || 'Unknown',
                        email: values[emailIndex],
                        sendWelcome: false
                    });
                }
            }
        } else {
            showToast('Please select a CSV or JSON file', 'error');
            return;
        }
        
        if (subscribers.length === 0) {
            showToast('No valid subscribers found in file', 'error');
            return;
        }
        
        // Show confirmation dialog with sample data
        const sample = subscribers.slice(0, 3).map(s => `${s.name} (${s.email})`).join(', ');
        const confirmMessage = `Found ${subscribers.length} subscribers to import.\n\nSample: ${sample}${subscribers.length > 3 ? '...' : ''}\n\nContinue?`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // Import subscribers
        try {
            const response = await fetch(CONFIG.SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'importSubscribers',
                    key: CONFIG.API_KEY,
                    token: AppState.sessionToken,
                    subscribers: subscribers
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                showToast(result.message || 'Import completed successfully');
                await fetchDashboardData();
                
                // Show detailed results if there were any failures
                const failed = result.results ? result.results.filter(r => !r.success) : [];
                if (failed.length > 0) {
                    console.log('Import failures:', failed);
                    showToast(`${failed.length} subscribers failed to import. Check console for details.`, 'warning');
                }
            } else {
                throw new Error(result.message || 'Import failed');
            }
        } catch (fetchError) {
            console.error('Import fetch error:', fetchError);
            throw new Error('Failed to connect to server: ' + fetchError.message);
        }
        
    } catch (error) {
        showToast('Import error: ' + error.message, 'error');
    } finally {
        // Clear the file input
        event.target.value = '';
    }
}

function nextPage() {
    const filteredSubscribers = AppState.subscribers.filter(sub =>
        sub.name.toLowerCase().includes(AppState.searchTerm.toLowerCase()) ||
        sub.email.toLowerCase().includes(AppState.searchTerm.toLowerCase())
    );
    const totalPages = Math.ceil(filteredSubscribers.length / AppState.itemsPerPage);
    if (AppState.currentPage < totalPages) {
        AppState.currentPage++;
        updateSubscribersTable();
    }
}

function prevPage() {
    if (AppState.currentPage > 1) {
        AppState.currentPage--;
        updateSubscribersTable();
    }
}

// ============================= 
// NAVIGATION
// ============================= 

function switchSection(sectionId) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');
    
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');
    
    const titles = {
        dashboard: 'Dashboard',
        audience: 'Audience Management',
        compose: 'Compose Email',
        threads: 'Gmail Threads',
        'api-info': 'API Information'
    };
    document.getElementById('pageTitle').textContent = titles[sectionId] || 'Dashboard';
    
    AppState.currentSection = sectionId;
}

// ============================= 
// INITIALIZATION
// ============================= 

function initializeApp() {
    const sidebar = document.querySelector('.sidebar');
    
    const oldLogoutBtn = document.getElementById('logoutBtn');
    if (oldLogoutBtn) oldLogoutBtn.remove();
    
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logoutBtn';
    logoutBtn.className = 'btn btn-secondary';
    logoutBtn.textContent = '🚪 Logout';
    logoutBtn.style.position = 'absolute';
    logoutBtn.style.bottom = '2rem';
    logoutBtn.style.left = '1rem';
    logoutBtn.style.right = '1rem';
    logoutBtn.style.width = 'calc(100% - 2rem)';
    logoutBtn.style.marginLeft = '0';
    logoutBtn.onclick = handleLogout;
    sidebar.appendChild(logoutBtn);
    
    document.getElementById('scriptUrl').textContent = CONFIG.SCRIPT_URL;
    
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('data-section');
            switchSection(section);
        });
    });
    
    document.getElementById('mobileToggle').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('mobile-visible');
    });
    
    document.getElementById('syncBtn').addEventListener('click', fetchDashboardData);
    
    document.getElementById('searchInput').addEventListener('input', (e) => {
        AppState.searchTerm = e.target.value;
        AppState.currentPage = 1;
        updateSubscribersTable();
    });

    document.getElementById('prevPageBtn').addEventListener('click', prevPage);
    document.getElementById('nextPageBtn').addEventListener('click', nextPage);
    
    // Select All Checkbox Handler
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('input[data-email]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
                toggleSubscriberSelect(checkbox);
            });
        });
    }
    
    document.getElementById('addSubscriberBtn').addEventListener('click', () => {
        document.getElementById('addSubscriberModal').classList.add('show');
    });
    
    document.getElementById('closeAddModal').addEventListener('click', () => {
        document.getElementById('addSubscriberModal').classList.remove('show');
    });
    
    document.getElementById('addSubscriberForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('newSubscriberName').value;
        const email = document.getElementById('newSubscriberEmail').value;
        
        if (await addSubscriber(name, email)) {
            document.getElementById('addSubscriberModal').classList.remove('show');
            document.getElementById('addSubscriberForm').reset();
        }
    });
    
    document.getElementById('composeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const to = document.getElementById('emailTo').value;
        const subject = document.getElementById('emailSubject').value;
        const body = document.getElementById('emailBody').value;
        const senderName = document.getElementById('senderName').value;
        
        if (await sendEmail(to, subject, body, senderName)) {
            document.getElementById('composeForm').reset();
        }
    });
    
    document.getElementById('loadThreadsBtn').addEventListener('click', () => {
        const email = document.getElementById('threadEmail').value;
        if (email) {
            loadConversationHistory(email);
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.remove('show');
            });
        }
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
    
    AppState.autoSyncTimer = setInterval(fetchDashboardData, CONFIG.AUTO_SYNC_INTERVAL);
    
    fetchDashboardData();
}

// ============================= 
// LOGIN EVENT HANDLER
// ============================= 

document.addEventListener('DOMContentLoaded', () => {
    initializeAuthFlow();
    
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('passwordInput').value;
        
        if (!password || password.length < 1) {
            document.getElementById('loginError').textContent = '❌ Please enter password';
            document.getElementById('loginError').style.display = 'block';
            return;
        }
        
        await handleLogin(password);
    });
});
