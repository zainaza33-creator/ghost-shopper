// ============================================================
//  AREAS.JS - Delivery areas module
// ============================================================

import { db, collection, query, orderBy, getDocs, onSnapshot, doc, getDoc, updateDoc, deleteDoc, addDoc, serverTimestamp } from '../../js/firebase-config.js';
import { showToast, showLoading, formatMoney, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let areasUnsubscribe = null;

window.loadAreas = loadAreas;
window.editArea = editArea;
window.deleteArea = deleteArea;
window.openAreaModal = openAreaModal;

export function loadAreas() {
  showLoading('Loading areas...');
  
  if (areasUnsubscribe) areasUnsubscribe();

  const areasRef = collection(db, 'areas');

  areasUnsubscribe = onSnapshot(areasRef, (snapshot) => {
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <h3>Delivery Areas</h3>
        <button class="btn-primary" onclick="openAreaModal()">
          <i class="fas fa-plus"></i> Add Area
        </button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Area Name</th>
              <th>Status</th>
              <th>Delivery Fee</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (snapshot.empty) {
      html += `<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--text-secondary);">No areas defined. Add your first delivery area!</td></tr>`;
    } else {
      snapshot.forEach(doc => {
        const area = doc.data();
        const statusBadge = area.active !== false ? 'status-confirmed' : 'status-pending';
        const statusLabel = area.active !== false ? '✅ Active' : '❌ Inactive';
        html += `
          <tr>
            <td><strong>${area.name || 'N/A'}</strong></td>
            <td><span class="status-badge ${statusBadge}">${statusLabel}</span></td>
            <td>${formatMoney(area.fee || 35)}</td>
            <td>
              <button class="btn-sm btn-edit" onclick="editArea('${doc.id}')"><i class="fas fa-pen"></i></button>
              <button class="btn-sm btn-delete" onclick="deleteArea('${doc.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;
  }, (error) => {
    console.error('Error loading areas:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading areas.</p>`;
  });
}

// ===== AREA MODAL =====
export function openAreaModal(areaData = null) {
  const isEdit = !!areaData;
  const modal = openModal(`
    <div class="modal-content" style="max-width:500px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit' : 'Add'} Delivery Area</h3>
        <button class="modal-close" onclick="this.closest('.admin-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Area Name *</label>
          <input type="text" id="areaName" value="${areaData?.name || ''}" placeholder="e.g. Verulam" />
        </div>
        <div class="form-group">
          <label>Delivery Fee (R)</label>
          <input type="number" id="areaFee" value="${areaData?.fee || 35}" step="0.50" min="0" />
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="areaActive">
            <option value="true" ${areaData?.active !== false ? 'selected' : ''}>Active</option>
            <option value="false" ${areaData?.active === false ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="this.closest('.admin-modal').remove()">Cancel</button>
        <button class="btn-save" id="saveAreaBtn">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </div>
  `);

  modal.querySelector('#saveAreaBtn').addEventListener('click', async () => {
    const name = document.getElementById('areaName').value.trim();
    const fee = parseFloat(document.getElementById('areaFee').value) || 35;
    const active = document.getElementById('areaActive').value === 'true';
    if (!name) {
      showToast('Area name is required.');
      return;
    }
    const data = { name, fee, active, updatedAt: serverTimestamp() };
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'areas', areaData.id), data);
        showToast('✅ Area updated successfully!');
      } else {
        await addDoc(collection(db, 'areas'), { ...data, createdAt: serverTimestamp() });
        showToast('✅ Area added successfully!');
      }
      closeModal(modal);
      loadAreas();
    } catch (error) {
      console.error('Error saving area:', error);
      showToast('❌ Failed to save area.');
    }
  });
}

// ===== EDIT AREA =====
export function editArea(areaId) {
  const docRef = doc(db, 'areas', areaId);
  getDoc(docRef).then(docSnap => {
    if (docSnap.exists()) {
      openAreaModal({ ...docSnap.data(), id: areaId });
    } else {
      showToast('Area not found.');
    }
  }).catch(error => {
    console.error('Error loading area:', error);
    showToast('Error loading area.');
  });
}

// ===== DELETE AREA =====
export async function deleteArea(areaId) {
  if (!confirm('Are you sure you want to delete this delivery area?')) return;
  try {
    await deleteDoc(doc(db, 'areas', areaId));
    showToast('✅ Area deleted successfully!');
    loadAreas();
  } catch (error) {
    console.error('Error deleting area:', error);
    showToast('❌ Failed to delete area.');
  }
}