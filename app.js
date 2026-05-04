// app.js - Core Logic for Borrowing System

// --- Authentication Check ---
if (sessionStorage.getItem('borrowSys_loggedIn') !== 'true') {
  window.location.href = 'login.html';
}

const STORAGE_KEY = 'borrowing_system_data';

const DEFAULT_DATA = {
  users: [],
  items: [],
  records: [],
  activity: [],
  requests: [], // Added requests
  settings: { 
    rate_per_day: 10.00,
    approved_by: "MARY JEAN DOMINGO",
    approved_by_contact: "09354163623",
    issued_by: "ROYCE",
    issued_by_contact: "09123456789"
  }
};

// --- Utility Functions ---
const capitalize = (str) => {
  if (!str) return '';
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

const formatDateStr = (d) => {
  if (!d) return 'N/A';
  return String(d).split('T')[0];
};

const formatDateTimeStr = (d) => {
  if (!d) return 'N/A';
  return String(d).replace('T', ' ').substring(0, 16);
};

// --- Custom Notifications ---
const showToast = (message, type = 'success') => {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

const showConfirm = (message, onConfirm) => {
  showModal(`
    <div style="max-width: 350px; margin: 0 auto; text-align: left;">
      <h3 style="margin-bottom: 0.75rem; font-weight: 700; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Confirm Action</h3>
      <p style="color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.6;">${message}</p>
      <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
        <button class="btn btn-outline" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px;" onclick="hideModal()">Cancel</button>
        <button class="btn btn-danger" id="confirm-action-btn" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px; background: #dc3545;">Yes, Delete</button>
      </div>
    </div>
  `);
  
  document.getElementById('confirm-action-btn').onclick = () => {
    hideModal();
    onConfirm();
  };
};
// --- Google Sheets Database URL ---
// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxNXmHzzxNOJ-WJFDszUqwoBZSYpTKUEQ40mDllfmhZvaVqr4ro__lyPY68yf0JTrVb/exec';

const Storage = {
  /**
   * Load data from localStorage (fast cache)
   */
  load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        parsed.users = parsed.users || [];
        parsed.items = parsed.items || [];
        parsed.records = parsed.records || [];
        parsed.activity = parsed.activity || [];
        parsed.settings = parsed.settings || DEFAULT_DATA.settings;
        return parsed;
      } catch (e) {
        console.error('Failed to parse localStorage data', e);
        return { ...DEFAULT_DATA };
      }
    }
    return { ...DEFAULT_DATA };
  },

  // Lock to prevent race conditions between saving and auto-loading
  isSyncing: false,

  /**
   * Save data to localStorage + sync to Google Sheets
   */
  save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    this.syncToCloud(data);
  },

  /**
   * Load data from Google Sheets (restore from cloud)
   */
  async loadFromCloud(isAuto = false) {
    if (!GOOGLE_SHEET_URL || this.isSyncing) return null;
    console.log("Attempting cloud sync...");
    try {
      const response = await fetch(`${GOOGLE_SHEET_URL}?action=getAll&t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        console.error("Server returned non-JSON response:", text);
        return null;
      }
      
      if (result.success && result.data) {
        const cloudData = result.data;
        
        if (!cloudData.items || !Array.isArray(cloudData.items)) {
          console.warn("Cloud data invalid:", cloudData);
          return appData;
        }

        appData.users = Array.isArray(cloudData.users) ? cloudData.users : appData.users;
        appData.items = cloudData.items;
        
        // Sanitize records (fix qty corrupted into dates by Google Sheets)
        appData.records = Array.isArray(cloudData.records) ? cloudData.records.map(r => {
          if (typeof r.qty === 'string' && r.qty.includes('T')) {
            r.qty = 1; // Fallback to 1 if Google Sheets interpreted the number as a Date
          }
          // Also enforce numeric qty
          r.qty = parseInt(r.qty) || 1;
          return r;
        }) : appData.records;

        appData.activity = Array.isArray(cloudData.activity) ? cloudData.activity : appData.activity;
        appData.requests = Array.isArray(cloudData.requests) ? cloudData.requests : appData.requests;
        
        if (cloudData.settings) {
          appData.settings = Array.isArray(cloudData.settings) ? cloudData.settings[0] : cloudData.settings;
        }

        window.hasLoadedFromCloud = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        
        const pendingCount = (appData.requests || []).filter(r => r.status === 'pending').length;
        
        // Only show toast on manual refresh or if new requests found
        if (!isAuto) {
          showToast(pendingCount > 0 ? `Synced! ${pendingCount} requests found.` : 'Cloud Synced', 'success');
        } else if (pendingCount > 0) {
          // Check if we already toasted for this count (basic debounce)
          if (window.lastPendingCount !== pendingCount) {
             showToast(`New Action Required: ${pendingCount} Pending Requests`, 'warning');
             window.lastPendingCount = pendingCount;
          }
        }

        if (typeof switchView === 'function') switchView(currentView);
        return appData;
      } else {
        console.error("Cloud error:", result.error);
        return null;
      }
    } catch (e) {
      console.error('Cloud load failed:', e);
      // Only show error toast occasionally or if it's the first load
      if (!window.hasLoadedFromCloud) showToast('Cloud connection failed. Check internet.', 'danger');
      return null;
    }
  },

  /**
   * Sync data to Google Sheets (Direct Fetch method)
   */
  async syncToCloud(data) {
    if (!GOOGLE_SHEET_URL) return;
    
    // Safety Lock
    if (!window.hasLoadedFromCloud && data.items.length === 0) {
      console.warn("Sync blocked: Waiting for cloud connection.");
      return;
    }

    this.isSyncing = true;

    // Normalize data so that the first element of each array contains all possible keys
    // This prevents Google Apps Script jsonToSheet from dropping columns like qty or due_date
    const normalizeArray = (arr) => {
      if (!arr || arr.length === 0) return arr;
      const allKeys = new Set();
      arr.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
      return arr.map(item => {
        const normalized = {};
        allKeys.forEach(k => normalized[k] = item[k] !== undefined ? item[k] : '');
        return normalized;
      });
    };

    const payload = {
      action: 'saveAll',
      users: normalizeArray(data.users || []),
      items: normalizeArray(data.items || []),
      records: normalizeArray(data.records || []),
      activity: normalizeArray((data.activity || []).slice(0, 50)),
      settings: data.settings || DEFAULT_DATA.settings,
      requests: normalizeArray(data.requests || [])
    };

    try {
      // Using 'no-cors' for Google Apps Script POST
      await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log("Cloud sync sent successfully.");
    } catch (e) {
      console.error("Cloud sync error:", e);
      showToast('Sync connection lost. Check internet.', 'danger');
    } finally {
      this.isSyncing = false;
    }
  },

};

// --- App State ---
let appData = Storage.load();

// Sanitize local records (fix qty corrupted into dates)
if (Array.isArray(appData.records)) {
  appData.records.forEach(r => {
    if (typeof r.qty === 'string' && r.qty.includes('T')) r.qty = 1;
    r.qty = parseInt(r.qty) || 1;
  });
}

let currentView = 'dashboard';
let searchQuery = '';

// --- View Renderers ---
const renderDashboard = () => {
  const mainView = document.getElementById('main-view');
  const activeBorrows = appData.records.filter(r => r.status === 'borrowed').length;
  const totalItems = appData.items.length;
  const overdueItems = appData.records.filter(r => r.status === 'overdue').length;
  const pendingRequests = (appData.requests || []).filter(req => req.status === 'pending').length;

  // Calculate Top Office
  const officeCounts = {};
  appData.records.forEach(r => {
    const office = r.office || 'Unassigned';
    officeCounts[office] = (officeCounts[office] || 0) + 1;
  });
  const topOfficeEntry = Object.entries(officeCounts).sort((a,b) => b[1] - a[1])[0];
  const topOffice = topOfficeEntry ? topOfficeEntry[0] : 'N/A';
  const topOfficeCount = topOfficeEntry ? topOfficeEntry[1] : 0;
  
  // Calculate a mock percentage for the active borrows vs total items
  const activePercent = totalItems > 0 ? Math.round((activeBorrows / totalItems) * 100) : 0;

  mainView.innerHTML = `
    <h1 style="font-size: 1.75rem; font-weight: 800; margin-bottom: 2rem;">System Overview</h1>

    <div class="dashboard-grid">
      <div class="main-stats">
        <div class="top-cards" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
          <div class="stat-card-new primary">
            <div>
              <h4>Active Borrows</h4>
              <p>${activeBorrows} Items out</p>
            </div>
            <div class="stat-value-large" style="font-size: 1.8rem;">${activePercent}%</div>
          </div>
          <div class="stat-card-new">
            <div>
              <h4 style="color: var(--success);">Total Inventory</h4>
              <p>${totalItems} Items</p>
            </div>
            <div class="stat-value-large" style="color: var(--success); font-size: 1.8rem;">${totalItems}</div>
          </div>
          <div class="stat-card-new">
            <div>
              <h4 style="color: var(--primary);">Top Office</h4>
              <p>${topOffice}</p>
            </div>
            <div class="stat-value-large" style="font-size: 1.8rem; color: var(--primary);">${topOfficeCount}</div>
          </div>
          <div class="stat-card-new ${pendingRequests > 0 ? 'pulse-danger' : ''}" style="cursor: pointer; position: relative;" onclick="switchView('requests')">
            <button class="btn btn-soft" style="position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.2rem 0.5rem; font-size: 0.6rem;" onclick="event.stopPropagation(); Storage.loadFromCloud();">Refresh</button>
            <div>
              <h4 style="color: #f39c12;">Pending Requests</h4>
              <p>${pendingRequests} to review</p>
            </div>
            <div class="stat-value-large" style="color: #f39c12; font-size: 1.8rem;">${pendingRequests}</div>
          </div>
          <div class="stat-card-new">
            <div>
              <h4 style="color: var(--danger);">Overdue Items</h4>
              <p>${overdueItems} Total</p>
            </div>
            <div class="stat-value-large" style="color: var(--danger); font-size: 1.8rem;">${overdueItems}</div>
          </div>
        </div>

        <div class="section-title">Quick Access</div>
        <div class="quick-access">
          <button class="btn btn-soft" onclick="switchView('transactions')">Borrow</button>
          <button class="btn btn-soft" onclick="switchView('transactions')">Return</button>
          <button class="btn btn-soft" onclick="switchView('inventory')">Items</button>
          <button class="btn btn-soft" onclick="switchView('borrowers')">Borrowers</button>
        </div>

        <div class="section-title">
          Recent Transactions
          <button class="btn btn-outline" style="padding: 0.4rem 1rem; font-size: 0.8rem; border-radius: 8px;" onclick="switchView('transactions')">See all</button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Items</th>
                <th>Purpose</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${(() => {
                // Sorting and Filtering
                const sorted = appData.records.slice().sort((a, b) => b.id - a.id);
                const filtered = sorted.filter(r => {
                  const user = appData.users.find(u => u.id === r.user_id);
                  const name = user ? user.full_name : (r.user_name || 'Unknown');
                  const item = r.item_name || 'Item';
                  const status = r.status || '';
                  return name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         status.toLowerCase().includes(searchQuery.toLowerCase());
                });

                // Grouping
                const grouped = [];
                const processed = new Set();
                filtered.forEach(r => {
                  if (r.batch_id) {
                    if (!processed.has(r.batch_id)) {
                      const batch = appData.records.filter(rb => rb.batch_id === r.batch_id);
                      grouped.push({ ...r, is_batch: true, batch_records: batch });
                      processed.add(r.batch_id);
                    }
                  } else {
                    grouped.push(r);
                  }
                });

                return grouped.slice(0, 8).map(record => {
                  const user = appData.users.find(u => u.id === record.user_id);
                  const name = user ? user.full_name : (record.user_name || 'Unknown');
                  
                  let itemDisplay = record.item_name;
                  let statusDisplay = record.status;
                  
                  if (record.is_batch) {
                    itemDisplay = record.batch_records.map(br => `<div>• ${br.item_name}</div>`).join('');
                    const allReturned = record.batch_records.every(br => br.status === 'returned');
                    statusDisplay = allReturned ? 'returned' : 'borrowed';
                  }

                  return `
                    <tr>
                      <td style="font-weight: 600;">${name}</td>
                      <td style="color: var(--text-muted);">${itemDisplay}</td>
                      <td style="color: var(--text-muted);">${record.purpose || 'N/A'}</td>
                      <td>${formatDateStr(record.due_date)}</td>
                      <td><span class="badge badge-${statusDisplay === 'returned' ? 'success' : (statusDisplay === 'overdue' ? 'danger' : 'warning')}">${statusDisplay}</span></td>
                      <td><button class="btn btn-soft print-btn" data-id="${record.id}" style="padding: 0.3rem 0.6rem; font-size: 0.7rem; border-radius: 6px;">Print</button></td>
                    </tr>
                  `;
                }).join('') || '<tr><td colspan="6" style="text-align:center;">No recent records</td></tr>';
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="activity-panel">
        <h3 class="section-title" style="margin-bottom: 1rem;">Real-time Activity</h3>
        <div id="activity-feed">
          <!-- Feed items injected by renderActivityFeed -->
        </div>
      </div>
    </div>
  `;

  // Handle Print on Dashboard
  document.querySelectorAll('.print-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const record = appData.records.find(r => r.id === id);
      if (record) handlePrint(record);
    };
  });
};

const renderActivityFeed = () => {
  const feedContainer = document.getElementById('activity-feed');
  if (!feedContainer) return;
  
  // Use the dedicated activity log
  const recentActs = appData.activity.slice(0, 8);
  
  feedContainer.innerHTML = recentActs.map(act => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div class="activity-content">
        <div class="activity-time">${act.time || 'Just now'}</div>
        <div class="activity-text">${act.text}</div>
      </div>
    </div>
  `).join('') || '<div style="font-size: 0.85rem; color: var(--text-muted);">No recent activity.</div>';
};

const renderInventory = () => {
  const mainView = document.getElementById('main-view');
  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">Inventory</h1>
      <button class="btn btn-primary" id="add-item-btn">+ Add New Item</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Item Name</th>
            <th>Category</th>
            <th>Available</th>
            <th>Total</th>
            <th>Damage Cost</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${appData.items
            .filter(i => 
              i.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
              i.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
              i.id.toString().includes(searchQuery)
            )
            .map(item => `
            <tr>
              <td style="font-weight: 600;">${item.name}</td>
              <td>${item.category}</td>
              <td>${item.available_qty}</td>
              <td>${item.total_qty}</td>
              <td>₱${parseFloat(item.damage_cost).toFixed(2)}</td>
              <td>
                <div style="display: flex; gap: 0.5rem;">
                  <button class="btn btn-outline edit-item-btn" data-id="${item.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Edit</button>
                  <button class="btn btn-outline delete-item-btn" data-id="${item.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; color: var(--danger); border-color: var(--danger);">Delete</button>
                </div>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="text-align:center;">No items found</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Add Item Logic
  const addItemBtn = document.getElementById('add-item-btn');
  if (addItemBtn) {
    addItemBtn.onclick = () => {
      showModal(`
        <h2 style="margin-bottom: 1.5rem;">Add New Item</h2>
        <form id="add-item-form">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input type="text" class="form-input" name="name" required />
          </div>
          <div class="form-group">
            <label class="form-label">Category</label>
            <input type="text" class="form-input" name="category" required />
          </div>
          <div style="display: flex; gap: 1rem;">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Total Qty</label>
              <input type="number" class="form-input" name="total_qty" required min="1" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Damage Cost</label>
              <input type="number" step="0.01" class="form-input" name="damage_cost" required min="0" />
            </div>
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex: 1;">Save Item</button>
          </div>
        </form>
      `);

      document.getElementById('add-item-form').onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newItem = {
          id: Date.now(),
          name: capitalize(formData.get('name')),
          category: capitalize(formData.get('category')),
          total_qty: parseInt(formData.get('total_qty')),
          available_qty: parseInt(formData.get('total_qty')), // New items are fully available
          damage_cost: parseFloat(formData.get('damage_cost'))
        };
        appData.items.push(newItem);
        Storage.save(appData);
        hideModal();
        renderInventory();
      };
    };
  }

  // Edit Item Logic
  document.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const item = appData.items.find(i => i.id === id);
      if (item) {
        showModal(`
          <h2 style="margin-bottom: 1.5rem;">Edit Item</h2>
          <form id="edit-item-form">
            <div class="form-group">
              <label class="form-label">Name</label>
              <input type="text" class="form-input" name="name" value="${(item.name || '').replace(/"/g, '&quot;')}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Category</label>
              <input type="text" class="form-input" name="category" value="${(item.category || '').replace(/"/g, '&quot;')}" required />
            </div>
            <div style="display: flex; gap: 1rem;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Total Qty</label>
                <input type="number" class="form-input" name="total_qty" value="${item.total_qty}" required min="1" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Damage Cost</label>
                <input type="number" step="0.01" class="form-input" name="damage_cost" value="${item.damage_cost}" required min="0" />
              </div>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" style="flex: 1;">Update Item</button>
            </div>
          </form>
        `);

        document.getElementById('edit-item-form').onsubmit = (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          
          // Calculate availability difference in case total qty changed
          const newTotal = parseInt(formData.get('total_qty')) || 0;
          const diff = newTotal - (parseInt(item.total_qty) || 0);

          item.name = capitalize(formData.get('name'));
          item.category = capitalize(formData.get('category'));
          item.total_qty = newTotal;
          item.available_qty = Math.max(0, (parseInt(item.available_qty) || 0) + diff);
          item.damage_cost = parseFloat(formData.get('damage_cost')) || 0;
          
          Storage.save(appData);
          hideModal();
          renderInventory();
        };
      }
    };
  });

  // Delete Item Logic
  document.querySelectorAll('.delete-item-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const itemIndex = appData.items.findIndex(i => i.id === id);
      if (itemIndex > -1) {
        if (confirm('Are you sure you want to delete this item?')) {
          appData.items.splice(itemIndex, 1);
          Storage.save(appData);
          renderInventory();
          showToast('Item deleted successfully', 'success');
        }
      }
    };
  });
};

const renderBorrowers = () => {
  const mainView = document.getElementById('main-view');
  const borrowers = appData.users.filter(u => 
    u.role === 'borrower' && 
    (u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
     (u.office && u.office.toLowerCase().includes(searchQuery.toLowerCase())) ||
     (u.phone && u.phone.includes(searchQuery)))
  );
  
  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">Borrowers</h1>
      <button class="btn btn-primary" id="add-user-btn">+ Add New Borrower</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Office</th>
            <th>Total Borrows</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${borrowers.map(user => `
            <tr>
               <td style="font-weight: 600;">${user.full_name}</td>
               <td>${user.email}</td>
               <td>${user.phone}</td>
               <td><span class="badge" style="background: var(--primary-soft); color: var(--primary);">${user.office || 'Unassigned'}</span></td>
               <td style="text-align: center; font-weight: 700; color: var(--primary);">
                 ${appData.records.filter(r => r.user_id === user.id).length}
               </td>
              <td>
                <button class="btn btn-outline edit-user-btn" data-id="${user.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Edit</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="text-align:center;">No borrowers found</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Add User Logic
  const addUserBtn = document.getElementById('add-user-btn');
  if (addUserBtn) {
    addUserBtn.onclick = () => {
      showModal(`
        <h2 style="margin-bottom: 1.5rem;">Add New Borrower</h2>
        <form id="add-user-form">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-input" name="full_name" required />
          </div>
          <div class="form-group">
            <label class="form-label">Username (Not needed for login, but required for ID)</label>
            <input type="text" class="form-input" name="username" required />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" name="email" required />
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="text" class="form-input" name="phone" required />
          </div>
          <div class="form-group">
            <label class="form-label">Office / Department</label>
            <input type="text" class="form-input" name="office" placeholder="e.g. Finance, GSO..." required />
          </div>
          <input type="hidden" name="role" value="borrower" />
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex: 1;">Save Borrower</button>
          </div>
        </form>
      `);

      document.getElementById('add-user-form').onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newUser = {
          id: Date.now(),
          full_name: capitalize(formData.get('full_name')),
          username: formData.get('username').toLowerCase(),
          email: formData.get('email').toLowerCase(),
          phone: formData.get('phone'),
          office: capitalize(formData.get('office')),
          role: 'borrower',
          password: 'password123' 
        };
        appData.users.push(newUser);
        Storage.save(appData);
        hideModal();
        renderBorrowers();
      };
    };
  }

  // Edit User Logic
  document.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const user = appData.users.find(u => u.id === id);
      if (user) {
        showModal(`
          <h2 style="margin-bottom: 1.5rem;">Edit Borrower</h2>
          <form id="edit-user-form">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" class="form-input" name="full_name" value="${user.full_name}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="form-input" name="email" value="${user.email}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input type="text" class="form-input" name="phone" value="${user.phone}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Office / Department</label>
              <input type="text" class="form-input" name="office" value="${user.office || ''}" required />
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" style="flex: 1;">Update Borrower</button>
            </div>
          </form>
        `);

        document.getElementById('edit-user-form').onsubmit = (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          user.full_name = formData.get('full_name');
          user.email = formData.get('email');
          user.phone = formData.get('phone');
          user.office = formData.get('office');
          
          Storage.save(appData);
          hideModal();
          renderBorrowers();
        };
      }
    };
  });
};

const renderSystemUsers = () => {
  const mainView = document.getElementById('main-view');
  const systemUsers = appData.users.filter(u => 
    u.role !== 'borrower' &&
    (u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
     u.role.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  
  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">System Users</h1>
      <button class="btn btn-primary" id="add-sys-user-btn">+ Add System User</button>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Password</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${systemUsers.map(user => `
            <tr>
               <td style="font-weight: 600;">${user.full_name}</td>
               <td><code>${user.username}</code></td>
               <td><span style="font-family: monospace; color: var(--text-muted);">${user.password || '********'}</span></td>
               <td><span class="badge" style="background: #e2e8f0;">${user.role}</span></td>
              <td>
                <button class="btn btn-outline edit-sys-user-btn" data-id="${user.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Edit</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="text-align:center;">No system users found</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Add System User Logic
  const addUserBtn = document.getElementById('add-sys-user-btn');
  if (addUserBtn) {
    addUserBtn.onclick = () => {
      showModal(`
        <h2 style="margin-bottom: 1.5rem;">Add System User</h2>
        <form id="add-sys-user-form">
          <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-input" name="full_name" required />
          </div>
          <div class="form-group">
            <label class="form-label">Username (for login)</label>
            <input type="text" class="form-input" name="username" required />
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-input" name="role">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex: 1;">Save User</button>
          </div>
        </form>
      `);

      document.getElementById('add-sys-user-form').onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newUser = {
          id: Date.now(),
          full_name: formData.get('full_name'),
          username: formData.get('username'),
          email: '',
          phone: '',
          role: formData.get('role'),
          password: 'password123' // Default password for new users
        };
        appData.users.push(newUser);
        Storage.save(appData);
        hideModal();
        renderSystemUsers();
      };
    };
  }

  // Edit System User Logic
  document.querySelectorAll('.edit-sys-user-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const user = appData.users.find(u => u.id === id);
      if (user) {
        showModal(`
          <h2 style="margin-bottom: 1.5rem;">Edit System User</h2>
          <form id="edit-sys-user-form">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" class="form-input" name="full_name" value="${user.full_name}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" class="form-input" name="username" value="${user.username}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="text" class="form-input" name="password" value="${user.password || 'password123'}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-input" name="role">
                <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" style="flex: 1;">Update User</button>
            </div>
          </form>
        `);

        document.getElementById('edit-sys-user-form').onsubmit = (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            user.full_name = formData.get('full_name');
            user.username = formData.get('username');
            user.password = formData.get('password');
            user.role = formData.get('role');
            
            Storage.save(appData);
          hideModal();
          renderSystemUsers();
        };
      }
    };
  });
};

const renderTransactions = () => {
  const mainView = document.getElementById('main-view');
  
  const filteredRecords = appData.records
    .slice()
    .sort((a, b) => b.id - a.id)
    .filter(r => {
      const user = appData.users.find(u => u.id === r.user_id);
      const name = user ? user.full_name : (r.user_name || '');
      const office = user ? (user.office || '') : (r.office || '');
      return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
             (r.item_name && r.item_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
             r.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
             office.toLowerCase().includes(searchQuery.toLowerCase()) ||
             r.id.toString().includes(searchQuery);
    });

  // Grouping logic for Batch Transactions
  const groupedRecords = [];
  const processedBatches = new Set();
  
  filteredRecords.forEach(record => {
    if (record.batch_id) {
      if (!processedBatches.has(record.batch_id)) {
        const batch = appData.records.filter(r => r.batch_id === record.batch_id);
        groupedRecords.push({
          ...record,
          is_batch: true,
          batch_records: batch
        });
        processedBatches.add(record.batch_id);
      }
    } else {
      groupedRecords.push(record);
    }
  });

  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">Transactions</h1>
      <div>
        <button class="btn btn-outline" onclick="switchView('transactions')">Refresh</button>
        <button class="btn btn-primary" id="new-borrow-btn">New Borrow</button>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Borrower</th>
            <th>Office</th>
            <th>Items</th>
            <th>Purpose</th>
            <th>Qty</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${groupedRecords.map(record => {
            const user = appData.users.find(u => u.id === record.user_id);
            const name = user ? user.full_name : (record.user_name || 'User');
            const office = user ? (user.office || 'N/A') : (record.office || 'N/A');
            
            let itemDisplay = record.item_name;
            let qtyDisplay = record.qty || 1;
            let statusDisplay = record.status;
            
            if (record.is_batch) {
              itemDisplay = record.batch_records.map(r => `<div>• ${r.item_name}</div>`).join('');
              qtyDisplay = record.batch_records.map(r => `<div>${r.qty || 1}</div>`).join('');
              const allReturned = record.batch_records.every(r => r.status === 'returned');
              statusDisplay = allReturned ? 'returned' : 'borrowed';
            }

            return `
              <tr>
                <td style="font-weight: 600;">${name}</td>
                <td><span class="badge" style="background: var(--primary-soft); color: var(--primary);">${office}</span></td>
                <td>${itemDisplay}</td>
                <td>${record.purpose || 'N/A'}</td>
                <td style="font-weight: 600;">${qtyDisplay}</td>
                <td>${formatDateStr(record.due_date)}</td>
                <td><span class="badge badge-${statusDisplay === 'returned' ? 'success' : (statusDisplay === 'overdue' ? 'danger' : 'warning')}">${statusDisplay}</span></td>
                <td>
                  <div style="display: flex; gap: 0.5rem;">
                    ${statusDisplay !== 'returned' ? 
                      `<button class="btn btn-primary return-btn" data-id="${record.id}" ${record.is_batch ? `data-batch="${record.batch_id}"` : ''} style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Return</button>` : 
                      `<button class="btn btn-outline" disabled style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Completed</button>`
                    }
                    <button class="btn btn-soft print-btn" data-id="${record.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Print</button>
                    ${!record.is_batch ? `
                    <button class="btn btn-outline edit-record-btn" data-id="${record.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Edit</button>
                    ` : ''}
                    <button class="btn btn-outline delete-record-btn" data-id="${record.id}" ${record.is_batch ? `data-batch="${record.batch_id}"` : ''} style="padding: 0.4rem 0.8rem; font-size: 0.75rem; color: var(--danger);">Delete</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="8" style="text-align:center;">No transactions found</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Handle Return
  document.querySelectorAll('.return-btn').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      const batchId = btn.dataset.batch;
      
      const recordsToUpdate = batchId 
        ? appData.records.filter(r => r.batch_id && r.batch_id.toString() === batchId.toString())
        : [appData.records.find(r => r.id === id)];

      const returnedItems = [];
      let borrowerName = 'User';

      recordsToUpdate.forEach(record => {
        if (record && record.status !== 'returned') {
          record.status = 'returned';
          record.return_date = new Date().toISOString().split('T')[0];
          
          // Update item availability with safety check
          const item = appData.items.find(i => i.id === record.item_id);
          if (item) {
            item.available_qty = Math.min(item.total_qty, item.available_qty + (record.qty || 1));
            returnedItems.push(`<b>${record.qty || 1}x ${record.item_name}</b>`);
          }

          if (record.user_name) borrowerName = record.user_name;
        }
      });

      if (returnedItems.length > 0) {
        // Log activity once for the whole return
        appData.activity.unshift({
          id: Date.now(),
          text: `<b>${borrowerName}</b> returned ${returnedItems.join(' and ')}`,
          time: 'Just now'
        });
      }
      
      Storage.save(appData);
      renderTransactions();
      renderActivityFeed();
    };
  });

  // Handle Edit
  document.querySelectorAll('.edit-record-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id; // Keep as string for loose comparison
      const record = appData.records.find(r => r.id == id);
      if (record) {
        showModal(`
          <h2 style="margin-bottom: 1.5rem;">Edit Transaction</h2>
          <form id="edit-record-form">
            <div class="form-group">
              <label class="form-label">Borrower</label>
              <select class="form-input" name="user_id" id="edit-borrower-select" required>
                ${appData.users.filter(u => u.role === 'borrower').map(u => `<option value="${u.id}" ${u.id === record.user_id ? 'selected' : ''}>${u.full_name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Office / Department</label>
              <input type="text" class="form-input" name="office" id="edit-borrower-office" value="${record.office || ''}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Item</label>
              <select class="form-input" name="item_id" required>
                ${appData.items.map(i => `<option value="${i.id}" ${i.id === record.item_id ? 'selected' : ''}>${i.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Purpose</label>
              <input type="text" class="form-input" name="purpose" value="${record.purpose || ''}" placeholder="Enter purpose..." required />
            </div>
            <div class="form-group">
              <label class="form-label">Quantity</label>
              <input type="number" class="form-input" name="qty" value="${record.qty || 1}" min="1" required />
            </div>
            <div class="form-group">
              <label class="form-label">Due Date</label>
              <input type="date" class="form-input" name="due_date" value="${formatDateStr(record.due_date) === 'N/A' ? '' : formatDateStr(record.due_date)}" min="${new Date().toISOString().split('T')[0]}" required />
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
              <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
              <button type="submit" class="btn btn-primary" style="flex: 1;">Update Record</button>
            </div>
          </form>
        `);

        document.getElementById('edit-record-form').onsubmit = (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const oldQty = record.qty || 1;
          const newQty = parseInt(formData.get('qty'));
          const newItemId = parseInt(formData.get('item_id'));
          
          // Revert old stock
          const oldItem = appData.items.find(i => i.id === record.item_id);
          if (oldItem) oldItem.available_qty += oldQty;
          
          // Apply new stock
          const newItem = appData.items.find(i => i.id === newItemId);
          if (newItem) {
            if (newItem.available_qty < newQty) {
              showToast(`Not enough stock for this change. Only ${newItem.available_qty} available.`, 'danger');
              oldItem.available_qty -= oldQty; // Re-revert
              return;
            }
            newItem.available_qty -= newQty;
          }

          record.user_id = parseInt(formData.get('user_id'));
          record.office = formData.get('office');
          record.purpose = formData.get('purpose');
          record.item_id = newItemId;
          record.item_name = newItem.name;
          record.qty = newQty;
          record.due_date = formData.get('due_date');
          
          Storage.save(appData);
          hideModal();
          renderTransactions();
        };
      }
    };
  });

  document.querySelectorAll('.delete-record-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const batchId = btn.dataset.batch;
      
      const recordsToDelete = batchId 
        ? appData.records.filter(r => r.batch_id && r.batch_id.toString() === batchId.toString())
        : [appData.records.find(r => r.id.toString() === id.toString())];

      if (recordsToDelete.length > 0) {
        showConfirm(`Are you sure you want to delete this transaction? ${batchId ? 'All items in this batch will be removed.' : ''}`, () => {
          let deletedDetails = [];
          let borrowerName = 'User';

          recordsToDelete.forEach(record => {
            if (record) {
              // Restore stock if not returned (with safety check)
              if (record.status !== 'returned') {
                const item = appData.items.find(i => i.id === record.item_id);
                if (item) item.available_qty = Math.min(item.total_qty, item.available_qty + (record.qty || 1));
              }
              deletedDetails.push(`<b>${record.item_name}</b>`);
              borrowerName = record.user_name;

              const idx = appData.records.indexOf(record);
              if (idx !== -1) appData.records.splice(idx, 1);
            }
          });
          
          // Log activity
          appData.activity.unshift({
            id: Date.now(),
            text: `Transaction deleted: <b>${borrowerName}</b> removed ${deletedDetails.join(' and ')}`,
            time: 'Just now'
          });

          Storage.save(appData);
          renderTransactions();
          renderActivityFeed();
          showToast('Transaction deleted', 'success');
        });
      }
    };
  });

  // Handle New Borrow
  const newBorrowBtn = document.getElementById('new-borrow-btn');
  if (newBorrowBtn) {
    newBorrowBtn.onclick = () => {
      showModal(`
        <h2 style="margin-bottom: 1rem;">New Borrow Transaction</h2>
        <form id="borrow-form">
          <div class="form-group">
            <label class="form-label" style="display: flex; justify-content: space-between;">
              Borrower
              <span id="quick-add-borrower" style="color: var(--primary); cursor: pointer; font-size: 0.8rem; font-weight: 600;">+ Quick Add New</span>
            </label>
            <select class="form-input" name="user_id" id="borrower-select" required>
              <option value="">Select a borrower...</option>
              ${appData.users.filter(u => u.role === 'borrower').sort((a,b) => a.full_name.localeCompare(b.full_name)).map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')}
            </select>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Borrower Category</label>
              <select class="form-input" name="borrower_category" required>
                <option value="Employee">Employee</option>
                <option value="Staff">Staff</option>
                <option value="Others" selected>Others</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Office / Department</label>
              <input type="text" class="form-input" name="office" id="borrower-office" placeholder="Enter office..." required />
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Item 1</label>
              <select class="form-input" name="item_id_1" required>
                <option value="">Select Item 1...</option>
                ${appData.items.filter(i => i.available_qty > 0).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.available_qty})</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Qty 1</label>
              <input type="number" class="form-input" name="qty_1" value="1" min="1" required />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px dotted rgba(255,255,255,0.2);">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Item 2 (Optional)</label>
              <select class="form-input" name="item_id_2">
                <option value="">None</option>
                ${appData.items.filter(i => i.available_qty > 0).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.available_qty})</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Qty 2</label>
              <input type="number" class="form-input" name="qty_2" value="1" min="1" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px dotted rgba(255,255,255,0.2);">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Item 3 (Optional)</label>
              <select class="form-input" name="item_id_3">
                <option value="">None</option>
                ${appData.items.filter(i => i.available_qty > 0).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.available_qty})</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Qty 3</label>
              <input type="number" class="form-input" name="qty_3" value="1" min="1" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.75rem; border: 1px dotted rgba(255,255,255,0.2);">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Item 4 (Optional)</label>
              <select class="form-input" name="item_id_4">
                <option value="">None</option>
                ${appData.items.filter(i => i.available_qty > 0).map(i => `<option value="${i.id}">${i.name} (Stock: ${i.available_qty})</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Qty 4</label>
              <input type="number" class="form-input" name="qty_4" value="1" min="1" />
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 0.75rem;">
            <label class="form-label">Purpose</label>
            <input type="text" class="form-input" name="purpose" placeholder="Enter purpose..." required />
          </div>
          <div class="form-group" style="margin-bottom: 0.75rem;">
            <label class="form-label">Time/Date (Expected date of Return)</label>
            <input type="date" class="form-input" name="due_date" min="${new Date().toISOString().split('T')[0]}" required />
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-outline" style="flex: 1;" onclick="hideModal()">Cancel</button>
            <button type="submit" class="btn btn-primary" style="flex: 1;">Confirm Borrow</button>
          </div>
        </form>
      `);

      // Auto-fill office
      const borrowerSelect = document.getElementById('borrower-select');
      const officeInput = document.getElementById('borrower-office');

      // Quick Add Borrower Logic
      document.getElementById('quick-add-borrower').onclick = () => {
        const name = prompt("Enter Borrower's Full Name:");
        if (!name) return;
        const office = prompt("Enter Office / Department:");
        if (!office) return;
        
        const newUser = {
          id: Date.now(),
          full_name: capitalize(name),
          username: name.toLowerCase().replace(/\s+/g, ''),
          email: `${name.toLowerCase().replace(/\s+/g, '')}@system.local`,
          phone: 'N/A',
          office: capitalize(office),
          role: 'borrower',
          password: 'password123'
        };
        
        appData.users.push(newUser);
        Storage.save(appData);
        
        // Refresh the select list in the current modal
        const newOption = document.createElement('option');
        newOption.value = newUser.id;
        newOption.textContent = newUser.full_name;
        newOption.selected = true;
        borrowerSelect.appendChild(newOption);
        officeInput.value = newUser.office;
        
        showToast(`Borrower "${newUser.full_name}" added and selected!`, 'success');
      };
      borrowerSelect.onchange = (e) => {
        const userId = parseInt(e.target.value);
        const user = appData.users.find(u => u.id === userId);
        if (user) officeInput.value = user.office || '';
      };

      document.getElementById('borrow-form').onsubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const userId = parseInt(formData.get('user_id'));
        const office = capitalize(formData.get('office'));
        const category = formData.get('borrower_category');
        const purpose = capitalize(formData.get('purpose'));
        const dueDate = formData.get('due_date');
        
        const selections = [
          { id: parseInt(formData.get('item_id_1')), qty: parseInt(formData.get('qty_1') || 1) },
          { id: parseInt(formData.get('item_id_2')), qty: parseInt(formData.get('qty_2') || 0) },
          { id: parseInt(formData.get('item_id_3')), qty: parseInt(formData.get('qty_3') || 0) },
          { id: parseInt(formData.get('item_id_4')), qty: parseInt(formData.get('qty_4') || 0) }
        ].filter(s => s.id && s.qty > 0);

        // Check for duplicate items
        const itemIds = selections.map(s => s.id);
        if (new Set(itemIds).size !== itemIds.length) {
          showToast("Duplicate items selected. Please adjust quantities instead.", "warning");
          return;
        }

        const user = appData.users.find(u => u.id === userId);
        const batchId = Date.now();
        const borrowDate = new Date().toISOString().split('T')[0];
        let logItems = [];

        // Validation pass
        for (const sel of selections) {
          const item = appData.items.find(i => i.id === sel.id);
          if (item.available_qty < sel.qty) {
            showToast(`Not enough stock for ${item.name}.`, 'danger');
            return;
          }
        }

        // Creation pass
        selections.forEach((sel, index) => {
          const item = appData.items.find(i => i.id === sel.id);
          const record = {
            id: Date.now() + index,
            batch_id: batchId,
            user_id: userId,
            user_name: user.full_name,
            user_phone: user.phone || 'N/A',
            borrower_category: category,
            office: office,
            purpose: purpose,
            item_id: sel.id,
            item_name: item.name,
            qty: sel.qty,
            borrow_date: borrowDate,
            due_date: dueDate,
            status: 'borrowed'
          };
          item.available_qty -= sel.qty;
          appData.records.push(record);
          logItems.push(`<b>${sel.qty}x ${item.name}</b>`);
        });

        // Log activity
        appData.activity.unshift({
          id: Date.now(),
          text: `<b>${user.full_name}</b> borrowed ${logItems.join(' and ')}`,
          time: 'Just now'
        });

        Storage.save(appData);
        hideModal();
        renderTransactions();
        renderActivityFeed();
      };
    };
  }
};

const renderSettings = () => {
  const mainView = document.getElementById('main-view');
  mainView.innerHTML = `
    <header style="margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">System Settings</h1>
      <p style="color: var(--text-muted);">Manage global slip signatures and system variables.</p>
    </header>

    <div class="card" style="max-width: 600px;">
      <form id="settings-form">
        <h3 style="margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; color: var(--primary);">Print Receipt Signatures</h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
          <div class="form-group">
            <label class="form-label">Approved By (Name)</label>
            <input type="text" class="form-input" name="approved_by" value="${appData.settings.approved_by || ''}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Approved By (Contact)</label>
            <input type="text" class="form-input" name="approved_by_contact" value="${appData.settings.approved_by_contact || ''}" required />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
          <div class="form-group">
            <label class="form-label">Issued By (Name)</label>
            <input type="text" class="form-input" name="issued_by" value="${appData.settings.issued_by || ''}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Issued By (Contact)</label>
            <input type="text" class="form-input" name="issued_by_contact" value="${appData.settings.issued_by_contact || ''}" required />
          </div>
        </div>

        <h3 style="margin-bottom: 1.5rem; margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; color: var(--primary);">Other Settings</h3>
        <div class="form-group">
          <label class="form-label">Penalty Rate (Per Day)</label>
          <input type="number" class="form-input" name="rate_per_day" value="${appData.settings.rate_per_day || 0}" step="0.01" required />
        </div>

        <div style="margin-top: 2rem;">
          <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 1rem;">Save All Settings</button>
        </div>
      </form>
    </div>

    <div class="card" style="max-width: 600px; margin-top: 2rem; background: var(--primary-soft); text-align: center;">
      <h3 style="margin-bottom: 1rem; color: var(--primary-dark);">Borrower Request Portal</h3>
      <p style="margin-bottom: 2rem; color: var(--text-muted); font-size: 0.9rem;">Share this QR code or link with borrowers so they can submit requests digitally.</p>
      
      <div style="background: white; padding: 1rem; display: inline-block; border-radius: 12px; margin-bottom: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <img id="borrower-qr" src="" alt="QR Code" style="width: 150px; height: 150px; display: block;">
      </div>
      
      <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: white; padding: 0.75rem 1rem; border-radius: 10px; border: 1px solid var(--border);">
        <code id="borrower-url" style="font-size: 0.8rem; color: var(--primary-dark); word-break: break-all;"></code>
        <button class="btn btn-soft" id="copy-url-btn" style="padding: 0.4rem 0.8rem; font-size: 0.7rem; white-space: nowrap;">Copy Link</button>
      </div>
    </div>
  `;

  // Set URL and QR
  try {
    const urlObj = new URL('borrower.html', window.location.href);
    const borrowerUrl = urlObj.href;
    
    const qrImg = document.getElementById('borrower-qr');
    const urlCode = document.getElementById('borrower-url');
    
    if (qrImg && urlCode) {
      urlCode.innerText = borrowerUrl;
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(borrowerUrl)}`;
      
      // Add a note if running on localhost/file
      if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const note = document.createElement('p');
        note.style.fontSize = '0.7rem';
        note.style.color = 'var(--danger)';
        note.style.marginTop = '1rem';
        note.innerText = 'Note: QR Code points to your local computer. For borrowers to use this on their phones, the system must be hosted online (e.g. GitHub Pages).';
        qrImg.parentElement.parentElement.appendChild(note);
      }
    }

    document.getElementById('copy-url-btn').onclick = () => {
      navigator.clipboard.writeText(borrowerUrl);
      showToast('URL Copied!', 'success');
    };
  } catch (err) {
    console.error("QR Error:", err);
  }

  document.getElementById('settings-form').onsubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    appData.settings.approved_by = formData.get('approved_by');
    appData.settings.approved_by_contact = formData.get('approved_by_contact');
    appData.settings.issued_by = formData.get('issued_by');
    appData.settings.issued_by_contact = formData.get('issued_by_contact');
    appData.settings.rate_per_day = parseFloat(formData.get('rate_per_day'));

    Storage.save(appData);
    showToast('Settings saved and synced!', 'success');
  };
};

// --- Modal Logic ---
const showModal = (content) => {
  const modalContent = document.getElementById('modal-content');
  const modalOverlay = document.getElementById('modal-overlay');
  modalContent.innerHTML = content;
  modalOverlay.classList.add('active');
};

const hideModal = () => {
  const modalOverlay = document.getElementById('modal-overlay');
  modalOverlay.classList.remove('active');
};

// --- View Switching ---
const renderRequests = () => {
  const mainView = document.getElementById('main-view');
  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 1.75rem; font-weight: 800;">Pending Requests</h1>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Borrower</th>
            <th>Office</th>
            <th>Items</th>
            <th>Purpose</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${(appData.requests || []).filter(req => req.status === 'pending').sort((a,b) => b.id > a.id ? -1 : 1).map(req => {
            let itemsList = req.items || '';
            try {
              const parsed = JSON.parse(req.items);
              if (Array.isArray(parsed)) {
                itemsList = parsed.map(i => `• ${i.name} (${i.qty})`).join('<br>');
              }
            } catch(e) {
              // Already human-readable or plain string
              itemsList = (req.items || '').split(', ').map(i => `• ${i}`).join('<br>');
            }

            return `
              <tr>
                <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDateTimeStr(req.created_at)}</td>
                <td style="font-weight: 600;">${req.full_name}</td>
                <td><span class="badge" style="background: var(--primary-soft); color: var(--primary);">${req.office}</span></td>
                <td style="font-size: 0.85rem;">${itemsList}</td>
                <td>${req.purpose}</td>
                <td>
                  <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-primary approve-request-btn" data-id="${req.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">Approve</button>
                    <button class="btn btn-outline decline-request-btn" data-id="${req.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; color: var(--danger);">Decline</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="6" style="text-align:center;">No pending requests</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Approve Request
  document.querySelectorAll('.approve-request-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const req = appData.requests.find(r => r.id.toString() === id.toString());
      if (!req) return;

      const reqItems = JSON.parse(req.items || '[]');
      const batchId = Date.now();
      
      // Check stock first
      for (const reqI of reqItems) {
        const item = appData.items.find(i => i.id === reqI.id);
        if (!item || item.available_qty < reqI.qty) {
          showToast(`Stock unavailable for ${reqI.name}`, 'danger');
          return;
        }
      }

      // Convert Request to Records
      reqItems.forEach(reqI => {
        const item = appData.items.find(i => i.id === reqI.id);
        const record = {
          id: Date.now() + Math.random(),
          batch_id: batchId,
          user_id: 0, // Guest/Public
          user_name: req.full_name,
          item_id: item.id,
          item_name: item.name,
          qty: reqI.qty,
          office: req.office,
          borrow_date: new Date().toISOString().split('T')[0],
          due_date: req.due_date,
          status: 'borrowed',
          purpose: req.purpose,
          user_phone: ''
        };
        item.available_qty -= reqI.qty;
        appData.records.push(record);
      });

      // Update Request status
      req.status = 'approved';
      
      // Log
      appData.activity.unshift({
        id: Date.now(),
        text: `<b>${req.full_name}</b> request approved for ${reqItems.length} items`,
        time: 'Just now'
      });

      Storage.save(appData);
      renderRequests();
      showToast('Request approved!', 'success');
    };
  });

  // Decline Request
  document.querySelectorAll('.decline-request-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      showConfirm('Are you sure you want to decline this request?', () => {
        const req = appData.requests.find(r => r.id.toString() === id.toString());
        if (req) req.status = 'declined';
        Storage.save(appData);
        renderRequests();
        showToast('Request declined', 'info');
      });
    };
  });
};

const renderReports = () => {
  const mainView = document.getElementById('main-view');
  
  // Calculate Reports Metrics
  const allRecords = appData.records || [];
  const totalCompleted = allRecords.filter(r => r.status === 'returned').length;
  const totalActive = allRecords.filter(r => r.status === 'borrowed').length;
  const totalOverdue = allRecords.filter(r => r.status === 'overdue').length;
  
  // Most borrowed item
  const itemCounts = {};
  const borrowerCounts = {};
  const officeCounts = {};

  allRecords.forEach(r => {
    // Item counts
    itemCounts[r.item_name] = (itemCounts[r.item_name] || 0) + (r.qty || 1);
    
    // Borrower counts (get realtime name from users list if possible)
    const user = appData.users.find(u => u.id === r.user_id);
    const name = user ? user.full_name : (r.user_name || 'Unknown');
    borrowerCounts[name] = (borrowerCounts[name] || 0) + 1;
    
    // Office counts
    const office = user ? (user.office || 'Unknown') : (r.office || 'Unknown');
    officeCounts[office] = (officeCounts[office] || 0) + 1;
  });

  const topItemEntry = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0];
  const topItemName = topItemEntry ? topItemEntry[0] : 'N/A';
  const topItemCount = topItemEntry ? topItemEntry[1] : 0;

  // Filter records by search query
  const filteredRecords = allRecords.filter(r => {
    const user = appData.users.find(u => u.id === r.user_id);
    const name = user ? user.full_name : (r.user_name || '');
    return (r.item_name && r.item_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
           (name.toLowerCase().includes(searchQuery.toLowerCase())) ||
           (r.status && r.status.toLowerCase().includes(searchQuery.toLowerCase()));
  }).sort((a, b) => new Date(b.date_borrowed) - new Date(a.date_borrowed));

  mainView.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
      <h1 style="font-size: 2rem; font-weight: 800;">System Reports</h1>
      <button class="btn btn-primary" onclick="window.print()">
        <span style="font-size: 1.2rem;">🖨️</span> Print Report
      </button>
    </div>



    <!-- Charts Section -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
      <div class="activity-panel">
        <h3 class="section-title">Status Distribution</h3>
        <div style="height: 200px; position: relative;">
          <canvas id="statusChart"></canvas>
        </div>
      </div>
      <div class="activity-panel">
        <h3 class="section-title">Top 5 Items</h3>
        <div style="height: 200px; position: relative;">
          <canvas id="itemsChart"></canvas>
        </div>
      </div>
      <div class="activity-panel">
        <h3 class="section-title">Top 5 Borrowers</h3>
        <div style="height: 200px; position: relative;">
          <canvas id="borrowersChart"></canvas>
        </div>
      </div>
      <div class="activity-panel">
        <h3 class="section-title">Top 5 Offices</h3>
        <div style="height: 200px; position: relative;">
          <canvas id="officesChart"></canvas>
        </div>
      </div>
    </div>

    <div class="section-title">Historical Transactions Log</div>
    <div class="table-container printable-report-table">
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead style="background: var(--background);">
          <tr>
            <th style="padding: 1rem; border-bottom: 2px solid var(--border);">Date</th>
            <th style="padding: 1rem; border-bottom: 2px solid var(--border);">Borrower</th>
            <th style="padding: 1rem; border-bottom: 2px solid var(--border);">Item</th>
            <th style="padding: 1rem; border-bottom: 2px solid var(--border);">Qty</th>
            <th style="padding: 1rem; border-bottom: 2px solid var(--border);">Status</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRecords.map(r => `
            <tr>
              <td style="padding: 1rem; border-bottom: 1px solid var(--border);">${formatDateStr(r.date_borrowed)}</td>
              <td style="padding: 1rem; border-bottom: 1px solid var(--border); font-weight: 500;">${r.borrower_name}</td>
              <td style="padding: 1rem; border-bottom: 1px solid var(--border);">${r.item_name}</td>
              <td style="padding: 1rem; border-bottom: 1px solid var(--border);">${r.qty || 1}</td>
              <td style="padding: 1rem; border-bottom: 1px solid var(--border);">
                <span class="badge badge-${r.status === 'borrowed' ? 'warning' : r.status === 'returned' ? 'success' : 'danger'}">
                  ${r.status}
                </span>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="text-align: center; padding: 1rem;">No records found matching search.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Initialize Charts
  setTimeout(() => {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js not loaded yet');
      return;
    }
    // 1. Status Distribution Chart
    const statusCtx = document.getElementById('statusChart').getContext('2d');
    new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels: ['Returned', 'Borrowed', 'Overdue'],
        datasets: [{
          data: [totalCompleted, totalActive, totalOverdue],
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }
        }
      }
    });

    // 2. Top Items Chart
    const itemsCtx = document.getElementById('itemsChart').getContext('2d');
    const sortedItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    new Chart(itemsCtx, {
      type: 'bar',
      data: {
        labels: sortedItems.map(i => i[0].length > 15 ? i[0].substring(0, 12) + '...' : i[0]),
        datasets: [{
          label: 'Quantity',
          data: sortedItems.map(i => i[1]),
          backgroundColor: '#2e7d32',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { beginAtZero: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });

    // 3. Top Borrowers Chart
    const borrowersCtx = document.getElementById('borrowersChart').getContext('2d');
    const sortedBorrowers = Object.entries(borrowerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    new Chart(borrowersCtx, {
      type: 'bar',
      data: {
        labels: sortedBorrowers.map(b => b[0].length > 12 ? b[0].substring(0, 10) + '...' : b[0]),
        datasets: [{
          label: 'Transactions',
          data: sortedBorrowers.map(b => b[1]),
          backgroundColor: 'rgba(25, 118, 210, 0.6)',
          borderColor: '#1976d2',
          borderWidth: 1,
          barPercentage: 1.0,
          categoryPercentage: 1.0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { font: { size: 9 } } }
        }
      }
    });

    // 4. Top Offices Chart
    const officesCtx = document.getElementById('officesChart').getContext('2d');
    const sortedOffices = Object.entries(officeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    new Chart(officesCtx, {
      type: 'line',
      data: {
        labels: sortedOffices.map(o => o[0].length > 12 ? o[0].substring(0, 10) + '...' : o[0]),
        datasets: [{
          label: 'Transactions',
          data: sortedOffices.map(o => o[1]),
          borderColor: '#9c27b0',
          backgroundColor: 'rgba(156, 39, 176, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#9c27b0',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 9 } } }
        }
      }
    });
  }, 100);
};

const switchView = (view) => {
  currentView = view;
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const mainView = document.getElementById('main-view');

  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'inventory': renderInventory(); break;
    case 'borrowers': renderBorrowers(); break;
    case 'system-users': renderSystemUsers(); break;
    case 'transactions': renderTransactions(); break;
    case 'requests': renderRequests(); break;
    case 'reports': renderReports(); break;
    case 'settings': renderSettings(); break;
    default: mainView.innerHTML = `<h1>View ${view} coming soon...</h1>`;
  }
  
  // Always refresh the activity feed when switching views
  renderActivityFeed();
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // Data Integrity Fix: Ensure available_qty never exceeds total_qty
  appData.items.forEach(item => {
    if (item.available_qty > item.total_qty) {
      item.available_qty = item.total_qty;
    }
    // Also ensure no negative availability
    if (item.available_qty < 0) item.available_qty = 0;
  });
  
  // Try to restore from cloud on startup
  Storage.loadFromCloud();

  // Real-time Auto-refresh (Every 5 seconds)
  setInterval(() => {
    Storage.loadFromCloud(true);
  }, 5000);

  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const modalOverlay = document.getElementById('modal-overlay');

  navItems.forEach(item => {
    item.onclick = () => switchView(item.dataset.view);
  });
  
  // Set username in Top Bar
  const usernameDisplay = document.getElementById('nav-username');
  if (usernameDisplay) {
    usernameDisplay.textContent = sessionStorage.getItem('borrowSys_user') || 'Admin';
  }

  // Global Search Logic
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      // Re-render current view if it's a searchable list view
      if (['inventory', 'borrowers', 'system-users', 'transactions'].includes(currentView)) {
        switchView(currentView);
      }
    });
  }

  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) hideModal();
  };

  const globalAddBtn = document.getElementById('global-add-btn');
  if (globalAddBtn) {
    globalAddBtn.onclick = () => switchView('inventory');
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      sessionStorage.removeItem('borrowSys_loggedIn');
      sessionStorage.removeItem('borrowSys_user');
      window.location.href = 'login.html';
    };
  }

  // Initial load
  switchView('dashboard');

  // Remove redundant sync block (already handled in DOMContentLoaded)
  
  // Global Click Handlers
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('print-btn')) {
      const id = parseInt(e.target.dataset.id);
      const clickedRecord = appData.records.find(r => r.id === id);
      if (clickedRecord) {
        // Find all records in the same batch (if any)
        const batchRecords = clickedRecord.batch_id 
          ? appData.records.filter(r => r.batch_id === clickedRecord.batch_id) 
          : [clickedRecord];
          
        const user = appData.users.find(u => u.id === clickedRecord.user_id);
        const borrowerName = user ? user.full_name : (clickedRecord.user_name || 'Unknown');
        const office = user ? (user.office || 'N/A') : (clickedRecord.office || 'N/A');
        const headerUrl = new URL('print_header.png', window.location.href).href;
        const printWindow = window.open('', '_blank', 'width=700,height=900');
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
              <title>BORROWER'S SLIP</title>
              <style>
                  body { font-family: 'Times New Roman', serif; padding: 20px; color: #000; margin: 0; line-height: 1.4; font-size: 11pt; }
                  .print-header { text-align: center; margin-bottom: 5px; padding-bottom: 10px; }
                  .print-header img { max-width: 100%; height: auto; }
                  
                  .series-no { text-align: right; margin: 10px 0; font-weight: bold; font-family: sans-serif; font-size: 10pt; }
                  .doc-title { text-align: center; font-size: 14pt; font-weight: bold; margin-bottom: 20px; font-family: sans-serif; letter-spacing: 1px; }
                  
                  .checkbox-group { margin-bottom: 15px; font-family: sans-serif; font-size: 10pt; }
                  .checkbox-item { display: flex; align-items: center; margin-bottom: 5px; }
                  .checkbox-box { width: 12px; height: 12px; border: 1px solid #000; margin-right: 8px; }
                  .checkbox-box.checked { position: relative; background: #eee; }
                  .checkbox-box.checked::after { content: '✓'; position: absolute; top: -6px; left: 1px; font-size: 14px; font-weight: bold; }
                  
                  .acknowledgment { font-style: italic; margin-bottom: 15px; font-family: serif; }
                  
                  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
                  .items-table th, .items-table td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 9pt; word-wrap: break-word; }
                  .items-table th { font-weight: bold; height: 35px; background: #f9f9f9; }
                  .items-table td { height: 22px; }
                  
                  .terms { margin-bottom: 20px; font-family: sans-serif; font-size: 10pt; }
                  .terms-title { font-weight: bold; margin-bottom: 5px; text-decoration: none; }
                  .terms ol { padding-left: 25px; margin: 0; }
                  .terms li { margin-bottom: 4px; }
                  
                  .signature-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                  .signature-table th, .signature-table td { border: 1px solid #000; padding: 4px; text-align: left; font-size: 9pt; height: 22px; }
                  .signature-table th { width: 15%; background: #f9f9f9; }
                  .signature-table .col { width: 28.33%; text-align: center; font-weight: bold; background: #f0f0f0; }
                  
                  @media print {
                      body { padding: 0; }
                      .no-print { display: none; }
                  }
              </style>
          </head>
          <body>
              <div class="print-header">
                  <img src="${headerUrl}" alt="Header" />
              </div>
              
              <div class="series-no">Series No: ______________</div>
              
              <div class="doc-title">BORROWER'S SLIP</div>
              
              <div class="checkbox-group">
                  <div class="checkbox-item"><div class="checkbox-box ${clickedRecord.borrower_category === 'Employee' ? 'checked' : ''}"></div> Employee</div>
                  <div class="checkbox-item"><div class="checkbox-box ${clickedRecord.borrower_category === 'Staff' ? 'checked' : ''}"></div> Staff</div>
                  <div class="checkbox-item"><div class="checkbox-box ${clickedRecord.borrower_category === 'Others' || !clickedRecord.borrower_category ? 'checked' : ''}"></div> Others (Office/Agency): ${office}</div>
              </div>
              
              <div class="acknowledgment">
                  I acknowledge to have receive from the <b>General Services Office</b> of the Provincial Government of Apayao the following:
              </div>
              
              <table class="items-table">
                  <thead>
                      <tr>
                          <th style="width: 6%;">Qty</th>
                          <th style="width: 20%;">Item Description</th>
                          <th style="width: 14%;">Time/Date (Release)</th>
                          <th style="width: 14%;">Time/Date (Expected date of Return)</th>
                          <th style="width: 12%;">Time/Date (Returned)</th>
                          <th style="width: 17%;">Signature (Over Printed Name)</th>
                          <th style="width: 17%;">Purpose</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${batchRecords.map(r => `
                        <tr>
                            <td style="font-weight: bold;">${r.qty || 1}</td>
                            <td style="text-align: left; padding-left: 5px;">${r.item_name}</td>
                            <td>${formatDateStr(r.borrow_date)}</td>
                            <td>${formatDateStr(r.due_date)}</td>
                            <td>${r.return_date ? formatDateStr(r.return_date) : ''}</td>
                            <td></td>
                            <td style="text-align: left; padding-left: 5px;">${r.purpose || 'N/A'}</td>
                        </tr>
                      `).join('')}
                  </tbody>
              </table>
              
              <div class="terms">
                  <div class="terms-title">TERMS and CONDITIONS:</div>
                  <div style="font-style: italic; margin-bottom: 5px;">That I/We shall:</div>
                  <ol>
                      <li>personally return <b>IMMEDIATELY</b> after use the borrowed item/equipment listed above to make it available for other users;</li>
                      <li>be held accountable for <b>LOSS & DAMAGES</b> while the item is in my/our custody;</li>
                      <li><b>REPLACE</b> lost or damaged item/equipment;</li>
                      <li>Ensure that the item/property is clean and in good condition upon its return; and</li>
                      <li>Pay for the lost items equivalent to the purchase price in case of non-replacement of borrowed items.</li>
                  </ol>
              </div>
              
              <table class="signature-table">
                  <tr>
                      <th></th>
                      <td class="col">Borrowed by:</td>
                      <td class="col">Approved by:</td>
                      <td class="col">Issued by:</td>
                  </tr>
                  <tr>
                      <th>Signature:</th>
                      <td></td>
                      <td></td>
                      <td></td>
                  </tr>
                  <tr>
                      <th>Name:</th>
                      <td>${borrowerName}</td>
                      <td>${appData.settings.approved_by || 'MARY JEAN DOMINGO'}</td>
                      <td>${appData.settings.issued_by || 'ROYCE'}</td>
                  </tr>
                  <tr>
                      <th>Office/Agency:</th>
                      <td>${office}</td>
                      <td>General Services Office</td>
                      <td>General Services Office</td>
                  </tr>
                  <tr>
                      <th>Contact No:</th>
                      <td>${user && user.phone ? user.phone : (clickedRecord.user_phone || 'N/A')}</td>
                      <td>${appData.settings.approved_by_contact || '09354163623'}</td>
                      <td>${appData.settings.issued_by_contact || '09123456789'}</td>
                  </tr>
              </table>
              
              <div style="margin-top: 15px; font-size: 8pt; color: #666; text-align: center;">
                  Printed on: ${new Date().toLocaleString()}
              </div>

              <script>
                  const img = document.querySelector('.print-header img');
                  if (img.complete) {
                      window.print();
                  } else {
                      img.onload = () => { window.print(); };
                      img.onerror = () => { window.print(); };
                  }
              </script>
          </body>
          </html>
        `);
        printWindow.document.close();
      }
    }
  });

  // Real-time activity feed update every 5 seconds
  setInterval(renderActivityFeed, 5000);

  // --- Real-time Overdue Checker ---
  const checkOverdueItems = () => {
    const today = new Date().toISOString().split('T')[0];
    let changed = false;

    appData.records.forEach(record => {
      if (record.status === 'borrowed' && record.due_date < today) {
        record.status = 'overdue';
        changed = true;

        // Log activity (only once per record)
        if (!record._overdue_logged) {
          record._overdue_logged = true;
          const user = appData.users.find(u => u.id === record.user_id);
          const name = user ? user.full_name : (record.user_name || 'Unknown');
          appData.activity.unshift({
            id: Date.now() + Math.random(),
            text: `<b>${name}</b>'s borrow of <b>${record.item_name}</b> is now <b style="color:var(--danger);">OVERDUE</b>`,
            time: 'Auto-detected'
          });
        }
      }
    });

    if (changed) {
      Storage.save(appData);
      switchView(currentView);
    }
  };

  // Run immediately on load, then every 5 seconds
  checkOverdueItems();
  setInterval(checkOverdueItems, 5000);

  console.log('Borrowing System Loaded', appData);
});
