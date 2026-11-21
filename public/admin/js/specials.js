// ============================================================
//  specials.js — Admin specials view (read-only + delete)
//  Editing/creating happens via Products. This page mirrors
//  the current `specials` collection for review.
// ============================================================

import {
  db,
  collection, query, orderBy, getDocs, onSnapshot,
  doc, getDoc, deleteDoc, setDoc
} from '../../js/firebase-config.js';

import { increment } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import { showToast, showLoading, formatMoney, formatDate } from './utils.js';

const adminContent = document.getElementById('adminContent');

window.loadSpecials = loadSpecials;
window.deleteSpecial = deleteSpecial;

// ============================================================
//  LOAD SPECIALS LIST
// ============================================================
export function loadSpecials() {
  showLoading('Loading specials...');

  const specialsRef = collection(db, 'specials');
  const q = query(specialsRef, orderBy('createdAt', 'desc'));

  onSnapshot(q, async (snapshot) => {
    let viewCounts = {};
    try {
      const viewsSnap = await getDocs(collection(db, 'analytics_special_views'));
      viewsSnap.forEach(d => {
        const data = d.data();
        const key = data.specialId || data.specialName || 'unknown';
        viewCounts[key] = (viewCounts[key] || 0) + 1;
      });
    } catch (e) {}

    const now = new Date();

    // Calculate counts for the summary
    let activeCount = 0;
    let expiredCount = 0;
    
    snapshot.forEach(d => {
      const s = d.data();
      const end = s.endDate?.toDate ? s.endDate.toDate() : (s.endDate ? new Date(s.endDate) : null);
      const expired = end && end < now;
      
      if (s.active !== false && !expired) activeCount++;
      else expiredCount++;
    });

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <div>
          <h3 style="margin:0 0 4px;">Weekly Specials</h3>
          <div style="font-size:0.85rem;font-weight:600;display:flex;gap:12px;">
            <span style="color:var(--green);"><i class="fas fa-check-circle"></i> ${activeCount} Active</span>
            <span style="color:var(--red);"><i class="fas fa-clock"></i> ${expiredCount} Expired</span>
            <span style="color:var(--text-secondary);">Total: ${snapshot.size}</span>
          </div>
        </div>
        <div style="font-size:0.82rem;color:var(--text-secondary);">
          <i class="fas fa-info-circle"></i>
          Manage specials from <strong>Products</strong> — open any product and toggle "On special".
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Image</th>
              <th>Item</th>
              <th>Store</th>
              <th>Price</th>
              <th>Tag</th>
              <th>Ends</th>
              <th>Popularity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (snapshot.empty) {
      html += `<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--text-secondary);">No specials. Create one from a product.</td></tr>`;
    } else {
      const specials = [];
      snapshot.forEach(d => {
        const s = d.data();
        const id = d.id;
        const views = viewCounts[id] || viewCounts[s.item] || 0;
        specials.push({ id, ...s, views });
      });
      specials.sort((a, b) => b.views - a.views);

      specials.forEach((special, index) => {
        const specialId = special.id;
        const endDate = special.endDate?.toDate ? special.endDate.toDate() : (special.endDate ? new Date(special.endDate) : null);
        const expired = endDate && endDate < now;
        const isActive = special.active !== false && !expired;
        const statusClass = isActive ? 'status-confirmed' : (expired ? 'status-pending' : 'status-pending');
        const statusLabel = isActive ? '✅ Active' : (expired ? '⏰ Expired' : '❌ Inactive');
        const imgSrc = special.image || 'img/placeholder.jpg';

        html += `
          <tr>
            <td><img src="${imgSrc}" alt="" style="width:40px;height:40px;object-fit:contain;background:#f3f4f6;border-radius:8px;padding:2px;" onerror="this.src='img/placeholder.jpg'"></td>
            <td><strong>${escapeHtml(special.item || 'N/A')}</strong></td>
            <td>${escapeHtml(special.store || 'N/A')}</td>
            <td>${formatMoney(special.price || 0)}</td>
            <td><span class="status-badge" style="background:var(--orange);color:#fff;">${escapeHtml(special.tag || 'Special')}</span></td>
            <td style="font-size:0.8rem;">${endDate ? formatDate(endDate) : '—'}</td>
            <td>${special.views || 0} views</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>
              <button class="btn-sm btn-delete" onclick="deleteSpecial('${specialId}')" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;
    adminContent.innerHTML = html;
  }, (error) => {
    console.error('Error loading specials:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading specials.</p>`;
  });
}

// ============================================================
//  DELETE SPECIAL
//  Deleting a special from here also un-specials the product.
// ============================================================
async function deleteSpecial(specialId) {
  if (!confirm('Delete this special? The linked product will also have its special removed.')) return;

  try {
    const specialSnap = await getDoc(doc(db, 'specials', specialId));
    if (!specialSnap.exists()) {
      showToast('Special not found.');
      return;
    }
    const special = specialSnap.data();

    // Delete special doc
    await deleteDoc(doc(db, 'specials', specialId));

    // Bump the cache version so the specials page refreshes
    try {
      await setDoc(doc(db, 'settings', 'catalog'), {
        version: increment(1)
      }, { merge: true });
    } catch (e) {}

    // Un-special the product
    if (special.productId) {
      try {
        const productRef = doc(db, 'products', special.productId);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js')
            .then(({ updateDoc, serverTimestamp }) => {
              return updateDoc(productRef, {
                onSpecial: false,
                specialPrice: null,
                specialStartDate: null,
                specialEndDate: null,
                specialTag: '',
                updatedAt: serverTimestamp()
              });
            });
        }
      } catch (e) { console.warn('Could not un-special product:', e); }
    }

    showToast('✅ Special deleted.');
    loadSpecials();
  } catch (error) {
    console.error('Error deleting special:', error);
    showToast('❌ Failed to delete special.');
  }
}

// ============================================================
//  HELPERS
// ============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}