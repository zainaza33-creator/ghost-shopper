// ============================================================
//  products.js — Admin product management
//  Includes: single-product modal with Special section, bulk-add,
//  category manager, and search box on the products list.
// ============================================================

import {
  db, storage,
  collection, query, where, orderBy, getDocs, onSnapshot,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp
} from '../../js/firebase-config.js';

import { increment } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

import { showToast, showLoading, formatMoney, openModal, closeModal } from './utils.js';

const adminContent = document.getElementById('adminContent');
let productsUnsubscribe = null;

const IMG_MAX_DIMENSION = 400;
const IMG_JPEG_QUALITY = 0.85;
const IMG_MAX_BYTES = 250 * 1024;

const MAX_BULK_ROWS = 100;
const UPLOAD_CHUNK_SIZE = 5;
const UPLOAD_CHUNK_DELAY = 400;

let currentProductsTab = 'products';

// Module-level search term — persists across rerenders
let productsSearchTerm = '';

window.loadProducts = loadProducts;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.openProductModal = openProductModal;
window.openBulkAddModal = openBulkAddModal;
window.switchProductsTab = switchProductsTab;
window.renameCategory = renameCategory;

// ============================================================
//  CACHE VERSION BUMP
// ============================================================
async function bumpCatalogVersion() {
  try {
    await setDoc(doc(db, 'settings', 'catalog'), {
      version: increment(1)
    }, { merge: true });
    console.log('✅ Catalog cache version bumped');
  } catch (e) {
    console.warn('Could not bump catalog version:', e);
  }
}

// ============================================================
//  LOAD PRODUCTS
// ============================================================
export function loadProducts() {
  showLoading('Loading products...');

  if (productsUnsubscribe) {
    productsUnsubscribe();
    productsUnsubscribe = null;
  }

  const storesRef = collection(db, 'stores');
  getDocs(storesRef).then(storesSnap => {
    const stores = [];
    storesSnap.forEach(d => stores.push({ id: d.id, name: d.data().name || 'Unknown' }));

    const productsRef = collection(db, 'products');
    const q = query(productsRef, orderBy('name'));

    productsUnsubscribe = onSnapshot(q, (snapshot) => {
      const allProducts = [];
      snapshot.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
      renderProductsShell(allProducts, stores);
    }, (error) => {
      console.error('Error loading products:', error);
      adminContent.innerHTML = `<p style="color:var(--red);">Error loading products.</p>`;
    });
  }).catch(error => {
    console.error('Error loading stores for filter:', error);
    adminContent.innerHTML = `<p style="color:var(--red);">Error loading products.</p>`;
  });
}

// ============================================================
//  SHELL — tabs + view
// ============================================================
function renderProductsShell(allProducts, stores) {
  adminContent.innerHTML = `
    <div class="products-tabs">
      <button class="products-tab ${currentProductsTab === 'products' ? 'active' : ''}" data-tab="products" type="button">
        <i class="fas fa-box"></i> Products
        <span class="products-tab-count">${allProducts.length}</span>
      </button>
      <button class="products-tab ${currentProductsTab === 'categories' ? 'active' : ''}" data-tab="categories" type="button">
        <i class="fas fa-tags"></i> Categories
        <span class="products-tab-count">${countCategories(allProducts)}</span>
      </button>
    </div>
    <div id="productsViewContainer"></div>
  `;

  adminContent.querySelectorAll('.products-tab').forEach(btn => {
    btn.addEventListener('click', () => switchProductsTab(btn.dataset.tab));
  });

  if (currentProductsTab === 'categories') {
    renderCategoriesView(allProducts);
  } else {
    renderProductsView(allProducts, stores);
  }
}

function switchProductsTab(tab) {
  if (!['products', 'categories'].includes(tab)) return;
  currentProductsTab = tab;
  loadProducts();
}

// ============================================================
//  PRODUCTS VIEW — with search
// ============================================================
function renderProductsView(allProducts, stores) {
  const container = document.getElementById('productsViewContainer');
  if (!container) return;

  const storeOptions = stores.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Products</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <div style="position:relative;min-width:220px;flex:1;">
          <i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.85rem;pointer-events:none;"></i>
          <input
            type="text"
            id="productSearchInput"
            placeholder="Search by name, category or store…"
            autocomplete="off"
            value="${escapeAttr(productsSearchTerm)}"
            style="width:100%;padding:10px 14px 10px 36px;border:1.5px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;font-size:0.85rem;min-height:44px;box-sizing:border-box;"
          />
        </div>
        <select id="productStoreFilter" class="sort-select" style="padding:6px 14px;min-height:44px;border:1px solid var(--border);border-radius:8px;font-family:'Inter',sans-serif;">
          <option value="all">All Stores</option>
          ${storeOptions}
        </select>
        <button class="btn-secondary" onclick="openBulkAddModal()">
          <i class="fas fa-layer-group"></i> Add Multiple
        </button>
        <button class="btn-primary" onclick="openProductModal()">
          <i class="fas fa-plus"></i> Add Product
        </button>
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Name</th>
            <th>Store</th>
            <th>Category</th>
            <th>Price</th>
            <th>Special</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="productsTableBody"></tbody>
      </table>
    </div>
  `;

  updateProductsTableBody(allProducts, stores);

  // Wire the search input (no full rerender — just filters the table body)
  const searchInput = document.getElementById('productSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      productsSearchTerm = searchInput.value.trim().toLowerCase();
      updateProductsTableBody(allProducts, stores);
    });
  }

  // Wire the store filter (full reload to refresh counts + list)
  const storeFilter = document.getElementById('productStoreFilter');
  if (storeFilter) {
    // Restore prior selection if present
    const prior = storeFilter.dataset.priorValue;
    if (prior) storeFilter.value = prior;
    storeFilter.addEventListener('change', () => {
      storeFilter.dataset.priorValue = storeFilter.value;
      updateProductsTableBody(allProducts, stores);
    });
  }
}

// ============================================================
//  RENDER TABLE BODY (respects search + store filter)
// ============================================================
function updateProductsTableBody(allProducts, stores) {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  const filterStore = document.getElementById('productStoreFilter')?.value || 'all';
  const filterSearch = productsSearchTerm;

  let visible = filterStore === 'all'
    ? allProducts
    : allProducts.filter(p => p.storeId === filterStore);

  if (filterSearch) {
    visible = visible.filter(p => {
      const name = (p.name || '').toLowerCase();
      const cat = (p.category || '').toLowerCase();
      const storeObj = stores.find(s => s.id === p.storeId);
      const storeName = (storeObj?.name || '').toLowerCase();
      return name.includes(filterSearch)
          || cat.includes(filterSearch)
          || storeName.includes(filterSearch);
    });
  }

  if (!visible.length) {
    const msg = filterSearch
      ? `No products match "${escapeHtml(productsSearchTerm)}".`
      : 'No products found.';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:1rem;color:var(--text-secondary);">${msg}</td></tr>`;
    return;
  }

  const now = new Date();

  tbody.innerHTML = visible.map(product => {
    const productId = product.id;
    const storeName = stores.find(s => s.id === product.storeId)?.name || 'Unknown';
    const inStock = product.stock !== false;
    const imgSrc = product.image || 'img/placeholder.jpg';
    const specialActive = isSpecialActive(product, now);

    let priceCell;
    if (specialActive) {
      priceCell = `
        <div style="display:flex;flex-direction:column;gap:2px;">
          <span style="text-decoration:line-through;color:var(--text-muted);font-size:0.72rem;">${formatMoney(product.price || 0)}</span>
          <span style="color:var(--orange);font-weight:800;">${formatMoney(product.specialPrice || 0)}</span>
        </div>
      `;
    } else {
      priceCell = formatMoney(product.price || 0);
    }

    let specialCell;
    if (product.onSpecial) {
      if (specialActive) {
        specialCell = `<span class="status-badge status-confirmed">✅ Active</span>`;
      } else {
        specialCell = `<span class="status-badge status-pending">⏰ Expired</span>`;
      }
    } else {
      specialCell = `<span style="color:var(--text-muted);font-size:0.8rem;">—</span>`;
    }

    return `
      <tr>
        <td><img src="${escapeAttr(imgSrc)}" alt="" style="width:40px;height:40px;object-fit:contain;background:#f3f4f6;border-radius:8px;padding:2px;" onerror="this.src='img/placeholder.jpg'"></td>
        <td><strong>${escapeHtml(product.name || 'N/A')}</strong></td>
        <td>${escapeHtml(storeName)}</td>
        <td>${escapeHtml(product.category || '—')}</td>
        <td>${priceCell}</td>
        <td>${specialCell}</td>
        <td><span class="status-badge ${inStock ? 'status-confirmed' : 'status-pending'}">${inStock ? '✅' : '❌'}</span></td>
        <td>
          <button class="btn-sm btn-edit" onclick="editProduct('${productId}')"><i class="fas fa-pen"></i></button>
          <button class="btn-sm btn-delete" onclick="deleteProduct('${productId}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

function isSpecialActive(product, now = new Date()) {
  if (!product.onSpecial) return false;
  if (!product.specialPrice) return false;
  const end = product.specialEndDate?.toDate ? product.specialEndDate.toDate() : (product.specialEndDate ? new Date(product.specialEndDate) : null);
  if (end && end < now) return false;
  const start = product.specialStartDate?.toDate ? product.specialStartDate.toDate() : (product.specialStartDate ? new Date(product.specialStartDate) : null);
  if (start && start > now) return false;
  return true;
}

// ============================================================
//  CATEGORIES VIEW
// ============================================================
function countCategories(allProducts) {
  const set = new Set();
  allProducts.forEach(p => {
    const c = (p.category || 'Uncategorized').trim();
    if (c) set.add(c);
  });
  return set.size;
}

function groupByCategory(allProducts) {
  const map = new Map();
  allProducts.forEach(p => {
    const c = (p.category || 'Uncategorized').trim() || 'Uncategorized';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(p);
  });
  return map;
}

function renderCategoriesView(allProducts) {
  const container = document.getElementById('productsViewContainer');
  if (!container) return;

  const grouped = groupByCategory(allProducts);

  if (grouped.size === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:2.5rem 1rem;color:var(--text-secondary);">
        <i class="fas fa-tags" style="font-size:2rem;display:block;margin-bottom:12px;opacity:0.5;"></i>
        <h3 style="color:var(--navy);margin:0 0 6px;font-size:1.05rem;">No categories yet</h3>
        <p style="font-size:0.9rem;margin:0;">Add a product with a category to see it here.</p>
      </div>
    `;
    return;
  }

  const entries = Array.from(grouped.entries()).sort((a, b) => {
    if (a[0] === 'Uncategorized') return 1;
    if (b[0] === 'Uncategorized') return -1;
    return a[0].localeCompare(b[0]);
  });

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
      <h3>Categories <span style="font-weight:500;color:var(--text-secondary);font-size:0.9rem;">(${entries.length})</span></h3>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Items</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  entries.forEach(([name, products]) => {
    html += `
      <tr>
        <td><strong>${escapeHtml(name)}</strong></td>
        <td>${products.length} item${products.length === 1 ? '' : 's'}</td>
        <td>
          <button class="btn-sm btn-edit" onclick="renameCategory('${escapeAttr(name)}')">
            <i class="fas fa-pen"></i> Rename
          </button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// ============================================================
//  RENAME CATEGORY
// ============================================================
async function renameCategory(oldName) {
  if (!oldName) return;

  const newNameRaw = prompt(
    `Rename category "${oldName}" to:`,
    oldName === 'Uncategorized' ? '' : oldName
  );
  if (newNameRaw === null) return;

  const newName = String(newNameRaw).trim();
  if (!newName) { showToast('New name cannot be empty.'); return; }
  if (newName === oldName) { showToast('Same name — nothing to change.'); return; }

  const productsRef = collection(db, 'products');
  const oldQ = query(productsRef, where('category', '==', oldName));
  const oldSnap = await getDocs(oldQ);
  if (oldSnap.empty) { showToast('No products with that category.'); return; }

  const newQ = query(productsRef, where('category', '==', newName));
  const newSnap = await getDocs(newQ);

  if (!newSnap.empty) {
    const proceed = confirm(
      `Category "${newName}" already exists with ${newSnap.size} item(s).\n\n` +
      `Merge the ${oldSnap.size} item(s) from "${oldName}" into "${newName}"?`
    );
    if (!proceed) return;
  }

  const allDocs = oldSnap.docs;
  const CHUNK = 400;
  let updated = 0;

  for (let i = 0; i < allDocs.length; i += CHUNK) {
    const batch = [];
    for (let j = i; j < Math.min(i + CHUNK, allDocs.length); j++) {
      batch.push(updateDoc(doc(db, 'products', allDocs[j].id), {
        category: newName,
        updatedAt: serverTimestamp()
      }));
    }
    await Promise.all(batch);
    updated += batch.length;
  }

  showToast(`✅ Renamed "${oldName}" → "${newName}" (${updated} items).`);
  loadProducts();
}

// ============================================================
//  SINGLE PRODUCT MODAL
// ============================================================
export function openProductModal(productData = null) {
  const isEdit = !!productData;

  getDocs(collection(db, 'stores')).then(async storesSnap => {
    const stores = [];
    storesSnap.forEach(d => stores.push({ id: d.id, name: d.data().name || 'Unknown' }));

    const categories = await loadCategoryList();

    const existingMainImage = productData?.image || '';
    const existingAdditional = Array.isArray(productData?.images) ? productData.images : [];
    const currentCategory = productData?.category || '';

    const onSpecial = !!productData?.onSpecial;
    const specialPrice = productData?.specialPrice || '';
    const specialTag = productData?.specialTag || '';
    const specialStart = productData?.specialStartDate ? toDateInput(productData.specialStartDate) : '';
    const specialEnd = productData?.specialEndDate ? toDateInput(productData.specialEndDate) : '';

    const modal = openModal(`
      <div class="modal-content" style="max-width:640px;">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Add'} Product</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Product Name *</label>
            <input type="text" id="productName" value="${escapeAttr(productData?.name || '')}" placeholder="e.g. Fresh Bread" />
          </div>
          <div class="form-group">
            <label>Store *</label>
            <select id="productStore" ${isEdit ? 'disabled' : ''}>
              <option value="">Select Store</option>
              ${stores.map(s => `<option value="${s.id}" ${productData?.storeId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
            ${isEdit ? '<small style="font-size:0.72rem;color:var(--text-muted);">Store cannot be changed.</small>' : ''}
          </div>
          <div class="form-group">
            <label>Category</label>
            <div style="display:flex;gap:8px;align-items:stretch;">
              <select id="productCategorySelect" style="flex:1;">
                <option value="">Select category</option>
                ${categories.map(c => `<option value="${escapeAttr(c)}" ${c === currentCategory ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                ${currentCategory && !categories.includes(currentCategory)
                  ? `<option value="${escapeAttr(currentCategory)}" selected>${escapeHtml(currentCategory)}</option>` : ''}
              </select>
              <button type="button" class="btn-secondary" id="productCategoryAddBtn" style="width:auto;min-width:110px;">
                <i class="fas fa-plus"></i> Add
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="productDescription" rows="2" placeholder="Product description...">${escapeHtml(productData?.desc || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Weight (e.g. 500g, 1kg)</label>
            <input type="text" id="productWeight" value="${escapeAttr(productData?.weight || '')}" placeholder="e.g. 500g" />
          </div>
          <div class="form-group">
            <label>Price (R) *</label>
            <input type="number" id="productPrice" value="${productData?.price || ''}" step="0.01" placeholder="12.99" />
          </div>

          <!-- ============= SPECIAL SECTION ============= -->
          <hr class="modal-divider" />
          <div class="special-section">
            <div class="special-toggle-row">
              <div>
                <label style="display:block;font-weight:800;font-size:0.9rem;color:var(--navy);">
                  <i class="fas fa-tag" style="color:var(--orange);"></i> On special
                </label>
                <small style="font-size:0.72rem;color:var(--text-muted);">Adds this product to Weekly Specials on the homepage and store page.</small>
              </div>
              <label class="special-toggle">
                <input type="checkbox" id="productOnSpecial" ${onSpecial ? 'checked' : ''} />
                <span class="track"></span>
              </label>
            </div>

            <div id="specialFields" class="special-fields" ${onSpecial ? '' : 'hidden'}>
              <div class="form-group">
                <label>Special price (R) *</label>
                <input type="number" id="productSpecialPrice" value="${specialPrice}" step="0.01" placeholder="e.g. 12.99" />
              </div>
              <div class="special-dates-row">
                <div class="form-group">
                  <label>Starts</label>
                  <input type="date" id="productSpecialStart" value="${specialStart}" />
                </div>
                <div class="form-group">
                  <label>Ends *</label>
                  <input type="date" id="productSpecialEnd" value="${specialEnd}" />
                </div>
              </div>
              <div class="form-group">
                <label>Tag (optional)</label>
                <input type="text" id="productSpecialTag" value="${escapeAttr(specialTag)}" placeholder="e.g. Save R3, 50% OFF" />
              </div>
            </div>
          </div>
          <!-- ============= END SPECIAL ============= -->

          <div class="form-group">
            <label>Main Image</label>
            <div class="img-upload-row">
              <div class="img-preview" id="mainImagePreview">
                ${existingMainImage ? `<img src="${escapeAttr(existingMainImage)}" alt="Preview" onerror="this.style.display='none';" />` : `<span class="img-empty-label">No image</span>`}
              </div>
              <div class="img-upload-controls">
                <input type="file" id="mainImageInput" accept="image/*" hidden />
                <button type="button" class="btn-secondary" id="mainImageChooseBtn">
                  <i class="fas fa-image"></i> Choose Image
                </button>
                <small class="img-hint">Auto-resized to 400×400</small>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>Additional Images <span style="font-weight:400;color:var(--text-muted);font-size:0.8rem;">(optional)</span></label>
            <div class="img-gallery" id="additionalImagesGallery"></div>
            <input type="file" id="additionalImagesInput" accept="image/*" multiple hidden />
            <button type="button" class="btn-secondary" id="additionalImagesChooseBtn" style="margin-top:6px;">
              <i class="fas fa-plus"></i> Add Images
            </button>
          </div>
          <div class="form-group">
            <label>Stock</label>
            <select id="productStock">
              <option value="true" ${productData?.stock !== false ? 'selected' : ''}>In Stock</option>
              <option value="false" ${productData?.stock === false ? 'selected' : ''}>Out of Stock</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Cancel</button>
          <button class="btn-save" id="saveProductBtn">${isEdit ? 'Update' : 'Save'}</button>
        </div>
      </div>
    `);

    let pendingMainFile = null;
    const pendingAdditionalFiles = [];
    const keptAdditionalUrls = [...existingAdditional];

    const mainInput = modal.querySelector('#mainImageInput');
    const mainChooseBtn = modal.querySelector('#mainImageChooseBtn');
    const mainPreview = modal.querySelector('#mainImagePreview');
    const categorySelect = modal.querySelector('#productCategorySelect');
    const categoryAddBtn = modal.querySelector('#productCategoryAddBtn');
    const onSpecialToggle = modal.querySelector('#productOnSpecial');
    const specialFields = modal.querySelector('#specialFields');

    onSpecialToggle.addEventListener('change', () => {
      specialFields.hidden = !onSpecialToggle.checked;
    });

    categoryAddBtn.addEventListener('click', () => {
      const newCat = prompt('Enter new category name:');
      if (newCat === null) return;
      const trimmed = String(newCat).trim();
      if (!trimmed) { showToast('Category name cannot be empty.'); return; }
      const exists = Array.from(categorySelect.options).some(
        o => o.value && o.value.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) {
        Array.from(categorySelect.options).forEach(o => {
          if (o.value.toLowerCase() === trimmed.toLowerCase()) categorySelect.value = o.value;
        });
        showToast(`Category "${trimmed}" already exists — selected.`);
        return;
      }
      const opt = document.createElement('option');
      opt.value = trimmed;
      opt.textContent = trimmed;
      opt.selected = true;
      categorySelect.appendChild(opt);
      categorySelect.value = trimmed;
    });

    mainChooseBtn.addEventListener('click', () => mainInput.click());
    mainInput.addEventListener('change', () => {
      const f = mainInput.files[0];
      if (!f || !f.type.startsWith('image/')) return;
      pendingMainFile = f;
      const url = URL.createObjectURL(f);
      mainPreview.innerHTML = `<img src="${url}" alt="Preview" />`;
    });

    const addInput = modal.querySelector('#additionalImagesInput');
    const addChooseBtn = modal.querySelector('#additionalImagesChooseBtn');
    const gallery = modal.querySelector('#additionalImagesGallery');

    const renderGallery = () => {
      const items = [];
      keptAdditionalUrls.forEach((url, idx) => {
        items.push(`
          <div class="img-gallery-item">
            <img src="${escapeAttr(url)}" alt="" onerror="this.src='img/placeholder.jpg'" />
            <button type="button" class="img-remove-btn" data-kind="kept" data-index="${idx}">&times;</button>
          </div>
        `);
      });
      pendingAdditionalFiles.forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        items.push(`
          <div class="img-gallery-item">
            <img src="${url}" alt="" />
            <button type="button" class="img-remove-btn" data-kind="pending" data-index="${idx}">&times;</button>
          </div>
        `);
      });
      gallery.innerHTML = items.length ? items.join('') : `<div class="img-gallery-empty">No additional images</div>`;
      gallery.querySelectorAll('.img-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const kind = btn.dataset.kind;
          const idx = parseInt(btn.dataset.index, 10);
          if (kind === 'kept') keptAdditionalUrls.splice(idx, 1);
          else if (kind === 'pending') pendingAdditionalFiles.splice(idx, 1);
          renderGallery();
        });
      });
    };
    renderGallery();

    addChooseBtn.addEventListener('click', () => addInput.click());
    addInput.addEventListener('change', () => {
      const files = Array.from(addInput.files || []);
      files.forEach(f => { if (f.type.startsWith('image/')) pendingAdditionalFiles.push(f); });
      addInput.value = '';
      renderGallery();
    });

    modal.querySelector('#saveProductBtn').addEventListener('click', async () => {
      const name = modal.querySelector('#productName').value.trim();
      const storeId = modal.querySelector('#productStore').value;
      const category = categorySelect.value.trim() || 'Uncategorized';
      const desc = modal.querySelector('#productDescription').value.trim();
      const weight = modal.querySelector('#productWeight').value.trim();
      const price = parseFloat(modal.querySelector('#productPrice').value);
      const stock = modal.querySelector('#productStock').value === 'true';

      const isOnSpecial = onSpecialToggle.checked;
      const specialPrice = parseFloat(modal.querySelector('#productSpecialPrice')?.value || '');
      const specialStartRaw = modal.querySelector('#productSpecialStart')?.value || '';
      const specialEndRaw = modal.querySelector('#productSpecialEnd')?.value || '';
      const specialTag = (modal.querySelector('#productSpecialTag')?.value || '').trim();

      if (!name || !storeId || isNaN(price) || price <= 0) {
        showToast('Please fill in all required fields.');
        return;
      }

      if (isOnSpecial) {
        if (isNaN(specialPrice) || specialPrice <= 0) {
          showToast('Special price is required.');
          return;
        }
        if (!specialEndRaw) {
          showToast('Special end date is required.');
          return;
        }
        if (specialPrice >= price) {
          showToast('Special price must be less than the regular price.');
          return;
        }
      }

      const saveBtn = modal.querySelector('#saveProductBtn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        let productRef, productId;
        if (isEdit && productData.id) {
          productRef = doc(db, 'products', productData.id);
          productId = productData.id;
        } else {
          productRef = doc(collection(db, 'products'));
          productId = productRef.id;
        }

        let mainImageUrl = existingMainImage;
        if (pendingMainFile) {
          const resized = await resizeImage(pendingMainFile);
          const { url } = await uploadImage(`products/${storeId}/${productId}.jpg`, resized);
          mainImageUrl = url;
        }

        const newAdditionalUrls = [...keptAdditionalUrls];
        for (let i = 0; i < pendingAdditionalFiles.length; i++) {
          const resized = await resizeImage(pendingAdditionalFiles[i]);
          const suffix = newAdditionalUrls.length + 1;
          const { url } = await uploadImage(`products/${storeId}/${productId}-${suffix}.jpg`, resized);
          newAdditionalUrls.push(url);
        }

        const data = {
          name, storeId,
          category,
          desc, weight, price,
          image: mainImageUrl || 'img/placeholder.jpg',
          images: newAdditionalUrls,
          stock,
          updatedAt: serverTimestamp()
        };

        if (isOnSpecial) {
          // Save as plain strings to completely avoid timezone shifts
          data.onSpecial = true;
          data.specialPrice = specialPrice;
          data.specialStartDate = specialStartRaw || null;
          data.specialEndDate = specialEndRaw || null;
          data.specialTag = specialTag || 'Special';
        } else {
          data.onSpecial = false;
          data.specialPrice = null;
          data.specialStartDate = null;
          data.specialEndDate = null;
          data.specialTag = '';
        }

        if (isEdit) {
          await updateDoc(productRef, data);
        } else {
          await setDoc(productRef, { ...data, createdAt: serverTimestamp() });
        }

        const store = stores.find(s => s.id === storeId);
        const storeName = store ? store.name : '';

        if (isOnSpecial) {
          const existingMirror = await getDocs(
            query(collection(db, 'specials'), where('productId', '==', productId))
          );

          const startDate = data.specialStartDate;
          const endDate = data.specialEndDate;
          const specialDoc = {
            productId,
            item: name,
            store: storeName,
            storeId,
            price: specialPrice,
            oldPrice: price,
            tag: data.specialTag,
            image: mainImageUrl || 'img/placeholder.jpg',
            category,
            active: true,
            startDate,
            endDate,
            updatedAt: serverTimestamp()
          };

          if (!existingMirror.empty) {
            await updateDoc(existingMirror.docs[0].ref, specialDoc);
          } else {
            await addDoc(collection(db, 'specials'), {
              ...specialDoc,
              createdAt: serverTimestamp()
            });
          }
        } else {
          const mirrors = await getDocs(
            query(collection(db, 'specials'), where('productId', '==', productId))
          );
          for (const d of mirrors.docs) {
            try { await deleteDoc(d.ref); } catch (_) {}
          }
        }

        await bumpCatalogVersion(); // Tell the cache to refresh
        showToast(isEdit ? '✅ Product updated.' : '✅ Product added.');
        closeModal(modal);
        loadProducts();
      } catch (err) {
        console.error('Error saving product:', err);
        showToast('❌ Failed: ' + (err.message || 'Unknown'));
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Update' : 'Save';
      }
    });
  }).catch(error => {
    console.error('Error loading stores:', error);
    showToast('Error loading stores.');
  });
}

// ============================================================
//  BULK ADD MODAL
// ============================================================
export function openBulkAddModal() {
  getDocs(collection(db, 'stores')).then(async storesSnap => {
    const stores = [];
    storesSnap.forEach(d => stores.push({ id: d.id, name: d.data().name || 'Unknown' }));

    const categories = await loadCategoryList();

    const modal = openModal(`
      <div class="modal-content" style="max-width:1200px;width:96%;">
        <div class="modal-header">
          <h3><i class="fas fa-layer-group"></i> Add Multiple Products</h3>
          <button class="modal-close" onclick="closeModal(this.closest('.admin-modal'))">&times;</button>
        </div>

        <div class="modal-body" style="max-height:80vh;overflow-y:auto;">
          <div class="bulk-global-row">
            <div class="form-group" style="flex:1;min-width:180px;">
              <label>Store * (applies to all)</label>
              <select id="bulkStore">
                <option value="">Select Store</option>
                ${stores.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1;min-width:220px;">
              <label>Category (applies to all)</label>
              <div style="display:flex;gap:8px;align-items:stretch;">
                <select id="bulkCategorySelect" style="flex:1;">
                  <option value="">Select category</option>
                  ${categories.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
                <button type="button" class="btn-secondary" id="bulkCategoryAddBtn" style="width:auto;min-width:110px;">
                  <i class="fas fa-plus"></i> Add
                </button>
              </div>
            </div>
            <div class="form-group" style="flex:0 0 auto;min-width:120px;">
              <label>Default Stock</label>
              <select id="bulkStock">
                <option value="true">In Stock</option>
                <option value="false">Out of Stock</option>
              </select>
            </div>
          </div>

          <div class="bulk-paste-block">
            <label>Paste products (one per line)</label>
            <textarea id="bulkPasteInput" rows="5" placeholder="Any of these formats work — one product per line:

700g    Albany White Bread        R18.99
Albany Brown Bread    700g        R18.99
1kg | Sasko Cake Flour | R17.99
500ml; Clover Fresh Milk; R22.50"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
              <button type="button" class="btn-secondary" id="bulkParseBtn">
                <i class="fas fa-wand-magic-sparkles"></i> Parse &amp; Fill Rows
              </button>
              <button type="button" class="btn-secondary" id="bulkAddEmptyRowBtn">
                <i class="fas fa-plus"></i> Add Empty Row
              </button>
              <span class="bulk-hint">Tab, pipe, comma, semicolon — auto-detected.</span>
            </div>
          </div>

          <div class="bulk-table-wrap">
            <table class="bulk-table">
              <thead>
                <tr>
                  <th style="width:60px;">IMG</th>
                  <th>Name *</th>
                  <th style="width:110px;">Weight</th>
                  <th style="width:110px;">Price (R) *</th>
                  <th>Description</th>
                  <th style="width:70px;">Stock</th>
                  <th style="width:50px;"></th>
                </tr>
              </thead>
              <tbody id="bulkTableBody"></tbody>
            </table>
          </div>

          <div class="bulk-footer-actions">
            <button type="button" class="btn-secondary" id="bulkAddRowBtn">
              <i class="fas fa-plus"></i> Add Row
            </button>
            <button type="button" class="btn-secondary" id="bulkUploadImagesBtn">
              <i class="fas fa-images"></i> Bulk Upload Images
            </button>
            <input type="file" id="bulkImagesInput" accept="image/*" multiple hidden />
            <span class="bulk-row-count" id="bulkRowCount">0 rows</span>
          </div>

          <div class="bulk-progress" id="bulkProgress" hidden>
            <div class="bulk-progress-label" id="bulkProgressLabel">Saving...</div>
            <div class="bulk-progress-bar">
              <div class="bulk-progress-fill" id="bulkProgressFill"></div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-cancel" onclick="closeModal(this.closest('.admin-modal'))">Cancel</button>
          <button class="btn-save" id="bulkSaveAllBtn">Save All</button>
        </div>
      </div>
    `);

    const rows = [];

    const storeSel = modal.querySelector('#bulkStore');
    const categorySelect = modal.querySelector('#bulkCategorySelect');
    const categoryAddBtn = modal.querySelector('#bulkCategoryAddBtn');
    const stockSel = modal.querySelector('#bulkStock');
    const pasteInput = modal.querySelector('#bulkPasteInput');
    const parseBtn = modal.querySelector('#bulkParseBtn');
    const addEmptyRowBtn = modal.querySelector('#bulkAddEmptyRowBtn');
    const addRowBtn = modal.querySelector('#bulkAddRowBtn');
    const uploadImagesBtn = modal.querySelector('#bulkUploadImagesBtn');
    const bulkImagesInput = modal.querySelector('#bulkImagesInput');
    const tableBody = modal.querySelector('#bulkTableBody');
    const rowCountEl = modal.querySelector('#bulkRowCount');
    const progressEl = modal.querySelector('#bulkProgress');
    const progressLabel = modal.querySelector('#bulkProgressLabel');
    const progressFill = modal.querySelector('#bulkProgressFill');
    const saveAllBtn = modal.querySelector('#bulkSaveAllBtn');

    categoryAddBtn.addEventListener('click', () => {
      const newCat = prompt('Enter new category name:');
      if (newCat === null) return;
      const trimmed = String(newCat).trim();
      if (!trimmed) { showToast('Category name cannot be empty.'); return; }
      const exists = Array.from(categorySelect.options).some(
        o => o.value && o.value.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) {
        Array.from(categorySelect.options).forEach(o => {
          if (o.value.toLowerCase() === trimmed.toLowerCase()) categorySelect.value = o.value;
        });
        showToast(`Category "${trimmed}" already exists — selected.`);
        return;
      }
      const opt = document.createElement('option');
      opt.value = trimmed;
      opt.textContent = trimmed;
      opt.selected = true;
      categorySelect.appendChild(opt);
      categorySelect.value = trimmed;
    });

    const renderRows = () => {
      if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted);">No rows yet. Paste above or click Add Row.</td></tr>`;
        rowCountEl.textContent = '0 rows';
        return;
      }

      tableBody.innerHTML = rows.map((row, i) => {
        const imgCell = row.file
          ? `<img src="${URL.createObjectURL(row.file)}" alt="" />`
          : row.existingUrl
            ? `<img src="${escapeAttr(row.existingUrl)}" alt="" onerror="this.src='img/placeholder.jpg'" />`
            : `<i class="fas fa-image" style="opacity:0.4;"></i>`;

        const rowCls = row.status === 'error' ? 'bulk-row-error'
                     : row.status === 'saving' ? 'bulk-row-saving'
                     : row.status === 'done' ? 'bulk-row-done'
                     : '';

        return `
          <tr class="${rowCls}" data-index="${i}">
            <td class="bulk-cell-img">
              <button type="button" class="bulk-img-btn" data-index="${i}" title="Choose image">
                ${imgCell}
              </button>
            </td>
            <td><input type="text" class="bulk-name" data-index="${i}" value="${escapeAttr(row.name)}" placeholder="Product name" /></td>
            <td><input type="text" class="bulk-weight" data-index="${i}" value="${escapeAttr(row.weight)}" placeholder="500g" /></td>
            <td><input type="number" class="bulk-price" data-index="${i}" value="${row.price === '' ? '' : row.price}" placeholder="12.99" step="0.01" /></td>
            <td><input type="text" class="bulk-desc" data-index="${i}" value="${escapeAttr(row.desc || '')}" placeholder="Short description (optional)" /></td>
            <td style="text-align:center;"><input type="checkbox" class="bulk-stock" data-index="${i}" ${row.stock ? 'checked' : ''} /></td>
            <td style="text-align:center;">
              <button type="button" class="bulk-delete-btn" data-index="${i}" title="Remove row"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      }).join('');

      rowCountEl.textContent = `${rows.length} / ${MAX_BULK_ROWS} rows`;

      tableBody.querySelectorAll('.bulk-name').forEach(el => {
        el.addEventListener('input', () => { rows[parseInt(el.dataset.index, 10)].name = el.value; });
      });
      tableBody.querySelectorAll('.bulk-weight').forEach(el => {
        el.addEventListener('input', () => { rows[parseInt(el.dataset.index, 10)].weight = el.value; });
      });
      tableBody.querySelectorAll('.bulk-price').forEach(el => {
        el.addEventListener('input', () => { rows[parseInt(el.dataset.index, 10)].price = el.value; });
      });
      tableBody.querySelectorAll('.bulk-desc').forEach(el => {
        el.addEventListener('input', () => { rows[parseInt(el.dataset.index, 10)].desc = el.value; });
      });
      tableBody.querySelectorAll('.bulk-stock').forEach(el => {
        el.addEventListener('change', () => { rows[parseInt(el.dataset.index, 10)].stock = el.checked; });
      });
      tableBody.querySelectorAll('.bulk-delete-btn').forEach(el => {
        el.addEventListener('click', () => {
          rows.splice(parseInt(el.dataset.index, 10), 1);
          renderRows();
        });
      });
      tableBody.querySelectorAll('.bulk-img-btn').forEach(el => {
        el.addEventListener('click', () => {
          const i = parseInt(el.dataset.index, 10);
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('change', () => {
            const f = input.files[0];
            if (!f || !f.type.startsWith('image/')) return;
            rows[i].file = f;
            rows[i].existingUrl = null;
            renderRows();
          });
          input.click();
        });
      });
    };

    renderRows();

    const addRow = (data = {}) => {
      if (rows.length >= MAX_BULK_ROWS) {
        showToast(`Maximum ${MAX_BULK_ROWS} rows per batch.`);
        return false;
      }
      rows.push({
        name: data.name || '',
        weight: data.weight || '',
        price: data.price != null ? data.price : '',
        desc: data.desc || '',
        stock: data.stock !== undefined ? data.stock : stockSel.value === 'true',
        file: null,
        previewUrl: null,
        existingUrl: null,
        status: 'ok',
        error: ''
      });
      return true;
    };

    addRowBtn.addEventListener('click', () => { addRow(); renderRows(); });
    addEmptyRowBtn.addEventListener('click', () => { addRow(); renderRows(); });

    parseBtn.addEventListener('click', () => {
      const raw = pasteInput.value || '';
      const parsed = parsePastedProducts(raw);
      if (!parsed.length) { showToast('Nothing to parse.'); return; }
      let added = 0;
      for (const p of parsed) {
        if (rows.length >= MAX_BULK_ROWS) break;
        addRow(p);
        added++;
      }
      renderRows();
      showToast(`Added ${added} row(s).`);
    });

    uploadImagesBtn.addEventListener('click', () => bulkImagesInput.click());
    bulkImagesInput.addEventListener('change', () => {
      const files = Array.from(bulkImagesInput.files || []).filter(f => f.type.startsWith('image/'));
      bulkImagesInput.value = '';
      if (!files.length) return;

      let filled = 0;
      for (let i = 0; i < rows.length && filled < files.length; i++) {
        if (!rows[i].file && !rows[i].existingUrl) {
          rows[i].file = files[filled];
          filled++;
        }
      }
      if (files.length - filled > 0) {
        for (let j = filled; j < files.length; j++) {
          if (rows.length >= MAX_BULK_ROWS) break;
          addRow();
          rows[rows.length - 1].file = files[j];
        }
      }
      renderRows();
      showToast(`Assigned ${files.length} image(s).`);
    });

    saveAllBtn.addEventListener('click', async () => {
      const storeId = storeSel.value;
      const category = categorySelect.value.trim() || 'Uncategorized';
      const defaultStock = stockSel.value === 'true';

      if (!storeId) { showToast('Please select a store first.'); return; }
      if (rows.length === 0) { showToast('No rows to save.'); return; }

      let hasError = false;
      rows.forEach(r => {
        r.error = '';
        r.status = 'ok';
        const name = (r.name || '').trim();
        const price = parseFloat(r.price);
        if (!name) { r.error = 'Name required'; r.status = 'error'; hasError = true; }
        if (isNaN(price) || price <= 0) { r.error = (r.error ? r.error + ', ' : '') + 'Valid price required'; r.status = 'error'; hasError = true; }
      });
      renderRows();
      if (hasError) { showToast('Some rows have errors.'); return; }

      let existingNames = new Set();
      try {
        const existingSnap = await getDocs(query(collection(db, 'products'), where('storeId', '==', storeId)));
        existingSnap.forEach(d => {
          const n = (d.data().name || '').trim().toLowerCase();
          if (n) existingNames.add(n);
        });
      } catch (e) {}

      const dupIndices = [];
      rows.forEach((r, i) => {
        const n = (r.name || '').trim().toLowerCase();
        if (existingNames.has(n)) {
          r.status = 'error';
          r.error = 'Duplicate in this store';
          dupIndices.push(i);
        }
      });
      renderRows();
      if (dupIndices.length > 0) {
        const proceed = confirm(`${dupIndices.length} row(s) match existing product names. Save anyway?`);
        if (!proceed) return;
        dupIndices.forEach(i => { rows[i].status = 'ok'; rows[i].error = ''; });
        renderRows();
      }

      saveAllBtn.disabled = true;
      saveAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      progressEl.hidden = false;

      let completed = 0;
      let failed = 0;

      const chunks = [];
      for (let i = 0; i < rows.length; i += UPLOAD_CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + UPLOAD_CHUNK_SIZE));
      }

      const updateProgress = (label) => {
        const pct = rows.length ? Math.round((completed / rows.length) * 100) : 0;
        progressFill.style.width = pct + '%';
        progressLabel.textContent = label || `${completed} / ${rows.length} saved`;
      };
      updateProgress();

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const promises = chunk.map(async (row) => {
          row.status = 'saving';
          renderRows();

          try {
            const productRef = doc(collection(db, 'products'));
            const productId = productRef.id;

            let imageUrl = 'img/placeholder.jpg';
            if (row.file) {
              try {
                const resized = await resizeImage(row.file);
                const { url } = await uploadImage(`products/${storeId}/${productId}.jpg`, resized);
                imageUrl = url;
              } catch (imgErr) {}
            }

            const data = {
              name: (row.name || '').trim(),
              storeId,
              category,
              desc: (row.desc || '').trim(),
              weight: (row.weight || '').trim(),
              price: parseFloat(row.price),
              oldPrice: null,
              image: imageUrl,
              images: [],
              stock: row.stock !== undefined ? row.stock : defaultStock,
              onSpecial: false,
              specialPrice: null,
              specialStartDate: null,
              specialEndDate: null,
              specialTag: '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };

            await setDoc(productRef, data);
            row.status = 'done';
            completed++;
            updateProgress();
          } catch (err) {
            row.status = 'error';
            row.error = err.message || 'Save failed';
            failed++;
          }
          renderRows();
        });

        await Promise.all(promises);
        if (ci < chunks.length - 1) await sleep(UPLOAD_CHUNK_DELAY);
      }

      saveAllBtn.disabled = false;
      saveAllBtn.textContent = 'Save All';
      updateProgress(`Done. ${completed} saved${failed ? `, ${failed} failed` : ''}.`);

      if (failed === 0) {
        showToast(`✅ All ${completed} products saved.`);
        setTimeout(() => {
          closeModal(modal);
          loadProducts();
        }, 1200);
      } else {
        showToast(`⚠️ ${completed} saved, ${failed} failed.`);
      }
    });
  }).catch(error => {
    console.error('Error loading stores:', error);
    showToast('Error loading stores.');
  });
}

// ============================================================
//  LOAD CATEGORY LIST
// ============================================================
async function loadCategoryList() {
  try {
    const snap = await getDocs(collection(db, 'products'));
    const set = new Set();
    snap.forEach(d => {
      const c = (d.data().category || '').trim();
      if (c && c.toLowerCase() !== 'uncategorized') set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    return [];
  }
}

// ============================================================
//  PASTE PARSER
// ============================================================
const WEIGHT_TOKEN_RE = /\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|ml|l|lt|litre|liter|oz|lb|lbs)\b/i;
const PRICE_TOKEN_RE = /\bR\s*(\d+(?:[.,]\d{1,2})?)\b|\b(\d+(?:[.,]\d{1,2})?)\s*R\b/i;

function normaliseWeightToken(match) {
  const num = match[1].replace(',', '.');
  let unit = (match[2] || '').toLowerCase();
  if (unit === 'litre' || unit === 'liter') unit = 'l';
  if (unit === 'lbs') unit = 'lb';
  return `${num}${unit}`;
}
function normalisePriceToken(match) {
  return (match[1] || match[2] || '').replace(',', '.');
}
function extractFieldsFromLine(line) {
  let working = String(line || '').trim();
  if (!working) return { name: '', weight: '', price: '' };
  let weight = '';
  let price = '';
  const wm = working.match(WEIGHT_TOKEN_RE);
  if (wm) { weight = normaliseWeightToken(wm); working = working.replace(wm[0], ' '); }
  const pm = working.match(PRICE_TOKEN_RE);
  if (pm) { price = normalisePriceToken(pm); working = working.replace(pm[0], ' '); }
  const name = working
    .replace(/\s*[|;]\s*/g, ' ')
    .replace(/^\s*[,|;]+\s*/, '')
    .replace(/\s*[,|;]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, weight, price };
}
function parsePastedProducts(raw) {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const parsed = extractFieldsFromLine(line);
    results.push({
      name: parsed.name || line.trim(),
      weight: parsed.weight || '',
      price: parsed.price || '',
      desc: ''
    });
  }
  return results;
}

// ============================================================
//  IMAGE HELPERS
// ============================================================
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > IMG_MAX_DIMENSION) {
          height = Math.round(height * (IMG_MAX_DIMENSION / width));
          width = IMG_MAX_DIMENSION;
        } else if (height > IMG_MAX_DIMENSION) {
          width = Math.round(width * (IMG_MAX_DIMENSION / height));
          height = IMG_MAX_DIMENSION;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Resize failed'));
            if (blob.size > IMG_MAX_BYTES) {
              canvas.toBlob((b2) => b2 ? resolve(b2) : reject(new Error('Retry failed')), 'image/jpeg', 0.6);
            } else {
              resolve(blob);
            }
          },
          'image/jpeg',
          IMG_JPEG_QUALITY
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(path, blob) {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

// ============================================================
//  EDIT / DELETE
// ============================================================
export function editProduct(productId) {
  getDoc(doc(db, 'products', productId)).then(docSnap => {
    if (docSnap.exists()) {
      openProductModal({ ...docSnap.data(), id: productId });
    } else {
      showToast('Product not found.');
    }
  }).catch(error => {
    console.error('Error loading product:', error);
    showToast('Error loading product.');
  });
}

export async function deleteProduct(productId) {
  if (!confirm('Delete this product? Any linked special will also be removed.')) return;
  try {
    const snap = await getDoc(doc(db, 'products', productId));
    if (snap.exists()) {
      const data = snap.data();
      const storeId = data.storeId;
      if (storeId) {
        try { await deleteObject(ref(storage, `products/${storeId}/${productId}.jpg`)); } catch (_) {}
        const imgs = Array.isArray(data.images) ? data.images : [];
        for (let i = 0; i < imgs.length; i++) {
          try { await deleteObject(ref(storage, `products/${storeId}/${productId}-${i + 1}.jpg`)); } catch (_) {}
        }
      }
    }

    try {
      const mirrors = await getDocs(
        query(collection(db, 'specials'), where('productId', '==', productId))
      );
      for (const d of mirrors.docs) {
        try { await deleteDoc(d.ref); } catch (_) {}
      }
    } catch (_) {}

    await deleteDoc(doc(db, 'products', productId));
    await bumpCatalogVersion(); // Tell the cache to refresh
    showToast('✅ Product deleted.');
    loadProducts();
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('❌ Failed to delete product.');
  }
}

// ============================================================
//  HELPERS
// ============================================================
function toDateInput(value) {
  if (!value) return '';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (isNaN(d.getTime())) return '';
  
  // Read local date parts to stop the timezone shift
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
function escapeAttr(str) { return escapeHtml(str); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }