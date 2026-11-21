// ============================================================
//  TESTMODE.JS - Test mode management module
// ============================================================

import { db, doc, getDoc, setDoc, serverTimestamp } from '../../js/firebase-config.js';
import { showToast, showLoading } from './utils.js';

const adminContent = document.getElementById('adminContent');

// ===== EXPOSE GLOBALLY =====
window.loadTestMode = loadTestMode;

// ===== LOAD TEST MODE =====
export function loadTestMode() {
  showLoading('Loading test mode settings...');
  
  const settingsRef = doc(db, 'settings', 'testMode');
  
  getDoc(settingsRef).then((docSnap) => {
    const isEnabled = docSnap.exists() ? docSnap.data().enabled : false;
    
    adminContent.innerHTML = `
      <div class="settings-section">
        <h3 style="margin-bottom:1rem;"><i class="fas fa-vial"></i> Test Mode</h3>
        
        ${isEnabled ? `
          <div class="test-mode-banner">
            <div class="banner-icon"><i class="fas fa-flask"></i></div>
            <div class="banner-text">
              <h4>⚠️ Test Mode is ACTIVE</h4>
              <p>Yoco test keys are being used. Orders will bypass real payments.</p>
            </div>
            <span class="banner-status active">🔴 Active</span>
          </div>
        ` : `
          <div class="test-mode-banner" style="background:#F0FDF4;border-color:var(--green);">
            <div class="banner-icon"><i class="fas fa-check-circle" style="color:var(--green);"></i></div>
            <div class="banner-text">
              <h4>Test Mode is OFF</h4>
              <p>Yoco LIVE keys are being used. All orders will process real payments.</p>
            </div>
            <span class="banner-status inactive">🟢 Live</span>
          </div>
        `}
        
        <div class="settings-card" style="margin-top:1rem;">
          <div class="form-group">
            <label>Test Mode Status</label>
            <div class="toggle-switch">
              <div class="toggle-track ${isEnabled ? 'active' : ''}" id="testModeToggle">
                <div class="toggle-thumb"></div>
              </div>
              <span class="toggle-label">${isEnabled ? 'Test Mode ON' : 'Test Mode OFF'}</span>
            </div>
            <p class="toggle-hint">
              ${isEnabled 
                ? '🔴 Test mode is active. All orders will bypass Yoco payment.' 
                : '🟢 Test mode is off. All orders will process real payments through Yoco.'}
            </p>
          </div>
          <button class="btn-save" id="saveTestModeBtn">
            <i class="fas fa-save"></i> ${isEnabled ? 'Disable Test Mode' : 'Enable Test Mode'}
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('testModeToggle')?.addEventListener('click', () => {
      document.getElementById('testModeToggle').classList.toggle('active');
      const newState = document.getElementById('testModeToggle').classList.contains('active');
      const label = document.querySelector('.toggle-label');
      if (label) label.textContent = newState ? 'Test Mode ON' : 'Test Mode OFF';
      const hint = document.querySelector('.toggle-hint');
      if (hint) {
        hint.textContent = newState 
          ? '🔴 Test mode is active. All orders will bypass Yoco payment.' 
          : '🟢 Test mode is off. All orders will process real payments through Yoco.';
      }
      document.getElementById('saveTestModeBtn').textContent = newState ? 'Disable Test Mode' : 'Enable Test Mode';
    });
    
    document.getElementById('saveTestModeBtn')?.addEventListener('click', async () => {
      const isActive = document.getElementById('testModeToggle').classList.contains('active');
      try {
        await setDoc(doc(db, 'settings', 'testMode'), { 
          enabled: isActive, 
          updatedAt: serverTimestamp(),
          updatedBy: 'admin'
        }, { merge: true });
        showToast(`✅ Test mode ${isActive ? 'enabled' : 'disabled'} successfully!`);
        loadTestMode();
      } catch (error) {
        console.error('Error saving test mode:', error);
        showToast('❌ Failed to save test mode setting.');
      }
    });
    
  }).catch(error => {
    console.error('Error loading test mode:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading test mode settings.</p>`;
  });
}