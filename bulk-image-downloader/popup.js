let allImages = [];
let selectedImages = new Set();
let isDragging = false;
let dragStartIndex = null;

document.getElementById('scanBtn').addEventListener('click', scanPage);
document.getElementById('downloadBtn').addEventListener('click', downloadImages);
document.getElementById('selectAll').addEventListener('click', selectAll);
document.getElementById('deselectAll').addEventListener('click', deselectAll);

document.addEventListener('DOMContentLoaded', initAutoDownloadToggle);

async function initAutoDownloadToggle() {
  const toggle = document.getElementById('autoDownloadToggle');
  
  chrome.runtime.sendMessage({ action: 'getAutoDownloadStatus' }, (response) => {
    if (response && response.enabled !== undefined) {
      toggle.checked = response.enabled;
    }
  });
  
  toggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    chrome.runtime.sendMessage({ 
      action: 'setAutoDownloadStatus', 
      enabled: enabled 
    }, (response) => {
      if (response && response.success) {
        console.log('Auto-download setting updated:', enabled);
        
        const section = document.querySelector('.auto-download-section');
        section.style.background = enabled ? '#f0fff4' : 'white';
        setTimeout(() => {
          section.style.background = 'white';
        }, 500);
      }
    });
  });
}

async function scanPage() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('imageContainer').innerHTML = '';
  allImages = [];
  selectedImages.clear();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractImages
    });

    allImages = results[0].result;
    displayImages();
  } catch (error) {
    console.error('Error scanning page:', error);
    document.getElementById('imageContainer').innerHTML = 
      '<div class="no-images"><p>Error scanning page. Please try again.</p></div>';
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function extractImages() {
  const images = [];
  const seenUrls = new Set();

  function resolveUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return null;
    }
  }

  function isImageUrl(url) {
    if (!url) return false;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico'];
    const urlLower = url.toLowerCase();
    return imageExtensions.some(ext => urlLower.includes(ext)) || 
           url.startsWith('data:image/') ||
           url.startsWith('blob:');
  }

  document.querySelectorAll('img').forEach(img => {
    let src = img.src || img.dataset.src || img.dataset.original;
    if (!src) return;

    src = resolveUrl(src);
    if (!src || seenUrls.has(src)) return;

    let highResUrl = null;
    const parentLink = img.closest('a');
    if (parentLink && parentLink.href) {
      const href = parentLink.href;
      if (isImageUrl(href) && href !== src) {
        highResUrl = href;
      }
    }

    if (parentLink && parentLink.href && 
        (parentLink.href.includes('/data/') || 
         parentLink.href.includes('/file/') ||
         parentLink.download)) {
      highResUrl = parentLink.href;
    }

    const finalUrl = highResUrl || src;
    seenUrls.add(finalUrl);

    images.push({
      url: finalUrl,
      thumbnail: src,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      hasHighRes: !!highResUrl
    });
  });

  document.querySelectorAll('*').forEach(el => {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const urlMatch = bg.match(/url\(['"]?(.*?)['"]?\)/);
      if (urlMatch) {
        const url = resolveUrl(urlMatch[1]);
        if (url && isImageUrl(url) && !seenUrls.has(url)) {
          seenUrls.add(url);
          images.push({
            url: url,
            thumbnail: url,
            width: 0,
            height: 0,
            hasHighRes: false
          });
        }
      }
    }
  });

  document.querySelectorAll('picture source, source[srcset]').forEach(source => {
    const srcset = source.srcset;
    if (srcset) {
      const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
      urls.forEach(url => {
        url = resolveUrl(url);
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          images.push({
            url: url,
            thumbnail: url,
            width: 0,
            height: 0,
            hasHighRes: false
          });
        }
      });
    }
  });

  document.querySelectorAll('[data-full], [data-full-src], [data-original], [data-large]').forEach(el => {
    const dataAttrs = ['data-full', 'data-full-src', 'data-original', 'data-large'];
    dataAttrs.forEach(attr => {
      const url = resolveUrl(el.getAttribute(attr));
      if (url && isImageUrl(url) && !seenUrls.has(url)) {
        seenUrls.add(url);
        images.push({
          url: url,
          thumbnail: url,
          width: 0,
          height: 0,
          hasHighRes: false
        });
      }
    });
  });

  return images;
}

function displayImages() {
  const container = document.getElementById('imageContainer');
  document.getElementById('totalCount').textContent = allImages.length;
  document.getElementById('selectedCount').textContent = '0';

  if (allImages.length === 0) {
    container.innerHTML = `
      <div class="no-images">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <h2>No Images Found</h2>
        <p>Try refreshing the page and scanning again.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '<div class="image-grid"></div>';
  const grid = container.querySelector('.image-grid');

  allImages.forEach((img, index) => {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.dataset.index = index;

    const dimensions = img.width && img.height ? 
      `${img.width}×${img.height}` : 'Unknown';

    item.innerHTML = `
      <input type="checkbox" class="image-checkbox" data-index="${index}">
      ${img.hasHighRes ? '<div class="high-res-badge">HD</div>' : ''}
      <img src="${img.thumbnail}" class="image-preview" alt="Image ${index + 1}">
      <div class="image-info">
        <div><strong>#${index + 1}</strong></div>
        <div>${dimensions}</div>
      </div>
    `;

    grid.appendChild(item);

    const checkbox = item.querySelector('.image-checkbox');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleImageSelection(index, checkbox.checked);
    });

    item.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        checkbox.checked = !checkbox.checked;
        toggleImageSelection(index, checkbox.checked);
      }
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.type !== 'checkbox') {
        isDragging = true;
        dragStartIndex = index;
        e.preventDefault();
      }
    });

    item.addEventListener('mouseenter', () => {
      if (isDragging) {
        const checkbox = item.querySelector('.image-checkbox');
        checkbox.checked = true;
        toggleImageSelection(index, true);
      }
    });
  });

  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('mouseleave', handleMouseUp);
}

function handleMouseUp() {
  if (isDragging) {
    isDragging = false;
    dragStartIndex = null;
  }
}

function toggleImageSelection(index, selected) {
  const item = document.querySelector(`[data-index="${index}"]`);
  
  if (selected) {
    selectedImages.add(index);
    item.classList.add('selected');
  } else {
    selectedImages.delete(index);
    item.classList.remove('selected');
  }

  document.getElementById('selectedCount').textContent = selectedImages.size;
  document.getElementById('downloadBtn').disabled = selectedImages.size === 0;
}

function selectAll() {
  document.querySelectorAll('.image-checkbox').forEach((cb, index) => {
    cb.checked = true;
    toggleImageSelection(index, true);
  });
}

function deselectAll() {
  document.querySelectorAll('.image-checkbox').forEach((cb, index) => {
    cb.checked = false;
    toggleImageSelection(index, false);
  });
  selectedImages.clear();
  document.getElementById('selectedCount').textContent = '0';
  document.getElementById('downloadBtn').disabled = true;
}

async function downloadImages() {
  if (selectedImages.size === 0) return;

  const downloadBtn = document.getElementById('downloadBtn');
  
  downloadBtn.disabled = true;
  downloadBtn.textContent = '⏳ Starting...';

  try {
    const imagesToDownload = Array.from(selectedImages).map(i => allImages[i]);
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const hostname = new URL(tab.url).hostname.replace(/[^a-z0-9]/gi, '_');

    chrome.runtime.sendMessage({
      action: 'downloadImages',
      images: imagesToDownload,
      hostname: hostname
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError);
        alert('Error starting download. Please try again.');
        downloadBtn.disabled = false;
        downloadBtn.textContent = '📥 Download ZIP';
      } else {
        console.log('Download started in background');
        downloadBtn.textContent = '✓ Download Started';
        
        setTimeout(() => {
          downloadBtn.disabled = false;
          downloadBtn.textContent = '📥 Download ZIP';
        }, 2000);
      }
    });

  } catch (error) {
    console.error('Error initiating download:', error);
    alert('Error starting download. Please try again.');
    downloadBtn.disabled = false;
    downloadBtn.textContent = '📥 Download ZIP';
  }
}

window.addEventListener('load', () => {
  setTimeout(scanPage, 100);
});

window.addEventListener('unload', () => {
  document.removeEventListener('mouseup', handleMouseUp);
  document.removeEventListener('mouseleave', handleMouseUp);
});
