// ============================================================
//  SETTINGS.JS - Settings module
// ============================================================

import {
  db, doc, getDoc, setDoc, serverTimestamp, collection, getDocs,
  deleteDoc, addDoc, updateDoc
} from '../../js/firebase-config.js';
import { showToast, showLoading } from './utils.js';

const adminContent = document.getElementById('adminContent');

// Attach to window so admin-main.js can find it
window.loadSettings = loadSettings;

export async function loadSettings() {
  showLoading('Loading settings...');
  
  try {
    // Fetch both the new pricing engine and the old settings (if any)
    const [pricingSnap, oldSettingsSnap, overridesSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'deliveryPricing')),
      getDoc(doc(db, 'settings', 'delivery')),
      getDocs(collection(db, 'deliveryOverrides'))
    ]);

    // New Pricing Engine Data
    const baseFee = pricingSnap.exists() ? (pricingSnap.data().baseFee ?? 18) : 18;
    const perKmRate = pricingSnap.exists() ? (pricingSnap.data().perKmRate ?? 4) : 4;
    const minFee = pricingSnap.exists() ? (pricingSnap.data().minFee ?? 18) : 18;
    const maxFee = pricingSnap.exists() ? (pricingSnap.data().maxFee ?? '') : '';

    // Old Flat Fee Data (restored from your original file)
    const oldFlatFee = oldSettingsSnap.exists() ? oldSettingsSnap.data().fee : 35;

    let overrides = [];
    overridesSnap.forEach(d => overrides.push({ id: d.id, ...d.data() }));

    let overridesHtml = `
      <table style="width:100%; border-collapse:collapse; margin-top:1rem;">
        <thead>
          <tr>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd;">Address Match</th>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #ddd;">Fee (R)</th>
            <th style="text-align:center; padding:8px; border-bottom:1px solid #ddd;">Enabled</th>
            <th style="text-align:center; padding:8px; border-bottom:1px solid #ddd;">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (overrides.length === 0) {
      overridesHtml += `<tr><td colspan="4" style="text-align:center; padding:1rem; color:#666;">No address overrides found.</td></tr>`;
    } else {
      overrides.forEach(ovr => {
        overridesHtml += `
          <tr>
            <td style="padding:8px; border-bottom:1px solid #eee;">${ovr.address}</td>
            <td style="padding:8px; border-bottom:1px solid #eee;">R${Number(ovr.fee).toFixed(2)}</td>
            <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">
              <input type="checkbox" ${ovr.enabled ? 'checked' : ''} onchange="window.toggleOverride('${ovr.id}', this.checked)" />
            </td>
            <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">
              <button class="btn-sm btn-delete" onclick="window.deleteOverride('${ovr.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      });
    }
    overridesHtml += `</tbody></table>`;

    adminContent.innerHTML = `
      <div class="settings-section" style="max-width:800px;">
        <h3 style="margin-bottom:1rem;">Settings</h3>
        
        <div class="settings-card" style="margin-bottom:2rem;">
          <h4 style="margin-top:0; margin-bottom:1rem; color:var(--navy);"><i class="fas fa-motorcycle"></i> Delivery Pricing Engine</h4>
          <p style="font-size:0.85rem; color:#666; margin-bottom:1rem;">This formula calculates the distance between the store and the customer.</p>
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem;">
            <div class="form-group">
              <label>Base Fee (R)</label>
              <input type="number" id="baseFeeInput" value="${baseFee}" step="0.50" min="0" />
            </div>
            <div class="form-group">
              <label>Per KM Rate (R)</label>
              <input type="number" id="perKmInput" value="${perKmRate}" step="0.50" min="0" />
            </div>
            <div class="form-group">
              <label>Minimum Fee (R)</label>
              <input type="number" id="minFeeInput" value="${minFee}" step="0.50" min="0" />
            </div>
            <div class="form-group">
              <label>Maximum Fee (R) - Optional Cap</label>
              <input type="number" id="maxFeeInput" value="${maxFee}" step="0.50" min="0" placeholder="No cap" />
            </div>
          </div>
          <button class="btn-save" id="savePricingBtn"><i class="fas fa-save"></i> Save Pricing Formula</button>
        </div>

        <div class="settings-card" style="margin-bottom:2rem;">
          <h4 style="margin-top:0; margin-bottom:1rem; color:var(--navy);"><i class="fas fa-map-marker-alt"></i> Address Overrides</h4>
          <p style="font-size:0.85rem; color:#666; margin-bottom:1rem;">If a customer types an address matching this string, they get the flat fee instead of the distance calculation.</p>
          
          <div style="display:flex; gap:10px; margin-bottom:1rem; align-items:flex-end; background:#f9f9f9; padding:10px; border-radius:6px;">
            <div class="form-group" style="flex:2; margin:0;">
              <label style="font-size:0.8rem;">Search Address (Autocomplete)</label>
              <input type="text" id="newOvrAddress" style="width:100%;" placeholder="Start typing to search..." />
            </div>
            <div class="form-group" style="flex:1; margin:0;">
              <label style="font-size:0.8rem;">Fee (R)</label>
              <input type="number" id="newOvrFee" style="width:100%;" step="0.50" />
            </div>
            <button class="btn-primary" id="addOvrBtn" style="height:38px;"><i class="fas fa-plus"></i> Add</button>
          </div>

          ${overridesHtml}
        </div>

        <div class="settings-card">
          <h4 style="margin-top:0; margin-bottom:1rem; color:var(--navy);"><i class="fas fa-cog"></i> Legacy Fallback Fee</h4>
          <p style="font-size:0.85rem; color:#666; margin-bottom:1rem;">This is the old flat fee (R${oldFlatFee}). It is only used if the Maps API completely fails and the system needs a fallback.</p>
          <div class="form-group" style="max-width:200px;">
            <label>Flat Fallback Fee (R)</label>
            <input type="number" id="oldFlatFeeInput" value="${oldFlatFee}" step="0.50" min="0" />
          </div>
          <button class="btn-save" id="saveOldFeeBtn"><i class="fas fa-save"></i> Save Fallback Fee</button>
        </div>

      </div>
    `;

    // Load Google Maps Script if not already loaded
    if (!window.google || !window.google.maps) {
      const script = document.createElement('script');
      // Replace with your actual Google Maps API key
      script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyCgDysjnDzVdCjNnyCWBTO9DhUXnBUqAN0&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initAddressAutocomplete;
      document.head.appendChild(script);
    } else {
      initAddressAutocomplete();
    }

    // Save New Pricing Engine
    document.getElementById('savePricingBtn').addEventListener('click', async () => {
      const baseFee = parseFloat(document.getElementById('baseFeeInput').value);
      const perKmRate = parseFloat(document.getElementById('perKmInput').value);
      const minFee = parseFloat(document.getElementById('minFeeInput').value);
      const maxFeeVal = document.getElementById('maxFeeInput').value;
      const maxFee = maxFeeVal ? parseFloat(maxFeeVal) : null;

      if (isNaN(baseFee) || isNaN(perKmRate) || isNaN(minFee)) {
        showToast('Please enter valid numbers for fees.');
        return;
      }

      try {
        await setDoc(doc(db, 'settings', 'deliveryPricing'), {
          baseFee, perKmRate, minFee, maxFee, updatedAt: serverTimestamp()
        }, { merge: true });
        showToast('✅ Delivery pricing updated!');
      } catch (error) {
        console.error('Error saving settings:', error);
        showToast('❌ Failed to save settings.');
      }
    });

    // Add Override
    document.getElementById('addOvrBtn').addEventListener('click', async () => {
      const address = document.getElementById('newOvrAddress').value.trim();
      const fee = parseFloat(document.getElementById('newOvrFee').value);
      
      if (!address || isNaN(fee)) { showToast('Enter an address and a valid fee.'); return; }
      
      try {
        await addDoc(collection(db, 'deliveryOverrides'), {
          address, fee, enabled: true, createdAt: serverTimestamp()
        });
        showToast('✅ Override added!');
        loadSettings();
      } catch (error) {
        console.error('Error adding override:', error);
        showToast('❌ Failed to add override: ' + error.message);
      }
    });

    // Save Old Flat Fee
    document.getElementById('saveOldFeeBtn').addEventListener('click', async () => {
      const fee = parseFloat(document.getElementById('oldFlatFeeInput').value);
      if (isNaN(fee) || fee < 0) { showToast('Please enter a valid amount.'); return; }
      try {
        await setDoc(doc(db, 'settings', 'delivery'), { fee, updatedAt: serverTimestamp() }, { merge: true });
        showToast('✅ Fallback fee updated successfully!');
      } catch (error) {
        console.error('Error saving fallback fee:', error);
        showToast('❌ Failed to save settings.');
      }
    });

    // Global functions for inline buttons
    window.toggleOverride = async (id, enabled) => {
      try {
        await updateDoc(doc(db, 'deliveryOverrides', id), { enabled });
        showToast(`✅ Override ${enabled ? 'enabled' : 'disabled'}.`);
      } catch (error) {
        console.error('Error toggling override:', error);
        showToast('❌ Failed to update override.');
      }
    };

    window.deleteOverride = async (id) => {
      if (!confirm('Delete this override?')) return;
      try {
        await deleteDoc(doc(db, 'deliveryOverrides', id));
        showToast('✅ Override deleted.');
        loadSettings();
      } catch (error) {
        console.error('Error deleting override:', error);
        showToast('❌ Failed to delete override.');
      }
    };

  } catch (error) {
    console.error('Error loading settings:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading settings. Check console for details.</p>`;
  }
}

function initAddressAutocomplete() {
  const input = document.getElementById('newOvrAddress');
  if (!input) return;

  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'za' },
    fields: ['formatted_address']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place.formatted_address) {
      input.value = place.formatted_address;
    }
  });
}