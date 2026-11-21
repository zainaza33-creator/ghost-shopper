// ============================================================
//  ORDERS.JS - Orders management module (revamped)
//  Filters: Live / Test / All. Hides delivery fee.
//  Shows store earnings (subtotal + packaging). Status flow
//  matches the customer app.
// ============================================================

import {
  db,
  collection, query, where, orderBy, getDocs, onSnapshot, doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, writeBatch, getFunctions, httpsCallable
} from '../../js/firebase-config.js';
import { showToast, showLoading, formatMoney, formatDate, formatDateTime, getStatusBadge, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let ordersUnsubscribe = null;
let archivedUnsubscribe = null;
let showArchived = false;

// Filter state: 'live' (default), 'test', 'all'
let orderMode = 'live';

window.loadOrders = loadOrders;
window.viewOrder = viewOrder;
window.updateOrderStatus = updateOrderStatus;
window.assignDriver = assignDriver;
window.refundOrder = refundOrder;
window.setOrderMode = setOrderMode;

// ============================================================
//  LOAD ORDERS
// ============================================================
export function loadOrders() {
  showLoading('Loading orders...');

  if (ordersUnsubscribe) { try { ordersUnsubscribe(); } catch (_) {} ordersUnsubscribe = null; }
  if (archivedUnsubscribe) { try { archivedUnsubscribe(); } catch (_) {} archivedUnsubscribe = null; }

  const ordersRef = collection(db, 'orders');
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  ordersUnsubscribe = onSnapshot(q, (snapshot) => {
    renderOrdersList(snapshot, 'Orders');
  }, (error) => {
    console.error('Error loading orders:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading orders.</p>`;
  });

  if (showArchived) {
    const archivedRef = collection(db, 'archivedOrders');
    const archivedQ = query(archivedRef, orderBy('archivedAt', 'desc'));
    archivedUnsubscribe = onSnapshot(archivedQ, (snapshot) => {
      renderOrdersList(snapshot, 'Archived Orders', true);
    }, (error) => {
      console.error('Error loading archived orders:', error);
    });
  }
}

function setOrderMode(mode) {
  if (!['live', 'test', 'all'].includes(mode)) return;
  orderMode = mode;
  loadOrders();
}

function renderOrdersList(snapshot, title, isArchived = false) {
  // Build a fresh container each time so filters + snapshots don't clash
  let container = document.getElementById('ordersContainer');
  if (!container) {
    adminContent.innerHTML = `<div id="ordersContainer"></div>`;
    container = document.getElementById('ordersContainer');
  }

  if (snapshot.empty) {
    container.innerHTML = `
      <div style="text-align:center;padding:1rem;color:var(--text-secondary);">
        <p>No ${title.toLowerCase()} found.</p>
      </div>
    `;
    return;
  }

  // Collect all orders first
  const allOrders = [];
  snapshot.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));

  // Classify as test if EITHER:
  //  - testMode: true (new orders written by the customer checkout)
  //  - paymentStatus: 'test_mode' (legacy orders paid while test mode was on)
  const isTestOrder = (o) => o.testMode === true || o.paymentStatus === 'test_mode';

  const liveOrders = allOrders.filter(o => !isTestOrder(o));
  const testOrders = allOrders.filter(o => isTestOrder(o));

  // Apply mode filter
  let visibleOrders;
  if (orderMode === 'live') visibleOrders = liveOrders;
  else if (orderMode === 'test') visibleOrders = testOrders;
  else visibleOrders = allOrders;

  // Apply archived-vs-live source
  const isArchivedSource = isArchived;

  // Get functions for later actions
  const functions = getFunctions();
  const archiveFn = httpsCallable(functions, 'archiveOrders');

  // Build header
  let html = `
    <div class="orders-header">
      <h3>${title} <span style="font-weight:500;color:var(--text-secondary);font-size:0.9rem;">(${visibleOrders.length})</span></h3>

      <div class="orders-toolbar">
        <div class="orders-mode-toggle" role="tablist" aria-label="Order mode">
          <button class="order-mode-btn ${orderMode === 'live' ? 'active' : ''}" data-mode="live" type="button">
            Live <span class="order-mode-count">${liveOrders.length}</span>
          </button>
          <button class="order-mode-btn ${orderMode === 'test' ? 'active' : ''}" data-mode="test" type="button">
            Test <span class="order-mode-count">${testOrders.length}</span>
          </button>
          <button class="order-mode-btn ${orderMode === 'all' ? 'active' : ''}" data-mode="all" type="button">
            All <span class="order-mode-count">${allOrders.length}</span>
          </button>
        </div>

        <select id="orderStatusFilter" class="sort-select">
          <option value="all">All Statuses</option>
          <option value="pending_payment">Pending Payment</option>
          <option value="confirmed">Confirmed</option>
          <option value="packing">Packing</option>
          <option value="packed">Packed</option>
          <option value="ready">Ready</option>
          <option value="assigned">Assigned</option>
          <option value="collected">Collected</option>
          <option value="on_the_way">On the Way</option>
          <option value="delivered">Delivered</option>
          <option value="refunded">Refunded</option>
        </select>

        ${!isArchivedSource ? `
          <button class="btn-primary" id="archiveSelectedBtn" style="font-size:0.8rem;padding:0.3rem 0.8rem;">
            <i class="fas fa-archive"></i> Archive Selected
          </button>
          <button class="btn-secondary" id="toggleArchivedBtn" style="font-size:0.8rem;padding:0.3rem 0.8rem;">
            <i class="fas fa-history"></i> ${showArchived ? 'Hide' : 'Show'} Archived
          </button>
        ` : ''}
      </div>
    </div>

    <div class="table-container">
      <table>
         <thead>
          <tr>
            <th>${!isArchivedSource ? '<input type="checkbox" id="selectAllOrders" />' : ''}</th>
            <th>Order #</th>
            <th>Customer</th>
            <th>Store</th>
            <th>Store earnings</th>
            <th>Status</th>
            <th>Driver</th>
            <th>Delivered</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Apply status filter
  const statusFilterEl = document.getElementById('orderStatusFilter');
  const statusFilter = statusFilterEl?.value || 'all';

  let hasVisible = false;

  visibleOrders.forEach(order => {
    const status = order.orderStatus || 'pending';
    if (statusFilter !== 'all' && status !== statusFilter) return;
    hasVisible = true;

    const isTest = order.testMode === true || order.paymentStatus === 'test_mode';
    const earnings = Number(order.subtotal || 0) + Number(order.packagingFee || 0);
    const statusHtml = getStatusBadge(status);

    html += `
      <tr class="${isTest ? 'order-row-test' : ''}">
        <td>${!isArchivedSource ? `<input type="checkbox" class="order-select" value="${order.id}" />` : ''}</td>
        <td>
          <strong>#${order.id.slice(-6).toUpperCase()}</strong>
          ${isTest ? '<span class="test-badge">TEST</span>' : ''}
        </td>
        <td>${escapeHtml(order.customerName || order.customerPhone || 'N/A')}</td>
        <td>${escapeHtml(order.store || 'N/A')}</td>
        <td><strong>${formatMoney(earnings)}</strong></td>
        <td>${statusHtml}</td>
        <td>${escapeHtml(order.driverName || 'Unassigned')}</td>
        <td style="font-size:0.75rem;color:var(--text-secondary);white-space:nowrap;">
          ${renderDeliveredAt(order)}
        </td>
        <td>
          <button class="btn-sm btn-view" onclick="viewOrder('${order.id}')"><i class="fas fa-eye"></i></button>
          ${!isArchivedSource ? `
            ${(!order.driverId && (status === 'packed' || status === 'ready' || status === 'confirmed' || status === 'packing' || status === 'assigned')) ? `<button class="btn-sm btn-approve assign-btn" data-orderid="${order.id}" style="background:#17a2b8;color:#fff;">Assign</button>` : ''}
            ${(status !== 'refunded' && status !== 'delivered') ? `<button class="btn-sm btn-refund" onclick="refundOrder('${order.id}')"><i class="fas fa-undo"></i></button>` : ''}
          ` : ''}
        </td>
      </tr>
    `;
  });

  if (!hasVisible) {
      html += `<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--text-secondary);">No ${title.toLowerCase()} with this status.</td></tr>`;
  }
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Wire mode toggle
  container.querySelectorAll('.order-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setOrderMode(btn.dataset.mode);
    });
  });

  // Wire status filter
  container.querySelector('#orderStatusFilter')?.addEventListener('change', () => {
    renderOrdersList(snapshot, title, isArchived);
  });

  // Wire select-all
  container.querySelector('#selectAllOrders')?.addEventListener('change', function () {
    container.querySelectorAll('.order-select').forEach(cb => cb.checked = this.checked);
  });

  // Wire archive
  container.querySelector('#archiveSelectedBtn')?.addEventListener('click', async () => {
    const selected = container.querySelectorAll('.order-select:checked');
    if (selected.length === 0) {
      showToast('Please select orders to archive.');
      return;
    }
    if (!confirm(`Archive ${selected.length} order(s)?`)) return;

    const orderIds = Array.from(selected).map(cb => cb.value);
    try {
      const result = await archiveFn({ orderIds });
      if (result.data.success) {
        showToast(`✅ ${result.data.count} orders archived.`);
        loadOrders();
      }
    } catch (error) {
      console.error('Archive error:', error);
      showToast('❌ Failed to archive orders.');
    }
  });

  // Toggle archived
  container.querySelector('#toggleArchivedBtn')?.addEventListener('click', () => {
    showArchived = !showArchived;
    loadOrders();
  });

  // Assign driver buttons
  container.querySelectorAll('.assign-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const orderId = this.dataset.orderid;
      assignDriver(orderId);
    });
  });
}

// ============================================================
//  VIEW ORDER
// ============================================================
export async function viewOrder(orderId) {
  try {
    const docRef = doc(db, 'orders', orderId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Order not found.');
      return;
    }
    const order = docSnap.data();
    const isTest = order.testMode === true || order.paymentStatus === 'test_mode';

    const itemsHtml = order.items ? order.items.map(item => `
      <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
        <span>${escapeHtml(item.name || '')} × ${item.quantity} ${item.alternateAccepted ? '🔄' : ''}</span>
        <span>${formatMoney(item.price * item.quantity)}</span>
      </div>
    `).join('') : '<p>No items</p>';

    const subtotal = Number(order.subtotal || 0);
    const packagingFee = Number(order.packagingFee || 0);
    const deliveryFee = Number(order.deliveryFee || 0);
    const total = Number(order.total || 0);
    const storeEarnings = subtotal + packagingFee;

    const modal = openModal(`
      <div class="modal-content" style="max-width:650px;">
        <div class="modal-header">
          <h3>
            Order #${orderId.slice(-6).toUpperCase()}
            ${isTest ? '<span class="test-badge">TEST</span>' : ''}
          </h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
            <div><strong>Customer:</strong> ${escapeHtml(order.customerName || order.customerPhone || 'N/A')}</div>
            <div><strong>Phone:</strong> ${escapeHtml(order.customerPhone || 'N/A')}</div>
            <div><strong>Store:</strong> ${escapeHtml(order.store || 'N/A')}</div>
            <div><strong>Address:</strong> ${escapeHtml(order.deliveryAddress?.street || order.deliveryAddress || 'N/A')}</div>
            <div><strong>Time Slot:</strong> ${escapeHtml(order.timeSlot?.display || order.timeSlot || 'N/A')}</div>
            <div><strong>Status:</strong> ${getStatusBadge(order.orderStatus || 'pending')}</div>
            <div><strong>Payment:</strong> ${(order.paymentStatus || 'pending').toUpperCase()}</div>
            ${order.orderStatus === 'delivered' ? `<div><strong>Delivered:</strong> ${renderDeliveredAt(order)}</div>` : ''}
            <div><strong>Driver:</strong> ${escapeHtml(order.driverName || 'Unassigned')}</div>
            ${order.driverPhone ? `<div><strong>Driver Phone:</strong> ${escapeHtml(order.driverPhone)}</div>` : ''}
          </div>
          ${isTest ? `<div style="background:#FFF7ED;padding:0.3rem 0.8rem;border-radius:8px;margin-bottom:0.5rem;font-size:0.8rem;color:var(--orange);"><i class="fas fa-vial"></i> Test Mode Order</div>` : ''}

          <hr>
          <h4>Items</h4>
          ${itemsHtml}

          <hr>
          <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:1rem;">
            <span>Store earnings</span>
            <span style="color:var(--green);">${formatMoney(storeEarnings)}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);text-align:right;margin-top:4px;">
            Subtotal ${formatMoney(subtotal)} + Packaging ${formatMoney(packagingFee)}
          </div>

          ${!isTest && deliveryFee > 0 ? `
            <div style="margin-top:12px;padding-top:8px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-secondary);">
              <span>Delivery fee (customer pays)</span>
              <span>${formatMoney(deliveryFee)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:4px;font-size:0.88rem;">
              <span>Customer total</span>
              <span>${formatMoney(total)}</span>
            </div>
          ` : ''}

          ${order.refundAmount ? `<div style="color:var(--red);margin-top:8px;"><strong>Refunded:</strong> ${formatMoney(order.refundAmount)}</div>` : ''}
          ${order.notes ? `<p style="margin-top:0.5rem;"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Close</button>
          ${(order.orderStatus !== 'refunded' && order.orderStatus !== 'delivered') ? `
            <button class="btn-save" onclick="closeModal(this.closest('.admin-modal')); updateOrderStatus('${orderId}');">
              <i class="fas fa-pen"></i> Edit status
            </button>
          ` : ''}
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error viewing order:', error);
    showToast('Error loading order details.');
  }
}

// ============================================================
//  UPDATE ORDER STATUS
// ============================================================
export function updateOrderStatus(orderId) {
  const statuses = [
    'confirmed', 'packing', 'packed', 'ready',
    'assigned', 'collected', 'on_the_way', 'delivered', 'refunded'
  ];

  const modal = openModal(`
    <div class="modal-content">
      <div class="modal-header">
        <h3>Update Order Status</h3>
        <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>New Status</label>
          <select id="statusSelect">
            ${statuses.map(s => `<option value="${s}">${s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Assign Driver (optional)</label>
          <select id="driverSelect">
            <option value="">None</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes (optional)</label>
          <textarea id="statusNotes" rows="2" placeholder="Add notes about this status update..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Cancel</button>
        <button class="btn-save" id="saveStatusBtn">Update</button>
      </div>
    </div>
  `);

  loadDriversForSelect();

  modal.querySelector('#saveStatusBtn').addEventListener('click', async () => {
    const status = modal.querySelector('#statusSelect').value;
    const driverId = modal.querySelector('#driverSelect').value;
    const notes = modal.querySelector('#statusNotes').value;

    try {
      const updates = { orderStatus: status, updatedAt: serverTimestamp(), notes: notes || '' };

      if (driverId) {
        const driverDoc = await getDoc(doc(db, 'drivers', driverId));
        if (driverDoc.exists()) {
          const driver = driverDoc.data();
          updates.driverId = driverId;
          updates.driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone;
          updates.driverPhone = driver.phone || '';
          // If a driver was assigned but no explicit status chosen, move to assigned
          if (status === 'confirmed' || status === 'packing' || status === 'packed' || status === 'ready') {
            updates.orderStatus = 'assigned';
          }
        }
      }

      await updateDoc(doc(db, 'orders', orderId), updates);
      showToast('✅ Order status updated.');
      closeModal(modal);
      loadOrders();
    } catch (error) {
      console.error('Error updating order:', error);
      showToast('❌ Failed to update order status.');
    }
  });
}

// ============================================================
//  ASSIGN DRIVER
// ============================================================
export function assignDriver(orderId) {
  const modal = openModal(`
    <div class="modal-content">
      <div class="modal-header">
        <h3>Assign Driver to Order #${orderId.slice(-6).toUpperCase()}</h3>
        <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Select Driver</label>
          <select id="driverSelectAssign">
            <option value="">Loading drivers...</option>
          </select>
        </div>
        <div class="form-group">
          <label>Notes (optional)</label>
          <textarea id="assignNotes" rows="2" placeholder="Add notes for the driver..."></textarea>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;">
          <i class="fas fa-info-circle"></i> Order will be marked <strong>Assigned</strong> and the driver will be notified.
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Cancel</button>
        <button class="btn-save" id="assignDriverBtn">Assign Driver</button>
      </div>
    </div>
  `);

  loadDriversForSelectById('driverSelectAssign');

  modal.querySelector('#assignDriverBtn').addEventListener('click', async () => {
    const driverId = modal.querySelector('#driverSelectAssign').value;
    const notes = modal.querySelector('#assignNotes').value;

    if (!driverId) {
      showToast('Please select a driver.');
      return;
    }

    try {
      const driverDoc = await getDoc(doc(db, 'drivers', driverId));
      if (!driverDoc.exists) {
        showToast('Driver not found.');
        return;
      }
      const driver = driverDoc.data();
      const driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      const driverPhone = driver.phone || '';

      await updateDoc(doc(db, 'orders', orderId), {
        driverId: driverId,
        driverName: driverName,
        driverPhone: driverPhone,
        orderStatus: 'assigned',
        notes: notes || '',
        assignedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showToast('✅ Driver assigned.');
      closeModal(modal);
      loadOrders();
    } catch (error) {
      console.error('Error assigning driver:', error);
      showToast('❌ Failed to assign driver.');
    }
  });
}

// ============================================================
//  REFUND ORDER
// ============================================================
export async function refundOrder(orderId) {
  if (!confirm('Are you sure you want to refund this order? This will process a refund via Yoco.')) return;

  try {
    showToast('Processing refund...');
    const orderDoc = await getDoc(doc(db, 'orders', orderId));
    if (!orderDoc.exists()) {
      showToast('Order not found.');
      return;
    }
    const order = orderDoc.data();

    await addDoc(collection(db, 'refundRequests'), {
      orderId: orderId,
      userId: order.customerId || '',
      userName: order.customerName || 'Unknown',
      userPhone: order.customerPhone || '',
      amount: order.total || 0,
      status: 'pending',
      message: `Refund request for order #${orderId.slice(-6).toUpperCase()}`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    showToast('✅ Refund request created.');
    loadOrders();
  } catch (error) {
    console.error('Error creating refund:', error);
    showToast('❌ Failed to create refund request.');
  }
}

// ============================================================
//  RENDER DELIVERED TIMESTAMP
//  Shows the actual delivery date+time for delivered orders.
//  Falls back to updatedAt if deliveredAt isn't set.
// ============================================================
function renderDeliveredAt(order) {
  if (order.orderStatus !== 'delivered') return '—';

  // Prefer deliveredAt, fall back to updatedAt
  const ts = order.deliveredAt || order.updatedAt;
  if (!ts) return '✅ delivered';

  let date;
  if (typeof ts.toDate === 'function') {
    date = ts.toDate();
  } else if (ts._seconds !== undefined) {
    date = new Date(ts._seconds * 1000);
  } else {
    date = new Date(ts);
  }
  if (isNaN(date.getTime())) return '✅ delivered';

  // Show as "16 Sep 14:32" — short, readable
  const day = date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

// ============================================================
//  HELPERS
// ============================================================
async function loadDriversForSelect() {
  try {
    const driversSnap = await getDocs(query(collection(db, 'drivers'), where('approved', '==', true)));
    const select = document.getElementById('driverSelect');
    if (!select) return;
    select.innerHTML = '<option value="">None</option>';
    driversSnap.forEach(doc => {
      const driver = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      const name = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      option.textContent = `${name} (${driver.phone || 'no phone'})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading drivers:', error);
  }
}

async function loadDriversForSelectById(selectId) {
  try {
    const driversSnap = await getDocs(query(collection(db, 'drivers'), where('approved', '==', true)));
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '<option value="">Select Driver</option>';
    driversSnap.forEach(doc => {
      const driver = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      const name = `${driver.firstName || ''} ${driver.lastName || ''}`.trim() || driver.phone || 'Driver';
      option.textContent = `${name} (${driver.phone || 'no phone'})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading drivers:', error);
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}