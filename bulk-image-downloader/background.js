importScripts('jszip.min.js');

console.log('Bulk Image Downloader background service worker loaded');

const MEDIA_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'mp4', 'webm', 'avi', 'mov', 'mkv', 'flv',
  'mp3', 'wav', 'ogg', 'flac', 'm4a'
];

const MEDIA_MIME_TYPES = [
  'image/', 'video/', 'audio/'
];

const mediaTabs = new Map();

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const autoDownloadEnabled = await getAutoDownloadSetting();
  if (!autoDownloadEnabled) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    const url = tab.url || details.url;

    if (isMediaUrl(url)) {
      console.log('Media file detected in tab:', url);
      mediaTabs.set(details.tabId, { url, pendingDownload: true });
      
      setTimeout(() => downloadAndCloseTab(details.tabId, url), 500);
    }
  } catch (error) {
    console.error('Error checking tab:', error);
  }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const autoDownloadEnabled = await getAutoDownloadSetting();
  if (!autoDownloadEnabled) return;

  if (mediaTabs.has(details.tabId)) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    const url = tab.url;

    if (isMediaUrl(url)) {
      console.log('Media file detected (onCompleted):', url);
      downloadAndCloseTab(details.tabId, url);
    }
  } catch (error) {
    console.error('Error in onCompleted:', error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  mediaTabs.delete(tabId);
});

function isMediaUrl(url) {
  if (!url) return false;
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    const hasMediaExtension = MEDIA_EXTENSIONS.some(ext => 
      pathname.endsWith('.' + ext)
    );
    
    const isDataUrl = url.startsWith('data:') && 
                      MEDIA_MIME_TYPES.some(type => url.includes(type));
    
    const isBlobUrl = url.startsWith('blob:');
    
    return hasMediaExtension || isDataUrl || isBlobUrl;
  } catch (error) {
    return false;
  }
}

async function downloadAndCloseTab(tabId, url) {
  try {
    console.log(`Downloading and closing tab ${tabId}: ${url}`);
    
    let filename = 'media_file';
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      filename = pathParts[pathParts.length - 1] || filename;
      
      filename = filename.split('?')[0];
      
      if (!filename.includes('.')) {
        const ext = MEDIA_EXTENSIONS.find(e => url.toLowerCase().includes('.' + e));
        if (ext) filename += '.' + ext;
      }
    } catch (error) {
      console.error('Error parsing filename:', error);
    }

    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    });

    console.log(`Download started with ID: ${downloadId}`);
    
    setTimeout(async () => {
      try {
        await chrome.tabs.remove(tabId);
        console.log(`Tab ${tabId} closed`);
        mediaTabs.delete(tabId);
      } catch (error) {
        console.error('Error closing tab:', error);
      }
    }, 1000);

  } catch (error) {
    console.error('Error downloading media:', error);
  }
}

async function getAutoDownloadSetting() {
  try {
    const result = await chrome.storage.sync.get(['autoDownloadEnabled']);
    return result.autoDownloadEnabled || false;
  } catch (error) {
    console.error('Error getting setting:', error);
    return false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadImages') {
    handleDownload(request.images, request.hostname);
    sendResponse({ status: 'started' });
    return true;
  } else if (request.action === 'getAutoDownloadStatus') {
    getAutoDownloadSetting().then(enabled => {
      sendResponse({ enabled });
    });
    return true;
  } else if (request.action === 'setAutoDownloadStatus') {
    chrome.storage.sync.set({ autoDownloadEnabled: request.enabled }).then(() => {
      console.log('Auto-download setting updated:', request.enabled);
      sendResponse({ success: true });
    });
    return true;
  }
});

async function handleDownload(images, hostname) {
  try {
    console.log(`Starting download of ${images.length} images`);
    
    const zip = new JSZip();
    let completed = 0;
    let failed = 0;

    for (const [index, img] of images.entries()) {
      try {
        console.log(`Downloading image ${index + 1}/${images.length}: ${img.url}`);
        
        const response = await fetch(img.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const blob = await response.blob();
        
        const urlParts = img.url.split('/');
        let filename = urlParts[urlParts.length - 1].split('?')[0];
        
        if (!filename || !filename.includes('.')) {
          const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
          filename = `image_${String(index + 1).padStart(4, '0')}.${ext}`;
        }
        
        let finalFilename = filename;
        let counter = 1;
        while (zip.file(finalFilename)) {
          const nameParts = filename.split('.');
          const ext = nameParts.pop();
          const base = nameParts.join('.');
          finalFilename = `${base}_${counter}.${ext}`;
          counter++;
        }

        zip.file(finalFilename, blob);
        completed++;
        
        console.log(`Progress: ${completed}/${images.length} (${failed} failed)`);
        
      } catch (error) {
        failed++;
        console.error(`Failed to download ${img.url}:`, error);
      }
    }

    if (completed === 0) {
      console.error('All downloads failed');
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'Download Failed',
        message: 'All images failed to download. Please try again.'
      });
      return;
    }

    console.log('Generating ZIP archive...');
    const zipBlob = await zip.generateAsync({ 
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    
    const dataUrl = `data:application/zip;base64,${zipBlob}`;
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `images_${hostname}_${timestamp}.zip`;

    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    console.log(`Download started with ID: ${downloadId}`);
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Download Complete',
      message: `Downloaded ${completed} images${failed > 0 ? ` (${failed} failed)` : ''}`
    });

  } catch (error) {
    console.error('Error in download process:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Download Error',
      message: error.message || 'Failed to create ZIP file. Check console for details.'
    });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);
  chrome.storage.sync.get(['autoDownloadEnabled'], (result) => {
    if (result.autoDownloadEnabled === undefined) {
      chrome.storage.sync.set({ autoDownloadEnabled: false });
    }
  });
});
