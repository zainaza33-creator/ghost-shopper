// ============================================================
//  DRIVERS.JS - Driver management module
// ============================================================

import { db, collection, query, where, orderBy, getDocs, onSnapshot, doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, getFunctions, httpsCallable } from '../../js/firebase-config.js';
import { showToast, showLoading, formatMoney, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let driversUnsubscribe = null;

window.loadDrivers = loadDrivers;
window.approveDriver = approveDriver;
window.toggleSuspendDriver = toggleSuspendDriver;
window.deleteDriver = deleteDriver;
window.viewDriver = viewDriver;
window.payDriver = payDriver;
window.editDriverArea = editDriverArea;
window.adjustDriverBalance = adjustDriverBalance;

export function loadDrivers() {
  showLoading('Loading drivers...');
  
  if (driversUnsubscribe) driversUnsubscribe();

  const driversRef = collection(db, 'drivers');
  const q = query(driversRef, orderBy('createdAt', 'desc'));

  driversUnsubscribe = onSnapshot(q, async (snapshot) => {
    if (snapshot.empty) {
      adminContent.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No drivers found.</p>`;
      return;
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>All Drivers</h3>
        <div>
          <select id="driverFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
            <option value="all">All Drivers</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="away">Away</option>
            <option value="suspended">Suspended</option>
            <option value="on_delivery">On Delivery</option>
          </select>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Area</th>
              <th>Status</th>
              <th>Online</th>
              <th>Rating</th>
              <th>Earnings</th>
              <th>Unpaid</th>
              <th>Orders</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    const filterValue = document.getElementById('driverFilter')?.value || 'all';

    for (const doc of snapshot.docs) {
      const driver = doc.data();
      const driverId = doc.id;
      const isApproved = driver.approved || false;
      const isOnline = driver.isOnline || false;
      const isSuspended = driver.suspended || false;
      const rating = driver.rating || 0;
      const reviewCount = driver.reviewCount || 0;
      const ratingDisplay = rating > 0 ? `${rating} ⭐ (${reviewCount})` : 'No reviews';
      const totalEarnings = driver.totalEarnings || 0;
      const paidEarnings = driver.paidEarnings || 0;
      const unpaidEarnings = Math.max(0, totalEarnings - paidEarnings);
      
      // Check if driver is on delivery
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('driverId', '==', driverId),
        where('orderStatus', 'in', ['assigned', 'collected', 'on_the_way'])
      ));
      const activeOrders = ordersSnap.size;
      const onDelivery = activeOrders > 0;

      // Last seen for "away" status
      let onlineDisplay = '🔴 Offline';
      if (isOnline && onDelivery) {
        onlineDisplay = '🟢 On Delivery';
      } else if (isOnline) {
        onlineDisplay = '🟢 Online';
      } else if (driver.lastSeen) {
        const lastSeen = driver.lastSeen.toDate ? driver.lastSeen.toDate() : new Date(driver.lastSeen);
        const diffMins = Math.floor((Date.now() - lastSeen) / 60000);
        if (diffMins > 10) {
          onlineDisplay = '🟡 Away';
        }
      }
      
      if (filterValue === 'approved' && !isApproved) continue;
      if (filterValue === 'pending' && isApproved) continue;
      if (filterValue === 'online' && !isOnline) continue;
      if (filterValue === 'offline' && isOnline) continue;
      if (filterValue === 'away' && onlineDisplay !== '🟡 Away') continue;
      if (filterValue === 'suspended' && !isSuspended) continue;
      if (filterValue === 'on_delivery' && !onDelivery) continue;

      html += `
        <tr>
          <td><img src="${driver.profilePhoto || 'img/placeholder.jpg'}" alt="Driver" style="width:40px;height:40px;object-fit:cover;border-radius:50%;"></td>
          <td><strong>${driver.firstName || ''} ${driver.lastName || ''}</strong></td>
          <td>${driver.phone || 'N/A'}</td>
          <td>
            ${driver.area || 'N/A'}
            <button class="btn-sm btn-edit" onclick="editDriverArea('${driverId}')" style="font-size:0.6rem;padding:0.1rem 0.3rem;">
              <i class="fas fa-pen"></i>
            </button>
          </td>
          <td>${isApproved ? (isSuspended ? '⛔ Suspended' : '✅ Approved') : '⏳ Pending'}</td>
          <td>${onlineDisplay}</td>
          <td>${ratingDisplay}</td>
          <td>${formatMoney(totalEarnings)}</td>
          <td style="color:${unpaidEarnings > 0 ? 'var(--orange)' : 'var(--green)'};">${formatMoney(unpaidEarnings)}</td>
          <td>${activeOrders}</td>
          <td>
            ${!isApproved ? `<button class="btn-sm btn-approve" onclick="approveDriver('${driverId}')">Approve</button>` : ''}
            ${isApproved ? `<button class="btn-sm ${isSuspended ? 'btn-approve' : 'btn-warning'}" onclick="toggleSuspendDriver('${driverId}','${!isSuspended}')">${isSuspended ? 'Unsuspend' : 'Suspend'}</button>` : ''}
            ${isApproved && unpaidEarnings > 0 ? `<button class="btn-sm btn-approve" onclick="payDriver('${driverId}','${unpaidEarnings}')" style="background:#28a745;color:#fff;">Pay</button>` : ''}
            ${isApproved ? `<button class="btn-sm btn-edit" onclick="adjustDriverBalance('${driverId}')" style="background:#6c757d;color:#fff;">Adjust</button>` : ''}
            <button class="btn-sm btn-view" onclick="viewDriver('${driverId}')"><i class="fas fa-eye"></i> Review</button>
            ${isApproved ? `<button class="btn-sm btn-delete" onclick="deleteDriver('${driverId}')"><i class="fas fa-trash"></i></button>` : ''}
          </td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;

    document.getElementById('driverFilter')?.addEventListener('change', loadDrivers);

  }, (error) => {
    console.error('Error loading drivers:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading drivers.</p>`;
  });
}

// ===== APPROVE DRIVER =====
export async function approveDriver(driverId) {
  try {
    await updateDoc(doc(db, 'drivers', driverId), { approved: true, updatedAt: serverTimestamp() });
    showToast('✅ Driver approved successfully!');
    // If modal is open, close it
    document.querySelector('.admin-modal')?.remove();
    loadDrivers();
  } catch (error) {
    console.error('Error approving driver:', error);
    showToast('❌ Failed to approve driver.');
  }
}

// ===== REJECT / REQUEST RESUBMISSION =====
export async function rejectDriverDocuments(driverId) {
  if (!confirm('Are you sure you want to reject these documents? The driver will need to re-upload them.')) return;
  try {
    // We reset the document URLs so the driver's dashboard shows them as empty, forcing re-upload
    await updateDoc(doc(db, 'drivers', driverId), {
      profilePhoto: '',
      vehiclePhoto: '',
      licensePhoto: '',
      idDoc: '',
      idDocBack: '',
      approved: false,
      needsReview: true,
      updatedAt: serverTimestamp()
    });
    showToast('✅ Documents cleared. Driver must re-upload.');
    document.querySelector('.admin-modal')?.remove();
    loadDrivers();
  } catch (error) {
    console.error('Error rejecting driver:', error);
    showToast('❌ Failed to reject documents.');
  }
}
window.rejectDriverDocuments = rejectDriverDocuments;

// ===== TOGGLE SUSPEND DRIVER =====
export async function toggleSuspendDriver(driverId, suspend) {
  if (!confirm(`Are you sure you want to ${suspend ? 'suspend' : 'unsuspend'} this driver?`)) return;
  try {
    await updateDoc(doc(db, 'drivers', driverId), { suspended: suspend, updatedAt: serverTimestamp() });
    showToast(`✅ Driver ${suspend ? 'suspended' : 'unsuspended'} successfully!`);
    loadDrivers();
  } catch (error) {
    console.error('Error toggling suspension:', error);
    showToast('❌ Failed to update driver status.');
  }
}

// ===== DELETE DRIVER =====
export async function deleteDriver(driverId) {
  if (!confirm('Are you sure you want to delete this driver? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'drivers', driverId));
    showToast('✅ Driver deleted successfully!');
    loadDrivers();
  } catch (error) {
    console.error('Error deleting driver:', error);
    showToast('❌ Failed to delete driver.');
  }
}

// ============================================================
//  VIEW DRIVER — The Document Review Center
// ============================================================
export async function viewDriver(driverId) {
  try {
    const docRef = doc(db, 'drivers', driverId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      showToast('Driver not found.');
      return;
    }
    const driver = docSnap.data();

    // Get active order count
    const ordersSnap = await getDocs(query(
      collection(db, 'orders'),
      where('driverId', '==', driverId),
      where('orderStatus', 'in', ['assigned', 'collected', 'on_the_way'])
    ));
    const activeOrders = ordersSnap.size;

    // Helper to render a document tile
    const docTile = (title, url, required = true) => {
      if (url) {
        return `
          <div style="text-align:center;">
            <img src="${url}" alt="${title}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border);" onclick="window.open('${url}','_blank');" />
            <span style="font-size:0.75rem;font-weight:600;color:var(--navy);display:block;margin-top:4px;">${title}</span>
          </div>
        `;
      }
      return `
        <div style="text-align:center;background:#FFF7ED;border:1px dashed var(--orange);border-radius:8px;padding:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:120px;">
          <i class="fas fa-exclamation-triangle" style="color:var(--orange);font-size:1.2rem;margin-bottom:4px;"></i>
          <span style="font-size:0.7rem;font-weight:700;color:var(--orange);">Missing</span>
          <span style="font-size:0.65rem;color:var(--text-secondary);">${title}</span>
        </div>
      `;
    };

    const modal = openModal(`
      <div class="modal-content" style="max-width:600px; max-height:90vh; display:flex; flex-direction:column;">
        <div class="modal-header" style="flex-shrink:0;">
          <h3>Driver Details</h3>
          <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
        </div>
        <div class="modal-body" style="overflow-y:auto; padding:1.5rem;">
          
          <!-- Header -->
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
            ${driver.profilePhoto 
              ? `<img src="${driver.profilePhoto}" alt="Profile" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--border);">`
              : `<div style="width:80px;height:80px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:2rem;"><i class="fas fa-user"></i></div>`
            }
            <div>
              <h3 style="margin:0;font-size:1.2rem;color:var(--navy);">${driver.firstName || ''} ${driver.lastName || ''}</h3>
              <p style="margin:2px 0;font-size:0.85rem;color:var(--text-secondary);"><i class="fas fa-phone"></i> ${driver.phone || 'N/A'}</p>
              <p style="margin:2px 0;font-size:0.85rem;color:var(--text-secondary);"><i class="fas fa-envelope"></i> ${driver.email || 'N/A'}</p>
            </div>
          </div>

          <!-- Document Gallery -->
          <h4 style="font-size:0.9rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;border-bottom:2px solid var(--orange);display:inline-block;padding-bottom:4px;">Document Review</h4>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:1.5rem;">
            ${docTile('ID Front', driver.idDoc, true)}
            ${docTile('ID Back', driver.idDocBack, false)}
            ${docTile('License', driver.licensePhoto, true)}
            ${docTile('Vehicle', driver.vehiclePhoto, true)}
            ${docTile('Profile', driver.profilePhoto, true)}
          </div>

          <!-- Details -->
          <h4 style="font-size:0.9rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;border-bottom:2px solid var(--orange);display:inline-block;padding-bottom:4px;">Personal Details</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;margin-bottom:1.5rem;">
            <div><strong>Status:</strong> ${driver.approved ? (driver.suspended ? '⛔ Suspended' : '✅ Approved') : '⏳ Pending'}</div>
            <div><strong>Online:</strong> ${driver.isOnline ? '🟢 Online' : '🔴 Offline'}</div>
            <div><strong>Vehicle Reg:</strong> ${driver.vehicleReg || 'N/A'}</div>
            <div><strong>License No:</strong> ${driver.licenseNumber || 'N/A'}</div>
            <div><strong>Area:</strong> ${driver.area || 'N/A'}</div>
            <div><strong>Active Orders:</strong> ${activeOrders}</div>
            <div><strong>Rating:</strong> ${driver.rating || 0} ⭐ (${driver.reviewCount || 0})</div>
            <div><strong>Delivery Fee:</strong> ${formatMoney(driver.deliveryFee || 20)}</div>
          </div>

          <!-- Bank Details -->
          <h4 style="font-size:0.9rem;font-weight:800;color:var(--navy);margin-bottom:0.5rem;border-bottom:2px solid var(--orange);display:inline-block;padding-bottom:4px;">Bank & Earnings</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;margin-bottom:1rem;">
            <div><strong>Bank:</strong> ${driver.bankName || 'N/A'}</div>
            <div><strong>Account Holder:</strong> ${driver.bankAccountName || 'N/A'}</div>
            <div><strong>Account Number:</strong> ${driver.bankAccountNumber ? '••••' + driver.bankAccountNumber.slice(-4) : 'N/A'}</div>
            <div><strong>Total Earnings:</strong> ${formatMoney(driver.totalEarnings || 0)}</div>
            <div><strong>Paid:</strong> ${formatMoney(driver.paidEarnings || 0)}</div>
            <div style="color:var(--orange);"><strong>Unpaid:</strong> ${formatMoney(Math.max(0, (driver.totalEarnings || 0) - (driver.paidEarnings || 0)))}</div>
          </div>

        </div>
        
        <!-- Footer Actions -->
        <div class="modal-footer" style="flex-shrink:0; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Close</button>
          
          ${!driver.approved ? `
            <button class="btn-sm btn-reject" onclick="rejectDriverDocuments('${driverId}')" style="background:#dc2626;color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;border:none;cursor:pointer;">
              <i class="fas fa-times"></i> Reject & Request Re-upload
            </button>
            <button class="btn-save" onclick="approveDriver('${driverId}')" style="padding:8px 16px;border-radius:8px;font-weight:600;">
              <i class="fas fa-check"></i> Approve Driver
            </button>
          ` : ''}
        </div>
      </div>
    `);
  } catch (error) {
    console.error('Error viewing driver:', error);
    showToast('Error loading driver details.');
  }
}

// ===== PAY DRIVER =====
export async function payDriver(driverId, amount) {
  if (!confirm(`Pay ${formatMoney(parseFloat(amount))} to this driver?`)) return;
  
  try {
    const functions = getFunctions();
    const payDriverFn = httpsCallable(functions, 'payDriver');
    const result = await payDriverFn({ driverId, amount: parseFloat(amount) });
    if (result.data.success) {
      showToast(`✅ ${formatMoney(amount)} paid to driver!`);
      loadDrivers();
    }
  } catch (error) {
    console.error('Error paying driver:', error);
    showToast('❌ Failed to pay driver.');
  }
}

// ===== EDIT DRIVER AREA =====
export function editDriverArea(driverId) {
  const modal = openModal(`
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h3>Update Driver Area</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Service Area</label>
          <input type="text" id="driverAreaInput" placeholder="e.g. Verulam" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveDriverAreaBtn">Update Area</button>
      </div>
    </div>
  `);

  modal.querySelector('#saveDriverAreaBtn').addEventListener('click', async () => {
    const area = document.getElementById('driverAreaInput').value.trim();
    if (!area) {
      showToast('Please enter an area.');
      return;
    }
    try {
      const functions = getFunctions();
      const updateAreaFn = httpsCallable(functions, 'updateDriverArea');
      const result = await updateAreaFn({ driverId, area });
      if (result.data.success) {
        showToast('✅ Driver area updated!');
        closeModal(modal);
        loadDrivers();
      }
    } catch (error) {
      console.error('Error updating driver area:', error);
      showToast('❌ Failed to update driver area.');
    }
  });
}

// ===== ADJUST DRIVER BALANCE =====
export function adjustDriverBalance(driverId) {
  const modal = openModal(`
    <div class="modal-content" style="max-width:400px;">
      <div class="modal-header">
        <h3>Adjust Driver Balance</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Amount (R)</label>
          <input type="number" id="adjustAmount" placeholder="0.00" step="0.01" />
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="adjustType">
            <option value="add">Add to Earnings (increase unpaid)</option>
            <option value="pay">Mark as Paid (deduct from unpaid)</option>
            <option value="subtract">Subtract from Earnings</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveAdjustBtn">Apply</button>
      </div>
    </div>
  `);

  modal.querySelector('#saveAdjustBtn').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('adjustAmount').value);
    const type = document.getElementById('adjustType').value;
    if (!amount || amount <= 0) {
      showToast('Enter a valid amount.');
      return;
    }

    try {
      const driverRef = doc(db, 'drivers', driverId);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) throw new Error('Driver not found');
      const driver = driverSnap.data();
      let totalEarnings = driver.totalEarnings || 0;
      let paidEarnings = driver.paidEarnings || 0;

      if (type === 'add') {
        totalEarnings += amount;
      } else if (type === 'pay') {
        paidEarnings += amount;
        if (paidEarnings > totalEarnings) paidEarnings = totalEarnings;
      } else if (type === 'subtract') {
        totalEarnings = Math.max(0, totalEarnings - amount);
        if (paidEarnings > totalEarnings) paidEarnings = totalEarnings;
      }

      await updateDoc(driverRef, {
        totalEarnings,
        paidEarnings,
        updatedAt: serverTimestamp()
      });

      showToast(`✅ Driver balance updated!`);
      closeModal(modal);
      loadDrivers();
    } catch (error) {
      console.error('Adjust balance error:', error);
      showToast('❌ Failed to adjust balance.');
    }
  });
}