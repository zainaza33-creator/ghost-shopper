// ============================================================
//  carousel-modal.js — Shared carousel modal for Ghost Shopper
// ============================================================

let _carouselState = null;

export function openCarouselModal({ title, placeholder, items, onItemTap, emptyText }) {
  closeCarouselModal();

  const state = {
    title: title || 'Items',
    placeholder: placeholder || 'Search...',
    allItems: Array.isArray(items) ? items : [],
    filtered: Array.isArray(items) ? [...items] : [],
    index: 0,
    onItemTap: typeof onItemTap === 'function' ? onItemTap : null,
    emptyText: emptyText || 'No items found.'
  };
  _carouselState = state;

  const modal = document.createElement('div');
  modal.id = 'gsCarouselModal';
  modal.className = 'carousel-modal';
  
  modal.innerHTML = `
    <div class="carousel-backdrop"></div>
    <div class="carousel-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.title)}">
      <div class="carousel-header">
        <h2 class="carousel-title">${escapeHtml(state.title)}</h2>
        <div class="carousel-header-actions">
          <button class="carousel-search-toggle" type="button" aria-label="Search">
            <i class="fas fa-search" aria-hidden="true"></i>
          </button>
          <button class="carousel-close" type="button" aria-label="Close">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="carousel-search-wrap" id="carouselSearchWrap" hidden>
        <div class="carousel-search-inner">
          <i class="fas fa-search" aria-hidden="true"></i>
          <input type="text" class="carousel-search-input" placeholder="${escapeHtml(state.placeholder)}" aria-label="${escapeHtml(state.placeholder)}" />
          <button type="button" class="carousel-search-clear" hidden aria-label="Clear search">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="carousel-stage">
        <button class="carousel-nav carousel-nav-prev" type="button" aria-label="Previous item">
          <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>

        <div class="carousel-slide" id="carouselSlide"></div>

        <button class="carousel-nav carousel-nav-next" type="button" aria-label="Next item">
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
      </div>

      <div class="carousel-footer">
        <div class="carousel-dots-wrap">
          <span class="carousel-count-pill" id="carouselCountPill">1 / 1</span>
          <div class="carousel-dots" id="carouselDots" aria-hidden="true"></div>
        </div>
        <button class="carousel-add-btn" id="carouselAddBtn" type="button">
          <i class="fas fa-shopping-bag" aria-hidden="true"></i>
          <span>View & Add to Cart</span>
        </button>
      </div>

      <div class="carousel-empty" id="carouselEmpty" hidden>
        <i class="fas fa-search" aria-hidden="true"></i>
        <p>${escapeHtml(state.emptyText)}</p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => modal.classList.add('open'));

  const closeBtn = modal.querySelector('.carousel-close');
  const backdrop = modal.querySelector('.carousel-backdrop');
  const searchToggle = modal.querySelector('.carousel-search-toggle');
  const searchWrap = modal.querySelector('#carouselSearchWrap');
  const searchInput = modal.querySelector('.carousel-search-input');
  const searchClear = modal.querySelector('.carousel-search-clear');
  const prevBtn = modal.querySelector('.carousel-nav-prev');
  const nextBtn = modal.querySelector('.carousel-nav-next');
  const slideEl = modal.querySelector('#carouselSlide');
  const countPill = modal.querySelector('#carouselCountPill');
  const dotsEl = modal.querySelector('#carouselDots');
  const addBtn = modal.querySelector('#carouselAddBtn');
  const emptyEl = modal.querySelector('#carouselEmpty');
  const stageEl = modal.querySelector('.carousel-stage');

  // ---- Search Toggle Logic ----
  searchToggle.addEventListener('click', () => {
    const isHidden = searchWrap.hasAttribute('hidden');
    if (isHidden) {
      searchWrap.removeAttribute('hidden');
      searchToggle.classList.add('active');
      setTimeout(() => searchInput.focus(), 100);
    } else {
      searchWrap.setAttribute('hidden', '');
      searchToggle.classList.remove('active');
      if (searchInput.value.trim()) {
        searchInput.value = '';
        searchClear.hidden = true;
        state.filtered = [...state.allItems];
        state.index = 0;
        render();
      }
    }
  });

  // ---- Swipe Handling ----
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;

  stageEl.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches.length) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
  }, { passive: true });

  stageEl.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches.length) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      touchMoved = true;
    }
  }, { passive: true });

  stageEl.addEventListener('touchend', (e) => {
    if (!touchMoved) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    
    if (Math.abs(dx) < 40) return;
    
    if (dx < 0) {
      goTo(state.index + 1, 'slide-left');
    } else {
      goTo(state.index - 1, 'slide-right');
    }
  }, { passive: true });

  // ---- Keyboard ----
  const keyHandler = (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { closeCarouselModal(); return; }
    if (document.activeElement === searchInput) return; 
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(state.index - 1, 'slide-right'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(state.index + 1, 'slide-left'); }
  };
  document.addEventListener('keydown', keyHandler);

  // ---- Close ----
  closeBtn.addEventListener('click', closeCarouselModal);
  backdrop.addEventListener('click', closeCarouselModal);

  // ---- Nav ----
  prevBtn.addEventListener('click', () => goTo(state.index - 1, 'slide-right'));
  nextBtn.addEventListener('click', () => goTo(state.index + 1, 'slide-left'));

  // ---- Search Input ----
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    searchClear.hidden = q.length === 0;

    state.filtered = q
      ? state.allItems.filter((it) => (it.searchText || '').includes(q))
      : [...state.allItems];
    state.index = 0;
    render();
  });
  
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    state.filtered = [...state.allItems];
    state.index = 0;
    render();
    searchInput.focus();
  });

  // ---- Add / View button ----
  addBtn.addEventListener('click', () => {
    const item = state.filtered[state.index];
    if (!item) return;
    if (state.onItemTap) state.onItemTap(item);
  });

  // ---- Slide tap ----
  slideEl.addEventListener('click', (e) => {
    if (e.target.closest('.carousel-nav')) return;
    const item = state.filtered[state.index];
    if (!item) return;
    if (state.onItemTap) state.onItemTap(item);
  });

  // ---- Render & Animation ----
  function goTo(newIndex, direction) {
    if (newIndex < 0) return;
    if (newIndex >= state.filtered.length) return;
    
    // Apply exit animation class
    if (direction === 'slide-left') {
      slideEl.classList.add('slide-out-left');
    } else {
      slideEl.classList.add('slide-out-right');
    }

    // Wait for animation to finish (0.2s), then swap content
    setTimeout(() => {
      state.index = newIndex;
      render();
      
      // Remove exit classes and apply entry class
      slideEl.classList.remove('slide-out-left', 'slide-out-right');
      slideEl.classList.add(direction === 'slide-left' ? 'slide-in-right' : 'slide-in-left');
      
      // Clean up entry class after animation finishes (0.25s)
      setTimeout(() => {
        slideEl.classList.remove('slide-in-right', 'slide-in-left');
      }, 250);
      
    }, 200);
  }

  function render() {
    const total = state.filtered.length;
    const current = state.index;
    const item = state.filtered[current];

    countPill.textContent = total > 0 ? `${current + 1} / ${total}` : '0 / 0';

    if (!item) {
      slideEl.innerHTML = '';
      slideEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.querySelector('p').textContent = searchInput.value.trim()
        ? `No results match "${searchInput.value.trim()}".`
        : state.emptyText;
      dotsEl.innerHTML = '';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      addBtn.disabled = true;
      return;
    }

    slideEl.hidden = false;
    emptyEl.hidden = true;

    const img = item.image || 'img/placeholder.jpg';
    const tagHtml = item.tag ? `<span class="carousel-tag">${escapeHtml(item.tag)}</span>` : '';
    const priceHtml = item.price
      ? `<div class="carousel-price">
           <span class="carousel-price-now">${escapeHtml(item.price)}</span>
           ${item.oldPrice ? `<span class="carousel-price-old">${escapeHtml(item.oldPrice)}</span>` : ''}
         </div>`
      : '';
    const subtitleHtml = item.subtitle
      ? `<div class="carousel-subtitle"><i class="fas fa-store" aria-hidden="true"></i> ${escapeHtml(item.subtitle)}</div>`
      : '';

    slideEl.innerHTML = `
      <article class="carousel-card">
        <div class="carousel-card-img-wrap">
          ${tagHtml}
          <img class="carousel-card-img" src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" onerror="this.src='img/placeholder.jpg'" />
        </div>
        <div class="carousel-card-body">
          ${subtitleHtml}
          <h3 class="carousel-card-title">${escapeHtml(item.title)}</h3>
          ${priceHtml}
        </div>
      </article>
    `;

    if (total <= 15) {
      dotsEl.innerHTML = state.filtered.map((_, i) => `
        <span class="carousel-dot ${i === current ? 'active' : ''}" data-i="${i}"></span>
      `).join('');
      dotsEl.querySelectorAll('.carousel-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
          const targetIndex = parseInt(dot.dataset.i, 10);
          if (targetIndex > state.index) {
            goTo(targetIndex, 'slide-left');
          } else if (targetIndex < state.index) {
            goTo(targetIndex, 'slide-right');
          }
        });
      });
    } else {
      dotsEl.innerHTML = `<span class="carousel-dots-text">...</span>`;
    }

    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === total - 1;
    prevBtn.style.visibility = current === 0 ? 'hidden' : 'visible';
    nextBtn.style.visibility = current === total - 1 ? 'hidden' : 'visible';

    addBtn.disabled = false;
    addBtn.querySelector('span').textContent = item.ctaLabel || 'View & Add to Cart';
  }

  render();
}

export function closeCarouselModal() {
  const modal = document.getElementById('gsCarouselModal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => {
    modal.remove();
    const productOpen = document.querySelector('.product-modal.open');
    const cartOpen = document.querySelector('.cart-modal.open');
    const gsOpen = document.querySelector('.gs-modal.open');
    if (!productOpen && !cartOpen && !gsOpen) {
      document.body.style.overflow = '';
    }
  }, 300);
  _carouselState = null;
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